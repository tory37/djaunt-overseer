import { randomUUID } from "crypto";
import * as vscode from "vscode";
import { pickSession } from "./quickPick";
import { Registry, userGroupRef } from "./registry";
import { SessionIndex } from "./sessionIndex";
import { findSessionTerminal, resumeSession } from "./terminals";
import { TreeNode } from "./tree";

export interface CommandDependencies {
  sessionIndex: SessionIndex;
  registry: Registry;
  treeView: vscode.TreeView<TreeNode>;
  log: vscode.OutputChannel;
}

type SessionNode = Extract<TreeNode, { kind: "session" }>;
type GroupNode = Extract<TreeNode, { kind: "group" }>;

export function registerCommands(dependencies: CommandDependencies): vscode.Disposable[] {
  const { sessionIndex, registry, treeView, log } = dependencies;

  const selectedSessionNodes = (clickedNode?: TreeNode): SessionNode[] => {
    const candidateNodes = clickedNode && !treeView.selection.includes(clickedNode) ? [clickedNode] : treeView.selection;
    return candidateNodes.filter((node): node is SessionNode => node.kind === "session");
  };

  const resumeSessionById = async (sessionId: string): Promise<void> => {
    const openTerminal = findSessionTerminal(sessionId);
    if (openTerminal) {
      openTerminal.show();
      return;
    }
    let meta = sessionIndex.currentSessions.find((session) => session.sessionId === sessionId);
    if (meta === undefined) {
      const refreshedSessions = await sessionIndex.refresh();
      meta = refreshedSessions.find((session) => session.sessionId === sessionId);
    }
    if (meta === undefined) {
      void vscode.window.showErrorMessage(`Overseer: no transcript found for session ${sessionId}.`);
      return;
    }
    resumeSession(meta, log);
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
      const pickedSession = await pickSession(sessionIndex, registry);
      if (pickedSession) {
        await registry.pin(pickedSession.sessionId);
        resumeSession(pickedSession, log);
      }
    }),
    vscode.commands.registerCommand("overseer.refreshIndex", () => sessionIndex.refresh()),
    vscode.commands.registerCommand("overseer.focusSession", (sessionId: string) => {
      findSessionTerminal(sessionId)?.show();
    }),
    vscode.commands.registerCommand("overseer.resumeSession", async (clickedNode?: TreeNode) => {
      for (const sessionNode of selectedSessionNodes(clickedNode)) {
        await resumeSessionById(sessionNode.pinned.sessionId);
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
