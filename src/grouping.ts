import { displayTitle, SessionMeta } from "./indexer";
import {
  autoGroupRef,
  GroupRef,
  PendingSession,
  TerminalSession,
  UNGROUPED_REF,
  UserGroup,
  userGroupRef,
} from "./registry";
import { sortBySavedOrder } from "./reorder";
import { extractTicketKey } from "./ticket";

export type GroupKind = "user" | "auto" | "ungrouped";

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
  linkedTicketKeys?: Record<string, string>;
}

export function autoGroupRefFor(meta: SessionMeta | undefined, label?: string, linkedTicketKey?: string): GroupRef {
  const ticketKey =
    extractTicketKey({ title: label }) ??
    (meta === undefined
      ? undefined
      : extractTicketKey({ title: displayTitle(meta), gitBranch: meta.gitBranch, firstPrompt: meta.firstPrompt })) ??
    linkedTicketKey;
  return ticketKey === undefined ? UNGROUPED_REF : autoGroupRef(ticketKey);
}

export function buildGroups(input: GroupingInput): SessionGroup[] {
  const userGroupRefs = new Set(input.userGroups.map((group) => userGroupRef(group.id)));
  const sessionsByRef = new Map<GroupRef, PinnedSession[]>();

  for (const sessionId of input.pinnedSessionIds) {
    const pinnedSession: PinnedSession = {
      sessionId,
      meta: input.sessionsById.get(sessionId),
      label: input.labels[sessionId],
      pending: input.pendingSessions[sessionId],
      terminal: input.terminalSessions?.[sessionId],
    };
    const linkedTicketKey = input.linkedTicketKeys?.[sessionId];
    const groupRef = resolveGroupRef(input.assignments[sessionId], pinnedSession, userGroupRefs, linkedTicketKey);
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
  const autoGroups: SessionGroup[] = [...sessionsByRef.entries()]
    .filter(([groupRef]) => groupRef.startsWith("auto:"))
    .map(([groupRef, groupSessions]) => ({
      ref: groupRef,
      kind: "auto" as const,
      label: groupRef.slice("auto:".length),
      sessions: groupSessions,
    }))
    .sort((left, right) => byMostRecentActivity(left.sessions[0], right.sessions[0]));
  const ungroupedSessions = sessionsByRef.get(UNGROUPED_REF) ?? [];
  const ungroupedGroups: SessionGroup[] =
    ungroupedSessions.length > 0
      ? [{ ref: UNGROUPED_REF, kind: "ungrouped", label: "Ungrouped", sessions: ungroupedSessions }]
      : [];

  return sortBySavedOrder([...userGroups, ...autoGroups, ...ungroupedGroups], input.groupOrder, (group) => group.ref);
}

// An explicit drag wins, unless it points at a user group that was since deleted.
function resolveGroupRef(
  assignedRef: GroupRef | undefined,
  pinnedSession: PinnedSession,
  userGroupRefs: Set<GroupRef>,
  linkedTicketKey: string | undefined,
): GroupRef {
  const isStaleUserGroup = assignedRef?.startsWith("user:") && !userGroupRefs.has(assignedRef);
  if (assignedRef !== undefined && !isStaleUserGroup) {
    return assignedRef;
  }
  return autoGroupRefFor(pinnedSession.meta, pinnedSession.label, linkedTicketKey);
}

function byMostRecentActivity(left: PinnedSession, right: PinnedSession): number {
  return lastActivityMs(right) - lastActivityMs(left);
}

function lastActivityMs(pinned: PinnedSession): number {
  return pinned.meta?.lastActivityMs ?? pinned.pending?.createdAtMs ?? pinned.terminal?.createdAtMs ?? 0;
}
