import { randomUUID } from "crypto";
import * as vscode from "vscode";
import { autoGroupRefFor } from "./grouping";
import { displayTitle, SessionMeta } from "./indexer";
import { LiveSessionMonitor } from "./liveSessions";
import { pickSession } from "./quickPick";
import { Registry, userGroupRef } from "./registry";
import { SessionIndex } from "./sessionIndex";
import { attachBackgroundSession, findSessionTerminal, resumeSession } from "./terminals";
import { TreeNode } from "./tree";

export interface CommandDependencies {
  sessionIndex: SessionIndex;
  liveMonitor: LiveSessionMonitor;
  registry: Registry;
  treeView: vscode.TreeView<TreeNode>;
  log: vscode.OutputChannel;
}

type SessionNode = Extract<TreeNode, { kind: "session" }>;
type GroupNode = Extract<TreeNode, { kind: "group" }>;

const FORK_CHOICE = "Fork a Copy Here";
const ATTACH_CHOICE = "Attach Here";

export function registerCommands(dependencies: CommandDependencies): vscode.Disposable[] {
  const { sessionIndex, liveMonitor, registry, treeView, log } = dependencies;

  const selectedSessionNodes = (clickedNode?: TreeNode): SessionNode[] => {
    const candidateNodes = clickedNode && !treeView.selection.includes(clickedNode) ? [clickedNode] : treeView.selection;
    return candidateNodes.filter((node): node is SessionNode => node.kind === "session");
  };

  const findSessionMeta = async (sessionId: string): Promise<SessionMeta | undefined> => {
    const indexedMeta = sessionIndex.currentSessions.find((session) => session.sessionId === sessionId);
    if (indexedMeta) {
      return indexedMeta;
    }
    const refreshedSessions = await sessionIndex.refresh();
    return refreshedSessions.find((session) => session.sessionId === sessionId);
  };

  // A session already running outside this window must not be resumed again: two processes would append to one transcript.
  const openSession = async (meta: SessionMeta): Promise<void> => {
    const openTerminal = findSessionTerminal(meta.sessionId);
    if (openTerminal) {
      openTerminal.show();
      return;
    }
    const liveSession = (await liveMonitor.refresh()).get(meta.sessionId);
    if (liveSession === undefined) {
      await registry.pin(meta.sessionId);
      resumeSession(meta, log);
      return;
    }

    const isBackgroundAgent = liveSession.kind === "background" && liveSession.agentId !== undefined;
    const runningWhere = isBackgroundAgent ? "as a background agent" : `in another terminal (pid ${liveSession.pid ?? "unknown"})`;
    const choices = isBackgroundAgent ? [ATTACH_CHOICE, FORK_CHOICE] : [FORK_CHOICE];
    const choice = await vscode.window.showWarningMessage(
      `"${displayTitle(meta)}" is already running ${runningWhere}.`,
      {
        modal: true,
        detail: "Resuming it here would run two copies of the same conversation. Switch to the other one, or fork a copy with its own session ID.",
      },
      ...choices,
    );
    if (choice === ATTACH_CHOICE && liveSession.agentId !== undefined) {
      await registry.pin(meta.sessionId);
      attachBackgroundSession(meta, liveSession.agentId, log);
    } else if (choice === FORK_CHOICE) {
      const forkSessionId = randomUUID();
      const originalGroupRef = registry.assignments()[meta.sessionId] ?? autoGroupRefFor(meta);
      await registry.pin(forkSessionId);
      await registry.assign([forkSessionId], originalGroupRef);
      resumeSession(meta, log, forkSessionId);
    }
  };

  const renameGroup = async (groupNode: GroupNode): Promise<void> => {
    const group = groupNode.group;
    const newName = await vscode.window.showInputBox({ prompt: "Rename group", value: group.label });
    if (!newName || newName === group.label) {
      return;
    }
    if (group.kind === "user") {
      await registry.renameGroup(group.ref.slice("user:".length), newName);
      return;
    }
    // Renaming an auto group turns it into a user group that keeps its current sessions.
    const createdGroup = await registry.createGroup(newName, randomUUID());
    await registry.assign(
      group.sessions.map((pinned) => pinned.sessionId),
      userGroupRef(createdGroup.id),
    );
  };

  return [
    vscode.commands.registerCommand("overseer.allSessions", async () => {
      const pickedSession = await pickSession(sessionIndex, liveMonitor, registry);
      if (pickedSession) {
        await openSession(pickedSession);
      }
    }),
    vscode.commands.registerCommand("overseer.refreshIndex", async () => {
      await Promise.all([sessionIndex.refresh(), liveMonitor.refresh()]);
    }),
    vscode.commands.registerCommand("overseer.focusSession", (sessionId: string) => {
      findSessionTerminal(sessionId)?.show();
    }),
    vscode.commands.registerCommand("overseer.resumeSession", async (clickedNode?: TreeNode) => {
      for (const sessionNode of selectedSessionNodes(clickedNode)) {
        const sessionId = sessionNode.pinned.sessionId;
        const meta = sessionNode.pinned.meta ?? (await findSessionMeta(sessionId));
        if (meta === undefined) {
          void vscode.window.showErrorMessage(`Overseer: no transcript found for session ${sessionId}.`);
          continue;
        }
        await openSession(meta);
      }
    }),
    vscode.commands.registerCommand("overseer.unpinSession", async (clickedNode?: TreeNode) => {
      for (const sessionNode of selectedSessionNodes(clickedNode)) {
        await registry.unpin(sessionNode.pinned.sessionId);
      }
    }),
    vscode.commands.registerCommand("overseer.newGroup", async () => {
      const groupName = await vscode.window.showInputBox({ prompt: "New group name", placeHolder: "PROJ-2567 login timeout" });
      if (groupName) {
        await registry.createGroup(groupName, randomUUID());
      }
    }),
    vscode.commands.registerCommand("overseer.renameGroup", async (clickedNode?: TreeNode) => {
      const groupNode = clickedNode ?? treeView.selection[0];
      if (groupNode?.kind === "group" && groupNode.group.kind !== "ungrouped") {
        await renameGroup(groupNode);
      }
    }),
    vscode.commands.registerCommand("overseer.deleteGroup", async (clickedNode?: TreeNode) => {
      const groupNode = clickedNode ?? treeView.selection[0];
      if (groupNode?.kind === "group" && groupNode.group.kind === "user") {
        await registry.deleteGroup(groupNode.group.ref.slice("user:".length));
      }
    }),
    vscode.commands.registerCommand("overseer.rename", async () => {
      const selectedNode = treeView.selection[0];
      if (selectedNode?.kind === "group" && selectedNode.group.kind !== "ungrouped") {
        await renameGroup(selectedNode);
      }
    }),
  ];
}
