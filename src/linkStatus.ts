export type PrStatusKey = "draft" | "open" | "review required" | "approved" | "changes requested" | "merged" | "closed";

export const PR_STATUS_KEYS: PrStatusKey[] = ["draft", "open", "review required", "approved", "changes requested", "merged", "closed"];

export const DEFAULT_PR_COLORS: Record<PrStatusKey, string> = {
  draft: "#8B8B8B",
  open: "#3FA45B",
  "review required": "#C08A00",
  approved: "#3A9C9E",
  "changes requested": "#C47520",
  merged: "#A371F7",
  closed: "#E5534B",
};

// `colorKey` names the status in the color config: a PR status key, or the Jira status name.
export interface LinkStatus {
  text: string;
  colorKey: string;
}

const REVIEW_DECISION_KEYS: Record<string, PrStatusKey> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes requested",
  REVIEW_REQUIRED: "review required",
};

const DONE_STATUS_PATTERN = /done|closed|deployed|shipped|resolved|complete/i;

export function prStatusArgs(prUrl: string): string[] {
  return ["pr", "view", prUrl, "--json", "state,isDraft,reviewDecision"];
}

// Parses `gh pr view --json state,isDraft,reviewDecision`.
export function parsePrStatus(prJson: string): LinkStatus | undefined {
  const pr = parseJsonObject(prJson);
  const state = pr?.state;
  if (state === "MERGED") {
    return { text: "merged", colorKey: "merged" };
  }
  if (state === "CLOSED") {
    return { text: "closed", colorKey: "closed" };
  }
  if (state !== "OPEN") {
    return undefined;
  }
  if (pr?.isDraft === true) {
    return { text: "draft", colorKey: "draft" };
  }
  const reviewKey = typeof pr?.reviewDecision === "string" ? REVIEW_DECISION_KEYS[pr.reviewDecision] : undefined;
  return reviewKey === undefined ? { text: "open", colorKey: "open" } : { text: `open · ${reviewKey}`, colorKey: reviewKey };
}

export function ticketStatus(statusName: string): LinkStatus {
  return { text: statusName, colorKey: statusName };
}

// Names a glyph in statusIcons, so the shape still tells merged from closed without color.
export function statusGlyph(kind: "pr" | "ticket", status: LinkStatus): string {
  if (kind === "ticket") {
    return DONE_STATUS_PATTERN.test(status.colorKey) ? "ticket-check" : "ticket";
  }
  const prGlyphs: Partial<Record<string, string>> = {
    draft: "git-pull-request-draft",
    merged: "git-merge",
    closed: "git-pull-request-closed",
  };
  return prGlyphs[status.colorKey] ?? "git-pull-request";
}

function parseJsonObject(jsonText: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(jsonText);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
