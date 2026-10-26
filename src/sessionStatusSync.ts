import * as path from "path";
import { isTicketKey } from "./ticket";

const OVERSEER_DIR_NAME = "overseer";
export const STATUS_SYNC_SCHEMA_VERSION = 1;
const MAX_REASON_CHARS = 200;

// A status the user can pick, as the agent sees it.
export interface StatusOption {
  id: string;
  name: string;
  asksReason: boolean;
  done: boolean;
}

export interface TicketStatusFact {
  key: string;
  status: string;
  summary?: string;
}

// What the extension knows about one session, written for `overseer status list`.
export interface StatusContext {
  currentStatusId?: string;
  tickets: TicketStatusFact[];
}

// The agent's ask to set the session's overall status. The extension applies it and deletes the file.
export interface StatusRequest {
  statusId: string;
  reason?: string;
}

export function statusOptionsFile(claudeHome: string): string {
  return path.join(claudeHome, OVERSEER_DIR_NAME, "status-options.json");
}

export function statusContextFile(claudeHome: string, sessionId: string): string {
  return path.join(statusContextDir(claudeHome), `${sessionId}.json`);
}

export function statusContextDir(claudeHome: string): string {
  return path.join(claudeHome, OVERSEER_DIR_NAME, "status-context");
}

export function statusRequestFile(claudeHome: string, sessionId: string): string {
  return path.join(statusRequestsDir(claudeHome), `${sessionId}.json`);
}

export function statusRequestsDir(claudeHome: string): string {
  return path.join(claudeHome, OVERSEER_DIR_NAME, "status-requests");
}

export function readStatusOptions(entries: unknown): StatusOption[] {
  if (!Array.isArray(entries)) {
    return [];
  }
  const options: StatusOption[] = [];
  for (const entry of entries) {
    const { id, name, asksReason, done } = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
    if (typeof id === "string" && id !== "" && typeof name === "string" && name !== "") {
      options.push({ id, name, asksReason: asksReason === true, done: done === true });
    }
  }
  return options;
}

export function readStatusContext(entries: unknown): StatusContext {
  const fields = (typeof entries === "object" && entries !== null ? entries : {}) as Record<string, unknown>;
  const tickets: TicketStatusFact[] = [];
  for (const entry of Array.isArray(fields.tickets) ? fields.tickets : []) {
    const { key, status, summary } = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
    if (typeof key === "string" && isTicketKey(key) && typeof status === "string" && status !== "") {
      tickets.push({ key, status, ...(typeof summary === "string" && summary !== "" ? { summary } : {}) });
    }
  }
  return { ...(typeof fields.currentStatusId === "string" ? { currentStatusId: fields.currentStatusId } : {}), tickets };
}

export function readStatusRequest(entries: unknown): StatusRequest | undefined {
  const { statusId, reason } = (typeof entries === "object" && entries !== null ? entries : {}) as Record<string, unknown>;
  if (typeof statusId !== "string" || statusId === "") {
    return undefined;
  }
  return { statusId, ...(typeof reason === "string" && reason.trim() !== "" ? { reason: clipReason(reason) } : {}) };
}

export function clipReason(reason: string): string {
  return reason.replace(/\s+/g, " ").trim().slice(0, MAX_REASON_CHARS);
}

// The agent may give the id or the name, in any case.
export function resolveStatusOption(options: StatusOption[], requested: string): StatusOption | undefined {
  const wanted = requested.trim().toLowerCase();
  return options.find((option) => option.id === wanted) ?? options.find((option) => option.name.toLowerCase() === wanted);
}

export function doneStatusOption(options: StatusOption[]): StatusOption | undefined {
  return options.find((option) => option.done);
}

export function formatStatusList(options: StatusOption[], context: StatusContext): string {
  if (options.length === 0) {
    return "No statuses are set up. The user has not configured any in Overseer.";
  }
  const current = options.find((option) => option.id === context.currentStatusId);
  const optionLines = options.map((option) => `  ${option.id}  (${option.name}${option.asksReason ? ", give a reason" : ""})`);
  const ticketLines =
    context.tickets.length === 0
      ? ["  none known yet"]
      : context.tickets.map((ticket) => `  ${ticket.key}  ${ticket.status}${ticket.summary === undefined ? "" : `  (${ticket.summary})`}`);
  return [
    `Session status: ${current === undefined ? "not set" : `${current.id} (${current.name})`}`,
    "Options:",
    ...optionLines,
    "Tickets in Jira:",
    ...ticketLines,
  ].join("\n");
}
