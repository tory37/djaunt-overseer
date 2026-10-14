import { randomUUID } from "crypto";
import * as vscode from "vscode";
import { Registry } from "./registry";
import { DEFAULT_WORKSPACE_ID, Workspace, workspaceContentsLabel } from "./workspaces";

export interface WorkspaceDependencies {
  registry: Registry;
}

interface WorkspaceActionItem extends vscode.QuickPickItem {
  runAction: () => Promise<void>;
}

const DELETE_CHOICE = "Delete";

export function registerWorkspaceCommands(dependencies: WorkspaceDependencies): vscode.Disposable[] {
  const { registry } = dependencies;

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

  const switchTo = async (workspaceId: string): Promise<void> => {
    if (workspaceId !== registry.activeWorkspaceId()) {
      await registry.setActiveWorkspace(workspaceId);
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
