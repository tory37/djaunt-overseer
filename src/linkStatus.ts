export type LinkStatusTone = "open" | "draft" | "merged" | "closed" | "todo" | "active" | "done";

export interface LinkStatus {
  text: string;
  tone: LinkStatusTone;
}

const REVIEW_DECISION_TEXT: Record<string, string> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes requested",
  REVIEW_REQUIRED: "review required",
};

const JIRA_STATUS_CATEGORY_TONES: Record<string, LinkStatusTone> = {
  new: "todo",
  indeterminate: "active",
  done: "done",
};

export function prStatusArgs(prUrl: string): string[] {
  return ["pr", "view", prUrl, "--json", "state,isDraft,reviewDecision"];
}

export function ticketStatusArgs(ticketKey: string): string[] {
  return ["jira", "workitem", "view", ticketKey, "--json"];
}

// Parses `gh pr view --json state,isDraft,reviewDecision`.
export function parsePrStatus(prJson: string): LinkStatus | undefined {
  const pr = parseJsonObject(prJson);
  const state = pr?.state;
  if (state === "MERGED") {
    return { text: "merged", tone: "merged" };
  }
  if (state === "CLOSED") {
    return { text: "closed", tone: "closed" };
  }
  if (state !== "OPEN") {
    return undefined;
  }
  if (pr?.isDraft === true) {
    return { text: "draft", tone: "draft" };
  }
  const reviewText = typeof pr?.reviewDecision === "string" ? REVIEW_DECISION_TEXT[pr.reviewDecision] : undefined;
  return { text: reviewText === undefined ? "open" : `open · ${reviewText}`, tone: "open" };
}

// Parses `acli jira workitem view --json`, which follows the Jira REST issue shape.
export function parseTicketStatus(ticketJson: string): LinkStatus | undefined {
  const fields = parseJsonObject(ticketJson)?.fields;
  const status = isRecord(fields) ? fields.status : undefined;
  if (!isRecord(status) || typeof status.name !== "string") {
    return undefined;
  }
  const category = isRecord(status.statusCategory) ? status.statusCategory.key : undefined;
  const tone = typeof category === "string" ? JIRA_STATUS_CATEGORY_TONES[category] : undefined;
  return { text: status.name, tone: tone ?? "active" };
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
