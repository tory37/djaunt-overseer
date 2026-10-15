import * as vscode from "vscode";
import { tabsToSnapshot, WorkspaceSnapshot } from "./workspaces";

const SAVE_AND_SWITCH_CHOICE = "Save All and Switch";
const UNTITLED_SCHEME = "untitled";

function textTabs(): { tab: vscode.Tab; uri: vscode.Uri }[] {
  return vscode.window.tabGroups.all.flatMap((group) =>
    group.tabs.flatMap((tab) => (tab.input instanceof vscode.TabInputText ? [{ tab, uri: tab.input.uri }] : [])),
  );
}

export function snapshotEditorTabs(): Pick<WorkspaceSnapshot, "tabUris" | "activeTabUri"> {
  const snapshotTabs = textTabs().map(({ tab, uri }) => ({
    uri: uri.toString(),
    isUntitled: uri.scheme === UNTITLED_SCHEME,
    isPinned: tab.isPinned,
  }));
  const activeInput = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  const activeUri = activeInput instanceof vscode.TabInputText ? activeInput.uri.toString() : undefined;
  return tabsToSnapshot(snapshotTabs, activeUri);
}

// Returns false when the user backs out or a save fails, so nothing closes with unsaved work.
export async function confirmSaveDirtyTabs(tabUris: string[]): Promise<boolean> {
  const dirtyDocuments = vscode.workspace.textDocuments.filter(
    (document) => document.isDirty && tabUris.includes(document.uri.toString()),
  );
  if (dirtyDocuments.length === 0) {
    return true;
  }
  const dirtyNames = dirtyDocuments.map((document) => vscode.workspace.asRelativePath(document.uri)).join(", ");
  const choice = await vscode.window.showWarningMessage(
    `Unsaved changes in: ${dirtyNames}.`,
    { modal: true, detail: "Switching closes these tabs. They reopen when you switch back." },
    SAVE_AND_SWITCH_CHOICE,
  );
  if (choice !== SAVE_AND_SWITCH_CHOICE) {
    return false;
  }
  const saveResults = await Promise.all(dirtyDocuments.map((document) => document.save()));
  return saveResults.every((isSaved) => isSaved);
}

// Tab objects go stale after a save, so the tabs are found again by URI right before closing.
export async function closeEditorTabs(tabUris: string[]): Promise<void> {
  const tabsToClose = textTabs()
    .filter(({ tab, uri }) => !tab.isPinned && tabUris.includes(uri.toString()))
    .map(({ tab }) => tab);
  if (tabsToClose.length > 0) {
    await vscode.window.tabGroups.close(tabsToClose, true);
  }
}

// A file deleted or moved since the snapshot is skipped and returned, so it can be reported.
export async function reopenEditorTabs(tabUris: string[], activeTabUri: string | undefined): Promise<string[]> {
  const missingUris: string[] = [];
  for (const tabUri of tabUris) {
    try {
      await vscode.window.showTextDocument(vscode.Uri.parse(tabUri), { preview: false, preserveFocus: true });
    } catch {
      missingUris.push(tabUri);
    }
  }
  if (activeTabUri !== undefined && !missingUris.includes(activeTabUri)) {
    await vscode.window.showTextDocument(vscode.Uri.parse(activeTabUri), { preview: false, preserveFocus: true });
  }
  return missingUris;
}
