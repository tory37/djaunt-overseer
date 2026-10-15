import { randomUUID } from "crypto";
import * as vscode from "vscode";
import { PinnedSession } from "./grouping";
import { displayTitle, SessionMeta } from "./indexer";
import { LiveSessionMonitor } from "./liveSessions";
import { Registry } from "./registry";
import { SessionIndex } from "./sessionIndex";
import { closeEditorTabs, confirmSaveDirtyTabs, reopenEditorTabs, snapshotEditorTabs } from "./editorTabs";
import { busySessions, confirmStopBusySessions, runningClaudeSessions, suspendSessions } from "./suspend";
import { findSessionTerminal, openShellTerminal, resumeSession } from "./terminals";
import {
  DEFAULT_WORKSPACE_ID,
  EMPTY_WORKSPACE_SNAPSHOT,
  restorableSnapshot,
  Workspace,
  workspaceContentsLabel,
} from "./workspaces";

export interface WorkspaceDependencies {
  registry: Registry;
  sessionIndex: SessionIndex;
  liveMonitor: LiveSessionMonitor;
  // The sessions and terminals of the active workspace, as the sidebar shows them.
  pinnedSessions: () => PinnedSession[];
  log: vscode.OutputChannel;
}

const SWITCH_ANYWAY_CHOICE = "Switch Anyway";
const TERMINAL_FALLBACK_TITLE = "Terminal";

interface RestoreResult {
  skippedTitles: string[];
  missingFileNames: string[];
}

interface WorkspaceActionItem extends vscode.QuickPickItem {
  runAction: () => Promise<void>;
}

const DELETE_CHOICE = "Delete";

export function registerWorkspaceCommands(dependencies: WorkspaceDependencies): vscode.Disposable[] {
  const { registry, sessionIndex, liveMonitor, pinnedSessions, log } = dependencies;

  const statusBarItem = vscode.window.createStatusBarItem("overseer.workspace", vscode.StatusBarAlignment.Left, 100);
  statusBarItem.name = "Overseer Workspace";
  statusBarItem.command = "overseer.switchWorkspace";
  const updateStatusBar = (): void => {
    const activeName = registry.activeWorkspace().name;
    statusBarItem.text = `$(layers) ${activeName}`;
    statusBarItem.tooltip = `Overseer workspace: ${activeName}. Click to switch.`;
    statusBarItem.show();
  };
  updateStatusBar();

  const findSessionMeta = async (sessionId: string): Promise<SessionMeta | undefined> => {
    const isTarget = (session: SessionMeta): boolean => session.sessionId === sessionId;
    return sessionIndex.currentSessions.find(isTarget) ?? (await sessionIndex.refresh()).find(isTarget);
  };

  // Returns what could not come back, so it is reported together.
  const restoreWorkspace = async (workspaceId: string): Promise<RestoreResult> => {
    const snapshot = restorableSnapshot(registry.workspaceSnapshot(workspaceId), registry.pinnedSessionIdsInWorkspace(workspaceId));
    const liveSessions = await liveMonitor.refresh();
    const skippedTitles: string[] = [];
    for (const sessionId of snapshot.liveSessionIds) {
      const meta = await findSessionMeta(sessionId);
      const isRunningElsewhere = liveSessions.has(sessionId) && findSessionTerminal(sessionId) === undefined;
      if (meta === undefined || meta.resumeCwd === undefined || isRunningElsewhere) {
        skippedTitles.push(registry.labels()[sessionId] ?? (meta ? displayTitle(meta) : sessionId));
        continue;
      }
      resumeSession(meta, log);
    }
    const terminalSessions = registry.terminalSessions();
    for (const terminalId of snapshot.openTerminalIds) {
      const terminalSession = terminalSessions[terminalId];
      if (terminalSession === undefined) {
        continue;
      }
      const title = registry.labels()[terminalId] ?? TERMINAL_FALLBACK_TITLE;
      const terminal = openShellTerminal(terminalId, title, terminalSession.cwd, log);
      await registry.setTerminalShellPid(terminalId, await terminal?.processId);
    }
    const missingUris = await reopenEditorTabs(snapshot.tabUris, snapshot.activeTabUri);
    await registry.setWorkspaceSnapshot(workspaceId, EMPTY_WORKSPACE_SNAPSHOT);
    const missingFileNames = missingUris.map((missingUri) => vscode.workspace.asRelativePath(vscode.Uri.parse(missingUri)));
    return { skippedTitles, missingFileNames };
  };

  // Nothing closes until the busy and unsaved prompts pass, so Cancel leaves everything as it was.
  const switchTo = async (workspaceId: string): Promise<void> => {
    const fromWorkspaceId = registry.activeWorkspaceId();
    if (workspaceId === fromWorkspaceId) {
      return;
    }
    await liveMonitor.refresh();
    const currentSessions = pinnedSessions();
    const runningSessions = runningClaudeSessions(currentSessions);
    const isConfirmed = await confirmStopBusySessions(
      busySessions(runningSessions, liveMonitor),
      SWITCH_ANYWAY_CHOICE,
      "Switching suspends that work. The conversation up to now is kept and resumes when you switch back.",
    );
    if (!isConfirmed) {
      return;
    }
    const editorTabs = snapshotEditorTabs();
    if (!(await confirmSaveDirtyTabs(editorTabs.tabUris))) {
      return;
    }
    const openTerminals = currentSessions.filter(
      (pinned) => pinned.terminal !== undefined && findSessionTerminal(pinned.sessionId) !== undefined,
    );
    await registry.setWorkspaceSnapshot(fromWorkspaceId, {
      liveSessionIds: runningSessions.map((pinned) => pinned.sessionId),
      openTerminalIds: openTerminals.map((pinned) => pinned.sessionId),
      ...editorTabs,
    });

    const targetName = registry.workspaces().find((workspace) => workspace.id === workspaceId)?.name ?? workspaceId;
    const { skippedTitles, missingFileNames } = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Overseer: switching to ${targetName}…` },
      async () => {
        await suspendSessions(runningSessions);
        openTerminals.forEach((pinned) => findSessionTerminal(pinned.sessionId)?.dispose());
        await closeEditorTabs(editorTabs.tabUris);
        await registry.setActiveWorkspace(workspaceId);
        return restoreWorkspace(workspaceId);
      },
    );
    if (skippedTitles.length > 0) {
      void vscode.window.showInformationMessage(
        `Overseer: did not restart ${skippedTitles.join(", ")}. Each one is running elsewhere or its folder is unknown.`,
      );
    }
    if (missingFileNames.length > 0) {
      void vscode.window.showInformationMessage(`Overseer: did not reopen ${missingFileNames.join(", ")}. The file is gone.`);
    }
  };

  const contentsLabel = (workspaceId: string): string => {
    const sessionIds = registry.pinnedSessionIdsInWorkspace(workspaceId);
    const terminalSessions = registry.terminalSessions();
    const terminalCount = sessionIds.filter((sessionId) => terminalSessions[sessionId] !== undefined).length;
    return workspaceContentsLabel(sessionIds.length - terminalCount, terminalCount);
  };

  const askWorkspaceName = async (prompt: string, currentName?: string): Promise<string | undefined> => {
    const takenNames = registry
      .workspaces()
      .map((workspace) => workspace.name.toLowerCase())
      .filter((name) => name !== currentName?.toLowerCase());
    const enteredName = await vscode.window.showInputBox({
      prompt,
      value: currentName,
      placeHolder: "After hours",
      validateInput: (name) => (takenNames.includes(name.trim().toLowerCase()) ? "A workspace with that name exists." : undefined),
    });
    const trimmedName = enteredName?.trim();
    return trimmedName ? trimmedName : undefined;
  };

  const createWorkspace = async (): Promise<Workspace | undefined> => {
    const name = await askWorkspaceName("New workspace name");
    return name === undefined ? undefined : registry.createWorkspace(name, randomUUID());
  };

  const renameWorkspace = async (workspace: Workspace): Promise<void> => {
    const name = await askWorkspaceName("Rename workspace", workspace.name);
    if (name !== undefined && name !== workspace.name) {
      await registry.renameWorkspace(workspace.id, name);
    }
  };

  const deleteWorkspace = async (workspace: Workspace): Promise<void> => {
    const choice = await vscode.window.showWarningMessage(
      `Delete workspace "${workspace.name}"?`,
      { modal: true, detail: `Its ${contentsLabel(workspace.id)} and its groups move to Default.` },
      DELETE_CHOICE,
    );
    if (choice === DELETE_CHOICE) {
      await registry.deleteWorkspace(workspace.id);
    }
  };

  const showSwitcher = async (): Promise<void> => {
    const activeWorkspace = registry.activeWorkspace();
    const workspaceItems: WorkspaceActionItem[] = registry.workspaces().map((workspace) => {
      const isActive = workspace.id === activeWorkspace.id;
      return {
        label: `$(${isActive ? "layers-active" : "layers"}) ${workspace.name}`,
        description: isActive ? `current · ${contentsLabel(workspace.id)}` : contentsLabel(workspace.id),
        runAction: () => switchTo(workspace.id),
      };
    });
    const manageItems: WorkspaceActionItem[] = [
      {
        label: "$(add) New Workspace…",
        runAction: async () => {
          const createdWorkspace = await createWorkspace();
          if (createdWorkspace !== undefined) {
            await switchTo(createdWorkspace.id);
          }
        },
      },
      { label: `$(edit) Rename "${activeWorkspace.name}"…`, runAction: () => renameWorkspace(activeWorkspace) },
    ];
    if (activeWorkspace.id !== DEFAULT_WORKSPACE_ID) {
      manageItems.push({ label: `$(trash) Delete "${activeWorkspace.name}"…`, runAction: () => deleteWorkspace(activeWorkspace) });
    }
    const separator = { label: "Manage", kind: vscode.QuickPickItemKind.Separator } as WorkspaceActionItem;
    const pickedItem = await vscode.window.showQuickPick([...workspaceItems, separator, ...manageItems], {
      title: "Switch Workspace",
      placeHolder: "Pick a workspace",
    });
    await pickedItem?.runAction();
  };

  return [
    statusBarItem,
    registry.onDidChange(updateStatusBar),
    vscode.commands.registerCommand("overseer.switchWorkspace", showSwitcher),
    vscode.commands.registerCommand("overseer.newWorkspace", async () => {
      const createdWorkspace = await createWorkspace();
      if (createdWorkspace !== undefined) {
        await switchTo(createdWorkspace.id);
      }
    }),
    vscode.commands.registerCommand("overseer.renameWorkspace", () => renameWorkspace(registry.activeWorkspace())),
    vscode.commands.registerCommand("overseer.deleteWorkspace", async () => {
      const activeWorkspace = registry.activeWorkspace();
      if (activeWorkspace.id === DEFAULT_WORKSPACE_ID) {
        void vscode.window.showInformationMessage("Overseer: the Default workspace can't be deleted.");
        return;
      }
      await deleteWorkspace(activeWorkspace);
    }),
  ];
}

// The current workspace is left out, since moving there changes nothing.
export async function pickTargetWorkspace(registry: Registry): Promise<string | undefined> {
  const otherWorkspaces = registry.workspaces().filter((workspace) => workspace.id !== registry.activeWorkspaceId());
  const newItem = { label: "$(add) New Workspace…", workspaceId: undefined };
  const pickedItem = await vscode.window.showQuickPick(
    [...otherWorkspaces.map((workspace) => ({ label: `$(layers) ${workspace.name}`, workspaceId: workspace.id })), newItem],
    { title: "Move to Workspace" },
  );
  if (pickedItem === undefined || pickedItem.workspaceId !== undefined) {
    return pickedItem?.workspaceId;
  }
  const name = (await vscode.window.showInputBox({ prompt: "New workspace name", placeHolder: "After hours" }))?.trim();
  return name ? (await registry.createWorkspace(name, randomUUID())).id : undefined;
}
