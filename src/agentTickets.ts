import * as path from "path";
import { isTicketKey } from "./ticket";

const OVERSEER_DIR_NAME = "overseer";
const DECLARED_DIR_NAME = "declared";
const USER_MARKS_DIR_NAME = "marks";
export const AGENT_TICKETS_SCHEMA_VERSION = 1;
const SAFE_SESSION_ID_PATTERN = /^[A-Za-z0-9-]+$/;

export interface DeclaredTicket {
  key: string;
  note?: string;
  addedAt: number;
}

export interface UserTicketMarks {
  pinned: string[];
  removed: string[];
}

export function declaredTicketsDir(claudeHome: string): string {
  return path.join(claudeHome, OVERSEER_DIR_NAME, DECLARED_DIR_NAME);
}

export function declaredTicketsFile(claudeHome: string, sessionId: string): string {
  return path.join(declaredTicketsDir(claudeHome), `${sessionId}.json`);
}

export function userTicketMarksFile(claudeHome: string, sessionId: string): string {
  return path.join(claudeHome, OVERSEER_DIR_NAME, USER_MARKS_DIR_NAME, `${sessionId}.json`);
}

// Session ids become file names, so anything that could escape the directory is refused.
export function isSafeSessionId(sessionId: string): boolean {
  return SAFE_SESSION_ID_PATTERN.test(sessionId);
}

export function normalizeTicketKey(rawKey: string): string | undefined {
  const upperKey = rawKey.trim().toUpperCase();
  return isTicketKey(upperKey) ? upperKey : undefined;
}

export function readDeclaredTickets(entries: unknown): DeclaredTicket[] {
  if (!Array.isArray(entries)) {
    return [];
  }
  const declaredTickets: DeclaredTicket[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const { key, note, addedAt } = entry as Record<string, unknown>;
    if (typeof key !== "string" || !isTicketKey(key)) {
      continue;
    }
    declaredTickets.push({
      key,
      ...(typeof note === "string" && note.length > 0 ? { note } : {}),
      addedAt: typeof addedAt === "number" ? addedAt : 0,
    });
  }
  return declaredTickets;
}

export function readUserTicketMarks(entries: unknown): UserTicketMarks {
  const marks = typeof entries === "object" && entries !== null ? (entries as Record<string, unknown>) : {};
  return { pinned: ticketKeysIn(marks.pinned), removed: ticketKeysIn(marks.removed) };
}

// Declaring a ticket again updates its note but keeps when it was first declared.
export function withDeclaredTicket(
  declaredTickets: DeclaredTicket[],
  key: string,
  note: string | undefined,
  now: number,
): DeclaredTicket[] {
  const existingTicket = declaredTickets.find((ticket) => ticket.key === key);
  const resolvedNote = note ?? existingTicket?.note;
  const updatedTicket: DeclaredTicket = {
    key,
    ...(resolvedNote !== undefined ? { note: resolvedNote } : {}),
    addedAt: existingTicket?.addedAt ?? now,
  };
  if (existingTicket === undefined) {
    return [...declaredTickets, updatedTicket];
  }
  return declaredTickets.map((ticket) => (ticket.key === key ? updatedTicket : ticket));
}

export function withoutDeclaredTicket(declaredTickets: DeclaredTicket[], key: string): DeclaredTicket[] {
  return declaredTickets.filter((ticket) => ticket.key !== key);
}

// A ticket the user removed stays out of the working list even if the agent declared it.
export function workingTicketKeys(declaredTickets: DeclaredTicket[], userMarks: UserTicketMarks): string[] {
  const removedKeys = new Set(userMarks.removed);
  const workingKeys = new Set<string>(userMarks.pinned);
  for (const ticket of declaredTickets) {
    workingKeys.add(ticket.key);
  }
  return [...workingKeys].filter((key) => !removedKeys.has(key));
}

export function formatTicketList(declaredTickets: DeclaredTicket[], userMarks: UserTicketMarks): string {
  const workingKeys = workingTicketKeys(declaredTickets, userMarks);
  if (workingKeys.length === 0 && userMarks.removed.length === 0) {
    return "No tickets declared for this session.";
  }
  const lines: string[] = [];
  if (workingKeys.length > 0) {
    lines.push("Working on:");
    for (const key of workingKeys) {
      lines.push(`  ${key}${workingTicketDetail(key, declaredTickets, userMarks)}`);
    }
  }
  if (userMarks.removed.length > 0) {
    lines.push("Removed by the user (do not declare again):");
    for (const key of userMarks.removed) {
      lines.push(`  ${key}`);
    }
  }
  return lines.join("\n");
}

function workingTicketDetail(key: string, declaredTickets: DeclaredTicket[], userMarks: UserTicketMarks): string {
  const declaredTicket = declaredTickets.find((ticket) => ticket.key === key);
  const details: string[] = [];
  if (declaredTicket?.note !== undefined) {
    details.push(declaredTicket.note);
  }
  if (userMarks.pinned.includes(key)) {
    details.push("pinned by the user");
  }
  return details.length > 0 ? `  (${details.join("; ")})` : "";
}

function ticketKeysIn(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((key): key is string => typeof key === "string" && isTicketKey(key));
}
