import { hasWorkstreamEdits, readWorkstreamEdits, WorkstreamEdits } from "./workstreamEdits";
import {
  assignWorkspace,
  DEFAULT_WORKSPACE_ID,
  dropWorkspace,
  EMPTY_WORKSPACE_SNAPSHOT,
  idsInWorkspace,
  withDefaultWorkspace,
  Workspace,
  WorkspaceByItem,
  workspaceOf,
  WorkspaceSnapshot,
} from "./workspaces";

export interface KeyValueStore {
  get<Value>(key: string): Value | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

export interface UserGroup {
  id: string;
  name: string;
}

export const UNGROUPED_REF = "ungrouped";
export type GroupRef = string;

export function userGroupRef(groupId: string): GroupRef {
  return `user:${groupId}`;
}

const PINNED_KEY = "overseer.pinnedSessionIds";
const GROUPS_KEY = "overseer.userGroups";
const ASSIGNMENTS_KEY = "overseer.groupAssignments";
const LABELS_KEY = "overseer.sessionLabels";
const PENDING_KEY = "overseer.pendingSessions";
const GROUP_ORDER_KEY = "overseer.groupOrder";
const SESSION_ORDER_KEY = "overseer.sessionOrder";
const LINK_MARKS_KEY = "overseer.linkMarks";
const LINK_ORDER_KEY = "overseer.linkOrder";
// The first key held edits the old seed made up from link marks, so real user edits start fresh here.
const WORKSTREAM_EDITS_KEY = "overseer.workstreamEdits.v2";
const COLLAPSED_GROUPS_KEY = "overseer.collapsedGroupRefs";
const RESOURCE_SESSIONS_KEY = "overseer.resourceSessionIds";
const TERMINAL_SESSIONS_KEY = "overseer.terminalSessions";
const SESSION_STATUS_KEY = "overseer.sessionStatusIds";
const SESSION_STATUS_REASON_KEY = "overseer.sessionStatusReasons";
const WORKSPACES_KEY = "overseer.workspaces";
const ACTIVE_WORKSPACE_KEY = "overseer.activeWorkspaceId";
const SESSION_WORKSPACE_KEY = "overseer.workspaceOfSession";
const GROUP_WORKSPACE_KEY = "overseer.workspaceOfGroup";
const WORKSPACE_SNAPSHOTS_KEY = "overseer.workspaceSnapshots";

export type LinkMark = "pinned" | "removed";
export type LinkMarks = Record<string, LinkMark>;

export interface PendingSession {
  cwd: string;
  createdAtMs: number;
}

export interface TerminalSession {
  cwd: string;
  createdAtMs: number;
  shellPid?: number;
}

// Each field lives under its own key so two windows writing different fields don't clobber each other.
export class Registry {
  private readonly changeListeners: Array<() => void> = [];

  constructor(private readonly store: KeyValueStore) {}

  onDidChange(listener: () => void): { dispose(): void } {
    this.changeListeners.push(listener);
    return {
      dispose: () => {
        const listenerIndex = this.changeListeners.indexOf(listener);
        if (listenerIndex !== -1) {
          this.changeListeners.splice(listenerIndex, 1);
        }
      },
    };
  }

  pinnedSessionIds(): string[] {
    return this.store.get<string[]>(PINNED_KEY) ?? [];
  }

  isPinned(sessionId: string): boolean {
    return this.pinnedSessionIds().includes(sessionId);
  }

  // Pinning a session from another workspace brings it into the active one, so it shows up where it was opened.
  async pin(sessionId: string): Promise<void> {
    if (!this.isPinned(sessionId)) {
      await this.write(PINNED_KEY, [...this.pinnedSessionIds(), sessionId]);
    }
    if (workspaceOf(sessionId, this.sessionWorkspaces()) !== this.activeWorkspaceId()) {
      await this.moveToWorkspace([sessionId], this.activeWorkspaceId());
    }
  }

  pinnedSessionIdsInWorkspace(workspaceId: string): string[] {
    return idsInWorkspace(this.pinnedSessionIds(), this.sessionWorkspaces(), workspaceId);
  }

  pinnedSessionIdsInActiveWorkspace(): string[] {
    return this.pinnedSessionIdsInWorkspace(this.activeWorkspaceId());
  }

  async unpin(sessionId: string): Promise<void> {
    await this.write(PINNED_KEY, this.pinnedSessionIds().filter((pinnedId) => pinnedId !== sessionId));
    await this.write(SESSION_ORDER_KEY, this.sessionOrder().filter((orderedId) => orderedId !== sessionId));
    await this.write(RESOURCE_SESSIONS_KEY, this.resourceSessionIds().filter((foundId) => foundId !== sessionId));
    const { [sessionId]: _removedPending, ...remainingPending } = this.pendingSessions();
    await this.write(PENDING_KEY, remainingPending);
    const { [sessionId]: _removedTerminal, ...remainingTerminals } = this.terminalSessions();
    await this.write(TERMINAL_SESSIONS_KEY, remainingTerminals);
    await this.write(SESSION_WORKSPACE_KEY, assignWorkspace(this.sessionWorkspaces(), [sessionId], DEFAULT_WORKSPACE_ID));
  }

  userGroups(): UserGroup[] {
    return this.store.get<UserGroup[]>(GROUPS_KEY) ?? [];
  }

  userGroupsInActiveWorkspace(): UserGroup[] {
    const groupIds = idsInWorkspace(
      this.userGroups().map((group) => group.id),
      this.groupWorkspaces(),
      this.activeWorkspaceId(),
    );
    return this.userGroups().filter((group) => groupIds.includes(group.id));
  }

  async createGroup(name: string, groupId: string): Promise<UserGroup> {
    const newGroup = { id: groupId, name };
    await this.write(GROUPS_KEY, [...this.userGroups(), newGroup]);
    if (this.activeWorkspaceId() !== DEFAULT_WORKSPACE_ID) {
      await this.write(GROUP_WORKSPACE_KEY, assignWorkspace(this.groupWorkspaces(), [groupId], this.activeWorkspaceId()));
    }
    return newGroup;
  }

  async renameGroup(groupId: string, name: string): Promise<void> {
    const renamedGroups = this.userGroups().map((group) => (group.id === groupId ? { ...group, name } : group));
    await this.write(GROUPS_KEY, renamedGroups);
  }

  async deleteGroup(groupId: string): Promise<void> {
    const deletedRef = userGroupRef(groupId);
    const remainingAssignments = Object.fromEntries(
      Object.entries(this.assignments()).filter(([, groupRef]) => groupRef !== deletedRef),
    );
    await this.write(ASSIGNMENTS_KEY, remainingAssignments);
    await this.write(
      GROUPS_KEY,
      this.userGroups().filter((group) => group.id !== groupId),
    );
    await this.write(GROUP_WORKSPACE_KEY, assignWorkspace(this.groupWorkspaces(), [groupId], DEFAULT_WORKSPACE_ID));
  }

  assignments(): Record<string, GroupRef> {
    return this.store.get<Record<string, GroupRef>>(ASSIGNMENTS_KEY) ?? {};
  }

  async assign(sessionIds: string[], groupRef: GroupRef): Promise<void> {
    const updatedAssignments = { ...this.assignments() };
    for (const sessionId of sessionIds) {
      updatedAssignments[sessionId] = groupRef;
    }
    await this.write(ASSIGNMENTS_KEY, updatedAssignments);
  }

  groupOrder(): GroupRef[] {
    return this.store.get<GroupRef[]>(GROUP_ORDER_KEY) ?? [];
  }

  async setGroupOrder(groupRefs: GroupRef[]): Promise<void> {
    await this.write(GROUP_ORDER_KEY, groupRefs);
  }

  sessionOrder(): string[] {
    return this.store.get<string[]>(SESSION_ORDER_KEY) ?? [];
  }

  async setSessionOrder(sessionIds: string[]): Promise<void> {
    await this.write(SESSION_ORDER_KEY, sessionIds);
  }

  labels(): Record<string, string> {
    return this.store.get<Record<string, string>>(LABELS_KEY) ?? {};
  }

  async setLabel(sessionId: string, label: string): Promise<void> {
    await this.write(LABELS_KEY, { ...this.labels(), [sessionId]: label });
  }

  // A brand-new session has no transcript until Claude writes one, so the registry remembers where it started.
  pendingSessions(): Record<string, PendingSession> {
    return this.store.get<Record<string, PendingSession>>(PENDING_KEY) ?? {};
  }

  async addPendingSession(sessionId: string, pendingSession: PendingSession): Promise<void> {
    await this.write(PENDING_KEY, { ...this.pendingSessions(), [sessionId]: pendingSession });
  }

  // A plain shell has no transcript, so the registry is the only record of it.
  terminalSessions(): Record<string, TerminalSession> {
    return this.store.get<Record<string, TerminalSession>>(TERMINAL_SESSIONS_KEY) ?? {};
  }

  async addTerminalSession(sessionId: string, terminalSession: TerminalSession): Promise<void> {
    await this.write(TERMINAL_SESSIONS_KEY, { ...this.terminalSessions(), [sessionId]: terminalSession });
  }

  async setTerminalShellPid(sessionId: string, shellPid: number | undefined): Promise<void> {
    const terminalSession = this.terminalSessions()[sessionId];
    if (terminalSession !== undefined) {
      await this.write(TERMINAL_SESSIONS_KEY, { ...this.terminalSessions(), [sessionId]: { ...terminalSession, shellPid } });
    }
  }

  // Marks are keyed by link, not by scan, so a rescan or a new judge verdict keeps them.
  linkMarks(sessionId: string): LinkMarks {
    return this.allLinkMarks()[sessionId] ?? {};
  }

  async setLinkMark(sessionId: string, linkKeys: string[], mark: LinkMark | undefined): Promise<void> {
    const sessionMarks = { ...this.linkMarks(sessionId) };
    for (const linkKey of linkKeys) {
      if (mark === undefined) {
        delete sessionMarks[linkKey];
      } else {
        sessionMarks[linkKey] = mark;
      }
    }
    const { [sessionId]: _previousMarks, ...otherSessionMarks } = this.allLinkMarks();
    const hasMarks = Object.keys(sessionMarks).length > 0;
    await this.write(LINK_MARKS_KEY, hasMarks ? { ...otherSessionMarks, [sessionId]: sessionMarks } : otherSessionMarks);
  }

  // Copies only ticket marks: after /clear the terminal keeps working the same tickets, but other links belong to the old transcript.
  async copyTicketMarks(fromSessionId: string, toSessionId: string): Promise<void> {
    const ticketMarkEntries = Object.entries(this.linkMarks(fromSessionId)).filter(([linkKey]) => linkKey.startsWith("ticket:"));
    if (ticketMarkEntries.length === 0) {
      return;
    }
    const targetMarks = { ...Object.fromEntries(ticketMarkEntries), ...this.linkMarks(toSessionId) };
    await this.write(LINK_MARKS_KEY, { ...this.allLinkMarks(), [toSessionId]: targetMarks });
  }

  linkOrder(sessionId: string): string[] {
    return this.allLinkOrders()[sessionId] ?? [];
  }

  async setLinkOrder(sessionId: string, linkKeys: string[]): Promise<void> {
    await this.write(LINK_ORDER_KEY, { ...this.allLinkOrders(), [sessionId]: linkKeys });
  }

  workstreamEdits(sessionId: string): WorkstreamEdits {
    return readWorkstreamEdits(this.allWorkstreamEdits()[sessionId]);
  }

  hasStoredWorkstreamEdits(sessionId: string): boolean {
    return this.allWorkstreamEdits()[sessionId] !== undefined;
  }

  async setWorkstreamEdits(sessionId: string, edits: WorkstreamEdits): Promise<void> {
    const { [sessionId]: _previousEdits, ...otherSessionEdits } = this.allWorkstreamEdits();
    await this.write(WORKSTREAM_EDITS_KEY, hasWorkstreamEdits(edits) ? { ...otherSessionEdits, [sessionId]: edits } : otherSessionEdits);
  }

  // The analysis file moves with /clear and fork, so the edits that name its workstreams move too.
  async copyWorkstreamEdits(fromSessionId: string, toSessionId: string): Promise<void> {
    const fromEdits = this.allWorkstreamEdits()[fromSessionId];
    if (fromEdits !== undefined && !this.hasStoredWorkstreamEdits(toSessionId)) {
      await this.write(WORKSTREAM_EDITS_KEY, { ...this.allWorkstreamEdits(), [toSessionId]: fromEdits });
    }
  }

  resourceSessionIds(): string[] {
    return this.store.get<string[]>(RESOURCE_SESSIONS_KEY) ?? [];
  }

  hasFoundResources(sessionId: string): boolean {
    return this.resourceSessionIds().includes(sessionId);
  }

  async markResourcesFound(sessionId: string): Promise<void> {
    if (!this.hasFoundResources(sessionId)) {
      await this.write(RESOURCE_SESSIONS_KEY, [...this.resourceSessionIds(), sessionId]);
    }
  }

  sessionStatusIds(): Record<string, string> {
    return this.store.get<Record<string, string>>(SESSION_STATUS_KEY) ?? {};
  }

  sessionStatusReasons(): Record<string, string> {
    return this.store.get<Record<string, string>>(SESSION_STATUS_REASON_KEY) ?? {};
  }

  // An undefined status clears it. A reason belongs to one status, so setting any status replaces the old reason.
  async setSessionStatus(sessionIds: string[], statusId: string | undefined, reason?: string): Promise<void> {
    const statusIdBySession = { ...this.sessionStatusIds() };
    const reasonBySession = { ...this.sessionStatusReasons() };
    for (const sessionId of sessionIds) {
      delete reasonBySession[sessionId];
      if (statusId === undefined) {
        delete statusIdBySession[sessionId];
        continue;
      }
      statusIdBySession[sessionId] = statusId;
      if (reason !== undefined && reason !== "") {
        reasonBySession[sessionId] = reason;
      }
    }
    await this.write(SESSION_STATUS_KEY, statusIdBySession);
    await this.write(SESSION_STATUS_REASON_KEY, reasonBySession);
  }

  workspaces(): Workspace[] {
    return withDefaultWorkspace(this.store.get<Workspace[]>(WORKSPACES_KEY) ?? []);
  }

  // A stored id whose workspace was deleted, maybe from another window, falls back to Default.
  activeWorkspaceId(): string {
    const storedId = this.store.get<string>(ACTIVE_WORKSPACE_KEY);
    const isKnown = this.workspaces().some((workspace) => workspace.id === storedId);
    return isKnown && storedId !== undefined ? storedId : DEFAULT_WORKSPACE_ID;
  }

  activeWorkspace(): Workspace {
    return this.workspaces().find((workspace) => workspace.id === this.activeWorkspaceId()) ?? this.workspaces()[0];
  }

  async setActiveWorkspace(workspaceId: string): Promise<void> {
    await this.write(ACTIVE_WORKSPACE_KEY, workspaceId);
  }

  async createWorkspace(name: string, workspaceId: string): Promise<Workspace> {
    const newWorkspace = { id: workspaceId, name };
    await this.write(WORKSPACES_KEY, [...this.workspaces(), newWorkspace]);
    return newWorkspace;
  }

  async renameWorkspace(workspaceId: string, name: string): Promise<void> {
    const renamedWorkspaces = this.workspaces().map((workspace) =>
      workspace.id === workspaceId ? { ...workspace, name } : workspace,
    );
    await this.write(WORKSPACES_KEY, renamedWorkspaces);
  }

  // Its sessions and groups move to Default, so nothing pinned disappears.
  async deleteWorkspace(workspaceId: string): Promise<void> {
    if (workspaceId === DEFAULT_WORKSPACE_ID) {
      return;
    }
    if (this.activeWorkspaceId() === workspaceId) {
      await this.setActiveWorkspace(DEFAULT_WORKSPACE_ID);
    }
    await this.write(SESSION_WORKSPACE_KEY, dropWorkspace(this.sessionWorkspaces(), workspaceId));
    await this.write(GROUP_WORKSPACE_KEY, dropWorkspace(this.groupWorkspaces(), workspaceId));
    const { [workspaceId]: _droppedSnapshot, ...remainingSnapshots } = this.workspaceSnapshots();
    await this.write(WORKSPACE_SNAPSHOTS_KEY, remainingSnapshots);
    await this.write(
      WORKSPACES_KEY,
      this.workspaces().filter((workspace) => workspace.id !== workspaceId),
    );
  }

  async moveToWorkspace(sessionIds: string[], workspaceId: string): Promise<void> {
    await this.write(SESSION_WORKSPACE_KEY, assignWorkspace(this.sessionWorkspaces(), sessionIds, workspaceId));
  }

  // A group takes the sessions assigned to it along.
  async moveGroupToWorkspace(groupId: string, workspaceId: string): Promise<void> {
    const groupRef = userGroupRef(groupId);
    const groupSessionIds = Object.entries(this.assignments())
      .filter(([, assignedRef]) => assignedRef === groupRef)
      .map(([sessionId]) => sessionId);
    await this.write(GROUP_WORKSPACE_KEY, assignWorkspace(this.groupWorkspaces(), [groupId], workspaceId));
    await this.moveToWorkspace(groupSessionIds, workspaceId);
  }

  workspaceSnapshot(workspaceId: string): WorkspaceSnapshot {
    // Snapshots saved before tabs were tracked have no tab fields.
    return { ...EMPTY_WORKSPACE_SNAPSHOT, ...this.workspaceSnapshots()[workspaceId] };
  }

  // The tree doesn't show snapshots, so this write skips the change listeners.
  async setWorkspaceSnapshot(workspaceId: string, snapshot: WorkspaceSnapshot): Promise<void> {
    await this.store.update(WORKSPACE_SNAPSHOTS_KEY, { ...this.workspaceSnapshots(), [workspaceId]: snapshot });
  }

  isGroupCollapsed(groupRef: GroupRef): boolean {
    return (this.store.get<GroupRef[]>(COLLAPSED_GROUPS_KEY) ?? []).includes(groupRef);
  }

  // The tree already shows the new state, so this write skips the change listeners and the refresh it causes.
  async setGroupCollapsed(groupRef: GroupRef, isCollapsed: boolean): Promise<void> {
    const otherGroupRefs = (this.store.get<GroupRef[]>(COLLAPSED_GROUPS_KEY) ?? []).filter((ref) => ref !== groupRef);
    await this.store.update(COLLAPSED_GROUPS_KEY, isCollapsed ? [...otherGroupRefs, groupRef] : otherGroupRefs);
  }

  notifyExternalChange(): void {
    this.changeListeners.forEach((listener) => listener());
  }

  private sessionWorkspaces(): WorkspaceByItem {
    return this.store.get<WorkspaceByItem>(SESSION_WORKSPACE_KEY) ?? {};
  }

  private groupWorkspaces(): WorkspaceByItem {
    return this.store.get<WorkspaceByItem>(GROUP_WORKSPACE_KEY) ?? {};
  }

  private workspaceSnapshots(): Record<string, WorkspaceSnapshot> {
    return this.store.get<Record<string, WorkspaceSnapshot>>(WORKSPACE_SNAPSHOTS_KEY) ?? {};
  }

  allLinkMarks(): Record<string, LinkMarks> {
    return this.store.get<Record<string, LinkMarks>>(LINK_MARKS_KEY) ?? {};
  }

  private allWorkstreamEdits(): Record<string, unknown> {
    return this.store.get<Record<string, unknown>>(WORKSTREAM_EDITS_KEY) ?? {};
  }

  private allLinkOrders(): Record<string, string[]> {
    return this.store.get<Record<string, string[]>>(LINK_ORDER_KEY) ?? {};
  }

  // /clear and /resume swap the session under a running terminal, so the row moves to the new session in place.
  // Link marks and found resources describe the old transcript, so they stay with it.
  async moveSession(fromSessionId: string, toSessionId: string): Promise<void> {
    if (!this.isPinned(fromSessionId)) {
      return;
    }
    if (!this.isPinned(toSessionId)) {
      const swapId = (sessionId: string): string => (sessionId === fromSessionId ? toSessionId : sessionId);
      await this.write(PINNED_KEY, this.pinnedSessionIds().map(swapId));
      await this.write(SESSION_ORDER_KEY, this.sessionOrder().map(swapId));
      await this.write(LABELS_KEY, moveEntry(this.labels(), fromSessionId, toSessionId));
      await this.write(ASSIGNMENTS_KEY, moveEntry(this.assignments(), fromSessionId, toSessionId));
      await this.write(SESSION_STATUS_KEY, moveEntry(this.sessionStatusIds(), fromSessionId, toSessionId));
      await this.write(SESSION_STATUS_REASON_KEY, moveEntry(this.sessionStatusReasons(), fromSessionId, toSessionId));
      await this.write(SESSION_WORKSPACE_KEY, moveEntry(this.sessionWorkspaces(), fromSessionId, toSessionId));
      const movedSnapshots = Object.fromEntries(
        Object.entries(this.workspaceSnapshots()).map(([workspaceId, snapshot]) => [
          workspaceId,
          { ...snapshot, liveSessionIds: snapshot.liveSessionIds.map(swapId) },
        ]),
      );
      await this.store.update(WORKSPACE_SNAPSHOTS_KEY, movedSnapshots);
    }
    await this.unpin(fromSessionId);
  }

  // For a session whose transcript is gone: drops every field that names it, not only the pin.
  async forgetSessions(sessionIds: string[]): Promise<void> {
    const forgottenIds = new Set(sessionIds);
    const withoutForgotten = <Value>(record: Record<string, Value>): Record<string, Value> =>
      Object.fromEntries(Object.entries(record).filter(([sessionId]) => !forgottenIds.has(sessionId)));
    for (const sessionId of sessionIds) {
      await this.unpin(sessionId);
    }
    await this.write(LABELS_KEY, withoutForgotten(this.labels()));
    await this.write(ASSIGNMENTS_KEY, withoutForgotten(this.assignments()));
    await this.write(LINK_MARKS_KEY, withoutForgotten(this.allLinkMarks()));
    await this.write(LINK_ORDER_KEY, withoutForgotten(this.allLinkOrders()));
    await this.write(WORKSTREAM_EDITS_KEY, withoutForgotten(this.allWorkstreamEdits()));
    await this.write(SESSION_STATUS_KEY, withoutForgotten(this.sessionStatusIds()));
    await this.write(SESSION_STATUS_REASON_KEY, withoutForgotten(this.sessionStatusReasons()));
  }

  private async write(key: string, value: unknown): Promise<void> {
    await this.store.update(key, value);
    this.notifyExternalChange();
  }
}

// The target's old entry is dropped too, so a missing source value (like Default membership) carries over as missing.
function moveEntry<Value>(record: Record<string, Value>, fromKey: string, toKey: string): Record<string, Value> {
  const { [fromKey]: movedValue, [toKey]: _replacedValue, ...otherEntries } = record;
  return movedValue === undefined ? otherEntries : { ...otherEntries, [toKey]: movedValue };
}
