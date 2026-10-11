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

export function autoGroupRef(ticketKey: string): GroupRef {
  return `auto:${ticketKey}`;
}

const PINNED_KEY = "overseer.pinnedSessionIds";
const GROUPS_KEY = "overseer.userGroups";
const ASSIGNMENTS_KEY = "overseer.groupAssignments";
const LABELS_KEY = "overseer.sessionLabels";
const PENDING_KEY = "overseer.pendingSessions";
const GROUP_ORDER_KEY = "overseer.groupOrder";
const SESSION_ORDER_KEY = "overseer.sessionOrder";
const LINK_MARKS_KEY = "overseer.linkMarks";

export type LinkMark = "pinned" | "removed";
export type LinkMarks = Record<string, LinkMark>;

export interface PendingSession {
  cwd: string;
  createdAtMs: number;
}

// Each field lives under its own key so two windows writing different fields don't clobber each other.
export class Registry {
  private readonly changeListeners: Array<() => void> = [];

  constructor(private readonly store: KeyValueStore) {}

  onDidChange(listener: () => void): void {
    this.changeListeners.push(listener);
  }

  pinnedSessionIds(): string[] {
    return this.store.get<string[]>(PINNED_KEY) ?? [];
  }

  isPinned(sessionId: string): boolean {
    return this.pinnedSessionIds().includes(sessionId);
  }

  async pin(sessionId: string): Promise<void> {
    if (!this.isPinned(sessionId)) {
      await this.write(PINNED_KEY, [...this.pinnedSessionIds(), sessionId]);
    }
  }

  async unpin(sessionId: string): Promise<void> {
    await this.write(PINNED_KEY, this.pinnedSessionIds().filter((pinnedId) => pinnedId !== sessionId));
    await this.write(SESSION_ORDER_KEY, this.sessionOrder().filter((orderedId) => orderedId !== sessionId));
    const { [sessionId]: _removedPending, ...remainingPending } = this.pendingSessions();
    await this.write(PENDING_KEY, remainingPending);
  }

  userGroups(): UserGroup[] {
    return this.store.get<UserGroup[]>(GROUPS_KEY) ?? [];
  }

  async createGroup(name: string, groupId: string): Promise<UserGroup> {
    const newGroup = { id: groupId, name };
    await this.write(GROUPS_KEY, [...this.userGroups(), newGroup]);
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

  async replaceGroupRef(oldRef: GroupRef, newRef: GroupRef): Promise<void> {
    await this.write(
      GROUP_ORDER_KEY,
      this.groupOrder().map((groupRef) => (groupRef === oldRef ? newRef : groupRef)),
    );
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

  notifyExternalChange(): void {
    this.changeListeners.forEach((listener) => listener());
  }

  private allLinkMarks(): Record<string, LinkMarks> {
    return this.store.get<Record<string, LinkMarks>>(LINK_MARKS_KEY) ?? {};
  }

  private async write(key: string, value: unknown): Promise<void> {
    await this.store.update(key, value);
    this.notifyExternalChange();
  }
}
