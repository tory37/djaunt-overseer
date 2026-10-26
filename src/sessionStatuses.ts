// Tree labels take only theme colors, so each status picks one of these contributed palette colors.
export const STATUS_COLORS = ["gray", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"] as const;

export type StatusColor = (typeof STATUS_COLORS)[number];

export interface SessionStatus {
  id: string;
  name: string;
  color: StatusColor;
  icon: string;
  badge: string;
  asksReason: boolean;
  done: boolean;
}

// A status as one session carries it: the reason is the note the user gave when setting it.
export interface MarkedStatus extends SessionStatus {
  reason?: string;
}

export const DEFAULT_SESSION_STATUSES: SessionStatus[] = [
  { id: "todo", name: "Todo", color: "gray", icon: "circle-large-outline", badge: "TD", asksReason: false, done: false },
  { id: "triage", name: "Triage", color: "orange", icon: "search", badge: "TR", asksReason: false, done: false },
  { id: "in-progress", name: "In Progress", color: "blue", icon: "play-circle", badge: "IP", asksReason: false, done: false },
  { id: "blocked", name: "Blocked", color: "red", icon: "circle-slash", badge: "BL", asksReason: true, done: false },
  { id: "ai-review", name: "AI Review", color: "purple", icon: "sparkle", badge: "AI", asksReason: false, done: false },
  { id: "human-review", name: "Human Review", color: "yellow", icon: "eye", badge: "HR", asksReason: false, done: false },
  { id: "ready-to-ship", name: "Ready to Ship", color: "green", icon: "rocket", badge: "RS", asksReason: false, done: false },
  { id: "done", name: "Done", color: "gray", icon: "pass", badge: "DN", asksReason: false, done: true },
];

export const MAX_BADGE_LENGTH = 2;
const DEFAULT_ICON = "circle-filled";
const CODICON_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*(~spin)?$/;

export function statusColorId(color: StatusColor): string {
  return `overseer.status${color[0].toUpperCase()}${color.slice(1)}`;
}

// A setting edited by hand can hold anything; bad entries drop out and bad fields fall back, so the tree never breaks.
export function parseSessionStatuses(configured: unknown): SessionStatus[] {
  if (!Array.isArray(configured)) {
    return DEFAULT_SESSION_STATUSES;
  }
  const statuses: SessionStatus[] = [];
  for (const entry of configured) {
    const status = parseSessionStatus(entry, statuses.map((existing) => existing.id));
    if (status !== undefined) {
      statuses.push(status);
    }
  }
  return statuses;
}

function parseSessionStatus(entry: unknown, takenIds: string[]): SessionStatus | undefined {
  if (typeof entry !== "object" || entry === null) {
    return undefined;
  }
  const fields = entry as Record<string, unknown>;
  const name = typeof fields.name === "string" ? fields.name.trim() : "";
  if (name === "") {
    return undefined;
  }
  const requestedId = typeof fields.id === "string" && fields.id.trim() !== "" ? fields.id.trim() : statusIdFor(name, []);
  const color = STATUS_COLORS.find((paletteColor) => paletteColor === fields.color) ?? "gray";
  const icon = typeof fields.icon === "string" && CODICON_NAME_PATTERN.test(fields.icon.trim()) ? fields.icon.trim() : DEFAULT_ICON;
  const badge = typeof fields.badge === "string" ? fields.badge.trim().slice(0, MAX_BADGE_LENGTH) : defaultBadge(name);
  const asksReason = fields.asksReason === true;
  const done = fields.done === true;
  const id = takenIds.includes(requestedId) ? statusIdFor(requestedId, takenIds) : requestedId;
  return { id, name, color, icon, badge, asksReason, done };
}

// Assignments store the id, so a status keeps its sessions when it is renamed.
export function statusIdFor(name: string, takenIds: string[]): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "status";
  let candidateId = slug;
  for (let suffix = 2; takenIds.includes(candidateId); suffix++) {
    candidateId = `${slug}-${suffix}`;
  }
  return candidateId;
}

export function defaultBadge(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word !== "");
  const initials = words.length > 1 ? words.map((word) => word[0]).join("") : (words[0] ?? "");
  return initials.slice(0, MAX_BADGE_LENGTH).toUpperCase();
}

// A session whose status was deleted from the setting shows no status, instead of a stale one.
export function statusOfSession(
  sessionId: string,
  statusIdBySession: Record<string, string>,
  statuses: SessionStatus[],
): SessionStatus | undefined {
  const statusId = statusIdBySession[sessionId];
  return statusId === undefined ? undefined : statuses.find((status) => status.id === statusId);
}

// The status that marks a session's work finished, so it is safe to kill and remove.
export function doneStatusOf(statuses: SessionStatus[]): SessionStatus | undefined {
  return statuses.find((status) => status.done);
}
