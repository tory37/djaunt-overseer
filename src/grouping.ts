import { displayTitle, SessionMeta } from "./indexer";
import { autoGroupRef, GroupRef, UNGROUPED_REF, UserGroup, userGroupRef } from "./registry";
import { extractTicketKey } from "./ticket";

export type GroupKind = "user" | "auto" | "ungrouped";

export interface PinnedSession {
  sessionId: string;
  meta: SessionMeta | undefined;
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
}

export function autoGroupRefFor(meta: SessionMeta | undefined): GroupRef {
  if (meta === undefined) {
    return UNGROUPED_REF;
  }
  const ticketKey = extractTicketKey({
    title: displayTitle(meta),
    gitBranch: meta.gitBranch,
    firstPrompt: meta.firstPrompt,
  });
  return ticketKey === undefined ? UNGROUPED_REF : autoGroupRef(ticketKey);
}

export function buildGroups(input: GroupingInput): SessionGroup[] {
  const userGroupRefs = new Set(input.userGroups.map((group) => userGroupRef(group.id)));
  const sessionsByRef = new Map<GroupRef, PinnedSession[]>();

  for (const sessionId of input.pinnedSessionIds) {
    const pinnedSession = { sessionId, meta: input.sessionsById.get(sessionId) };
    const groupRef = resolveGroupRef(input.assignments[sessionId], pinnedSession.meta, userGroupRefs);
    const groupSessions = sessionsByRef.get(groupRef) ?? [];
    groupSessions.push(pinnedSession);
    sessionsByRef.set(groupRef, groupSessions);
  }
  sessionsByRef.forEach((groupSessions) => groupSessions.sort(byMostRecentActivity));

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

  return [...userGroups, ...autoGroups, ...ungroupedGroups];
}

// An explicit drag wins, unless it points at a user group that was since deleted.
function resolveGroupRef(
  assignedRef: GroupRef | undefined,
  meta: SessionMeta | undefined,
  userGroupRefs: Set<GroupRef>,
): GroupRef {
  const isStaleUserGroup = assignedRef?.startsWith("user:") && !userGroupRefs.has(assignedRef);
  if (assignedRef !== undefined && !isStaleUserGroup) {
    return assignedRef;
  }
  return autoGroupRefFor(meta);
}

function byMostRecentActivity(left: PinnedSession, right: PinnedSession): number {
  return (right.meta?.lastActivityMs ?? 0) - (left.meta?.lastActivityMs ?? 0);
}
