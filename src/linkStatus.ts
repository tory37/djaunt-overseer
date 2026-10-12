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
// `title` is the PR title or ticket summary; `parentKey` and `branch` place the link in the resources tree.
export interface LinkStatus {
  text: string;
  colorKey: string;
  title?: string;
  parentKey?: string;
  branch?: string;
}

const REVIEW_DECISION_KEYS: Record<string, PrStatusKey> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes requested",
  REVIEW_REQUIRED: "review required",
};

const DONE_STATUS_PATTERN = /done|closed|deployed|shipped|resolved|complete/i;

export function prStatusArgs(prUrl: string): string[] {
  return ["pr", "view", prUrl, "--json", "state,isDraft,reviewDecision,title,headRefName"];
}

// Parses `gh pr view --json state,isDraft,reviewDecision,title,headRefName`.
export function parsePrStatus(prJson: string): LinkStatus | undefined {
  const pr = parseJsonObject(prJson);
  const prState = prStateStatus(pr);
  if (prState === undefined) {
    return undefined;
  }
  const title = typeof pr?.title === "string" && pr.title !== "" ? pr.title : undefined;
  const branch = typeof pr?.headRefName === "string" && pr.headRefName !== "" ? pr.headRefName : undefined;
  return withDefinedFields({ ...prState, title, branch });
}

function prStateStatus(pr: Record<string, unknown> | undefined): LinkStatus | undefined {
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

export function ticketStatus(statusName: string, summary?: string, parentKey?: string): LinkStatus {
  return withDefinedFields({ text: statusName, colorKey: statusName, title: summary, parentKey });
}

// Keeps optional fields off the object when unknown, so equality checks and stored JSON stay minimal.
function withDefinedFields(status: LinkStatus): LinkStatus {
  return Object.fromEntries(Object.entries(status).filter(([, value]) => value !== undefined)) as unknown as LinkStatus;
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
