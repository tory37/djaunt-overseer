import { randomUUID } from "crypto";
import * as fs from "fs";
import * as vscode from "vscode";
import { autoGroupRefFor, PinnedSession, pinnedSessionTitle } from "./grouping";
import * as path from "path";
import { displayTitle, SessionMeta } from "./indexer";
import { tildePath } from "./paths";
import { LiveSessionMonitor } from "./liveSessions";
import { pickSession } from "./quickPick";
import { Registry, userGroupRef } from "./registry";
import { SessionIndex } from "./sessionIndex";
import {
  attachBackgroundSession,
  findSessionTerminal,
  resumeSession,
  sendSlashCommand,
  startNewSession,
  suspendTerminal,
} from "./terminals";
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
const SUSPEND_ANYWAY_CHOICE = "Suspend Anyway";
const DOUBLE_CLICK_WINDOW_MS = 400;
const RECENT_DIRECTORY_LIMIT = 12;

interface DirectoryPickItem extends vscode.QuickPickItem {
  directory: string | undefined;
}

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
      const originalGroupRef =
        registry.assignments()[meta.sessionId] ?? autoGroupRefFor(meta, registry.labels()[meta.sessionId]);
      await registry.pin(forkSessionId);
      await registry.assign([forkSessionId], originalGroupRef);
      resumeSession(meta, log, forkSessionId);
    }
  };

  const pickDirectory = async (groupDirectories: string[]): Promise<string | undefined> => {
    const workspaceDirectories = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
    const recentDirectories = sessionIndex.currentSessions
      .map((session) => session.resumeCwd ?? session.startCwd)
      .filter((directory) => fs.existsSync(directory));
    const uniqueDirectories = [...new Set([...groupDirectories, ...workspaceDirectories, ...recentDirectories])].slice(
      0,
      RECENT_DIRECTORY_LIMIT,
    );
    const directoryItems: DirectoryPickItem[] = uniqueDirectories.map((directory) => ({
      label: path.basename(directory),
      description: tildePath(directory),
      directory,
    }));
    const browseItem: DirectoryPickItem = { label: "$(folder-opened) Browse…", directory: undefined };
    const pickedItem = await vscode.window.showQuickPick([...directoryItems, browseItem], {
      title: "New Claude session: where should it start?",
      matchOnDescription: true,
    });
    if (pickedItem === undefined || pickedItem.directory !== undefined) {
      return pickedItem?.directory;
    }
    const browsedFolders = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false });
    return browsedFolders?.[0]?.fsPath;
  };

  const suspendSessions = async (pinnedSessions: PinnedSession[]): Promise<void> => {
    const runningSessions = pinnedSessions.filter((pinned) => findSessionTerminal(pinned.sessionId) !== undefined);
    const busySessions = runningSessions.filter((pinned) => liveMonitor.get(pinned.sessionId)?.status === "busy");
    if (busySessions.length > 0) {
      const busyTitles = busySessions.map(pinnedSessionTitle).join(", ");
      const choice = await vscode.window.showWarningMessage(
        `Claude is mid-task in: ${busyTitles}.`,
        { modal: true, detail: "Suspending stops that work. The conversation up to now is kept and resumes later." },
        SUSPEND_ANYWAY_CHOICE,
      );
      if (choice !== SUSPEND_ANYWAY_CHOICE) {
        return;
      }
    }
    await Promise.all(
      runningSessions.map((pinned) => {
        const terminal = findSessionTerminal(pinned.sessionId);
        return terminal ? suspendTerminal(terminal) : Promise.resolve();
      }),
    );
  };

  const renameSession = async (pinned: PinnedSession): Promise<void> => {
    const currentTitle = pinnedSessionTitle(pinned);
    const newName = (await vscode.window.showInputBox({ prompt: "Rename session", value: currentTitle }))?.trim();
    if (!newName || newName === currentTitle) {
      return;
    }
    await registry.setLabel(pinned.sessionId, newName);
    const terminal = findSessionTerminal(pinned.sessionId);
    if (terminal === undefined) {
      return;
    }
    if (liveMonitor.get(pinned.sessionId)?.status === "busy") {
      void vscode.window.showInformationMessage(
        "Overseer: renamed in the sidebar. Claude is mid-task, so run /rename yourself once it finishes to update its own title.",
      );
      return;
    }
    sendSlashCommand(terminal, `/rename ${newName.replace(/[\r\n]+/g, " ")}`);
    terminal.show();
    await vscode.commands.executeCommand("workbench.action.terminal.renameWithArg", { name: newName });
  };

  const findPinnedSession = (sessionId: string): PinnedSession | undefined => {
    const sessionNode = treeView.selection.find(
      (node): node is SessionNode => node.kind === "session" && node.pinned.sessionId === sessionId,
    );
    return sessionNode?.pinned;
  };

  let lastClick: { sessionId: string; atMs: number } | undefined;

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
    await registry.replaceGroupRef(group.ref, userGroupRef(createdGroup.id));
  };

  return [
    vscode.commands.registerCommand("overseer.allSessions", async () => {
      const pickedSession = await pickSession(sessionIndex, liveMonitor, registry);
      if (pickedSession) {
        await openSession(pickedSession);
      }
    }),
    vscode.commands.registerCommand("overseer.addExistingToGroup", async (clickedNode?: TreeNode) => {
      if (clickedNode?.kind !== "group") {
        return;
      }
      const pickedSession = await pickSession(sessionIndex, liveMonitor, registry);
      if (pickedSession === undefined) {
        return;
      }
      if (clickedNode.group.kind !== "ungrouped") {
        await registry.assign([pickedSession.sessionId], clickedNode.group.ref);
      }
      await registry.pin(pickedSession.sessionId);
      await openSession(pickedSession);
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
    // The transcript stays on disk, so a killed session can still be resumed from All Sessions.
    vscode.commands.registerCommand("overseer.killSession", async (clickedNode?: TreeNode) => {
      const liveSessions = await liveMonitor.refresh();
      for (const sessionNode of selectedSessionNodes(clickedNode)) {
        const sessionId = sessionNode.pinned.sessionId;
        const terminal = findSessionTerminal(sessionId);
        const liveSession = liveSessions.get(sessionId);
        if (terminal !== undefined) {
          terminal.dispose();
        } else if (liveSession?.pid !== undefined && liveSession.kind !== "background") {
          killProcess(liveSession.pid, log);
        }
        await registry.unpin(sessionId);
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
      if (selectedNode?.kind === "session") {
        await renameSession(selectedNode.pinned);
      } else if (selectedNode?.kind === "group" && selectedNode.group.kind !== "ungrouped") {
        await renameGroup(selectedNode);
      }
    }),
    vscode.commands.registerCommand("overseer.renameSession", async (clickedNode?: TreeNode) => {
      const sessionNode = selectedSessionNodes(clickedNode)[0];
      if (sessionNode) {
        await renameSession(sessionNode.pinned);
      }
    }),
    // Tree items have no double-click event, so two clicks on the same session in quick succession count as one.
    vscode.commands.registerCommand("overseer.clickSession", async (sessionId: string) => {
      const nowMs = Date.now();
      const isDoubleClick = lastClick?.sessionId === sessionId && nowMs - lastClick.atMs < DOUBLE_CLICK_WINDOW_MS;
      lastClick = isDoubleClick ? undefined : { sessionId, atMs: nowMs };
      const pinned = findPinnedSession(sessionId);
      if (isDoubleClick && pinned) {
        await renameSession(pinned);
        return;
      }
      findSessionTerminal(sessionId)?.show(true);
    }),
    vscode.commands.registerCommand("overseer.newSession", async (clickedNode?: TreeNode) => {
      const groupDirectories =
        clickedNode?.kind === "group" ? clickedNode.group.sessions.map(pinnedSessionDirectory).filter(isDefined) : [];
      const startDirectory = await pickDirectory(groupDirectories);
      if (startDirectory === undefined) {
        return;
      }
      const sessionName = (
        await vscode.window.showInputBox({
          title: `New Claude session in ${tildePath(startDirectory)}`,
          prompt: "Name (optional). A ticket key like PROJ-2567 files it under that ticket.",
        })
      )?.trim();
      if (sessionName === undefined) {
        return;
      }
      const sessionId = randomUUID();
      await registry.addPendingSession(sessionId, { cwd: startDirectory, createdAtMs: Date.now() });
      if (sessionName !== "") {
        await registry.setLabel(sessionId, sessionName);
      }
      // Ungrouped stays implicit so a ticket key in the name still files the session under that ticket.
      if (clickedNode?.kind === "group" && clickedNode.group.kind !== "ungrouped") {
        await registry.assign([sessionId], clickedNode.group.ref);
      }
      await registry.pin(sessionId);
      startNewSession(sessionId, sessionName === "" ? undefined : sessionName, startDirectory, log);
    }),
    vscode.commands.registerCommand("overseer.suspendSession", async (clickedNode?: TreeNode) => {
      await suspendSessions(selectedSessionNodes(clickedNode).map((node) => node.pinned));
    }),
    vscode.commands.registerCommand("overseer.suspendGroup", async (clickedNode?: TreeNode) => {
      const groupNode = clickedNode ?? treeView.selection[0];
      if (groupNode?.kind === "group") {
        await suspendSessions(groupNode.group.sessions);
      }
    }),
  ];
}

function pinnedSessionDirectory(pinned: PinnedSession): string | undefined {
  return pinned.meta?.resumeCwd ?? pinned.meta?.startCwd ?? pinned.pending?.cwd;
}

function isDefined<Value>(value: Value | undefined): value is Value {
  return value !== undefined;
}

function killProcess(pid: number, log: vscode.OutputChannel): void {
  try {
    process.kill(pid, "SIGTERM");
    log.appendLine(`Killed Claude process ${pid}`);
  } catch (error) {
    log.appendLine(`Could not kill Claude process ${pid}: ${String(error)}`);
  }
}
