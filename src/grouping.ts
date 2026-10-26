import { displayTitle, SessionMeta } from "./indexer";
import {
  GroupRef,
  PendingSession,
  TerminalSession,
  UNGROUPED_REF,
  UserGroup,
  userGroupRef,
} from "./registry";
import { sortBySavedOrder } from "./reorder";

export type GroupKind = "user" | "ungrouped";

export type SessionSection = "claude" | "terminal";

export interface PinnedSession {
  sessionId: string;
  meta: SessionMeta | undefined;
  label: string | undefined;
  pending: PendingSession | undefined;
  terminal?: TerminalSession;
}

const SHORT_ID_LENGTH = 8;

export function pinnedSessionTitle(pinned: PinnedSession): string {
  if (pinned.label !== undefined) {
    return pinned.label;
  }
  if (pinned.meta !== undefined) {
    return displayTitle(pinned.meta);
  }
  if (pinned.terminal !== undefined) {
    return "Terminal";
  }
  return pinned.pending !== undefined ? "New session" : `Session ${pinned.sessionId.slice(0, SHORT_ID_LENGTH)}`;
}

export interface SessionGroup {
  ref: GroupRef;
  kind: GroupKind;
  label: string;
  sessions: PinnedSession[];
}

export interface GroupingInput {
  pinnedSessionIds: string[];
  sessionsById: Map<string, SessionMeta>;
  userGroups: UserGroup[];
  assignments: Record<string, GroupRef>;
  labels: Record<string, string>;
  pendingSessions: Record<string, PendingSession>;
  terminalSessions?: Record<string, TerminalSession>;
  groupOrder: GroupRef[];
  sessionOrder: string[];
}

export function buildGroups(input: GroupingInput): SessionGroup[] {
  const userGroupRefs = new Set(input.userGroups.map((group) => userGroupRef(group.id)));
  const sessionsByRef = new Map<GroupRef, PinnedSession[]>();

  for (const sessionId of input.pinnedSessionIds) {
    const meta = input.sessionsById.get(sessionId);
    const pinnedSession: PinnedSession = {
      sessionId,
      meta,
      label: input.labels[sessionId],
      // The registry keeps a pending entry after the transcript appears, so a transcript ends pending.
      pending: meta === undefined ? input.pendingSessions[sessionId] : undefined,
      terminal: input.terminalSessions?.[sessionId],
    };
    const groupRef = resolveGroupRef(input.assignments[sessionId], userGroupRefs);
    const groupSessions = sessionsByRef.get(groupRef) ?? [];
    groupSessions.push(pinnedSession);
    sessionsByRef.set(groupRef, groupSessions);
  }
  sessionsByRef.forEach((groupSessions, groupRef) => {
    const sessionsByRecency = [...groupSessions].sort(byMostRecentActivity);
    sessionsByRef.set(groupRef, sortBySavedOrder(sessionsByRecency, input.sessionOrder, (pinned) => pinned.sessionId));
  });

  const userGroups: SessionGroup[] = input.userGroups.map((group) => ({
    ref: userGroupRef(group.id),
    kind: "user",
    label: group.name,
    sessions: sessionsByRef.get(userGroupRef(group.id)) ?? [],
  }));
  const ungroupedSessions = sessionsByRef.get(UNGROUPED_REF) ?? [];
  const ungroupedGroups: SessionGroup[] =
    ungroupedSessions.length > 0
      ? [{ ref: UNGROUPED_REF, kind: "ungrouped", label: "Ungrouped", sessions: ungroupedSessions }]
      : [];

  return sortBySavedOrder([...userGroups, ...ungroupedGroups], input.groupOrder, (group) => group.ref);
}

// Only the Sessions view keeps empty user groups; the Terminals view lists the groups that hold a terminal.
export function buildSectionGroups(input: GroupingInput, section: SessionSection): SessionGroup[] {
  const terminalSessions = input.terminalSessions ?? {};
  const wantsTerminals = section === "terminal";
  const sectionSessionIds = input.pinnedSessionIds.filter(
    (sessionId) => (terminalSessions[sessionId] !== undefined) === wantsTerminals,
  );
  const sectionGroups = buildGroups({ ...input, pinnedSessionIds: sectionSessionIds });
  return wantsTerminals ? sectionGroups.filter((group) => group.sessions.length > 0) : sectionGroups;
}

// A deleted user group or an old ticket group ref from an earlier version falls back to Ungrouped.
function resolveGroupRef(assignedRef: GroupRef | undefined, userGroupRefs: Set<GroupRef>): GroupRef {
  return assignedRef !== undefined && userGroupRefs.has(assignedRef) ? assignedRef : UNGROUPED_REF;
}

function byMostRecentActivity(left: PinnedSession, right: PinnedSession): number {
  return lastActivityMs(right) - lastActivityMs(left);
}

export function lastActivityMs(pinned: PinnedSession): number {
  return pinned.meta?.lastActivityMs ?? pinned.pending?.createdAtMs ?? pinned.terminal?.createdAtMs ?? 0;
}
