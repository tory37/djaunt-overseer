export interface Workspace {
  id: string;
  name: string;
}

export const DEFAULT_WORKSPACE_ID = "default";
const DEFAULT_WORKSPACE: Workspace = { id: DEFAULT_WORKSPACE_ID, name: "Default" };

// What was running when the workspace was switched away from, so a switch back restarts only that.
export interface WorkspaceSnapshot {
  liveSessionIds: string[];
  openTerminalIds: string[];
  tabUris: string[];
  activeTabUri: string | undefined;
}

export const EMPTY_WORKSPACE_SNAPSHOT: WorkspaceSnapshot = { liveSessionIds: [], openTerminalIds: [], tabUris: [], activeTabUri: undefined };

// The parts of an editor tab a snapshot needs, so tab selection stays free of the vscode API.
export interface SnapshotTab {
  uri: string;
  isUntitled: boolean;
  isPinned: boolean;
}

// Untitled tabs can't reopen from a URI, and VS Code-pinned tabs stay open in every workspace.
export function tabsToSnapshot(tabs: SnapshotTab[], activeUri: string | undefined): Pick<WorkspaceSnapshot, "tabUris" | "activeTabUri"> {
  const tabUris = [...new Set(tabs.filter((tab) => !tab.isUntitled && !tab.isPinned).map((tab) => tab.uri))];
  const activeTabUri = activeUri !== undefined && tabUris.includes(activeUri) ? activeUri : undefined;
  return { tabUris, activeTabUri };
}

// Maps a session or group id to its workspace. An id with no entry belongs to the default workspace.
export type WorkspaceByItem = Record<string, string>;

// The default workspace is stored only once it is renamed, so it is added here when missing.
export function withDefaultWorkspace(storedWorkspaces: Workspace[]): Workspace[] {
  const hasDefault = storedWorkspaces.some((workspace) => workspace.id === DEFAULT_WORKSPACE_ID);
  return hasDefault ? storedWorkspaces : [DEFAULT_WORKSPACE, ...storedWorkspaces];
}

export function workspaceOf(itemId: string, workspaceByItem: WorkspaceByItem): string {
  return workspaceByItem[itemId] ?? DEFAULT_WORKSPACE_ID;
}

export function idsInWorkspace(itemIds: string[], workspaceByItem: WorkspaceByItem, workspaceId: string): string[] {
  return itemIds.filter((itemId) => workspaceOf(itemId, workspaceByItem) === workspaceId);
}

// Default membership is stored as a missing entry, so the map holds only the items that left Default.
export function assignWorkspace(workspaceByItem: WorkspaceByItem, itemIds: string[], workspaceId: string): WorkspaceByItem {
  const updatedMembership = { ...workspaceByItem };
  for (const itemId of itemIds) {
    if (workspaceId === DEFAULT_WORKSPACE_ID) {
      delete updatedMembership[itemId];
    } else {
      updatedMembership[itemId] = workspaceId;
    }
  }
  return updatedMembership;
}

export function workspaceContentsLabel(sessionCount: number, terminalCount: number): string {
  const parts = [
    sessionCount > 0 ? countLabel(sessionCount, "session") : undefined,
    terminalCount > 0 ? countLabel(terminalCount, "terminal") : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(" · ") : "empty";
}

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

// Items unpinned or moved to another workspace since the snapshot are not restarted. Tabs belong to no pin, so all reopen.
export function restorableSnapshot(snapshot: WorkspaceSnapshot, pinnedIdsInWorkspace: string[]): WorkspaceSnapshot {
  const isStillHere = (itemId: string): boolean => pinnedIdsInWorkspace.includes(itemId);
  return {
    ...snapshot,
    liveSessionIds: snapshot.liveSessionIds.filter(isStillHere),
    openTerminalIds: snapshot.openTerminalIds.filter(isStillHere),
  };
}

// Items of a deleted workspace fall back to Default by losing their entry.
export function dropWorkspace(workspaceByItem: WorkspaceByItem, workspaceId: string): WorkspaceByItem {
  return Object.fromEntries(Object.entries(workspaceByItem).filter(([, memberOf]) => memberOf !== workspaceId));
}
