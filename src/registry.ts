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

  notifyExternalChange(): void {
    this.changeListeners.forEach((listener) => listener());
  }

  private async write(key: string, value: unknown): Promise<void> {
    await this.store.update(key, value);
    this.notifyExternalChange();
  }
}
