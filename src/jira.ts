export interface JiraTransition {
  name: string;
  toStatus: string;
}

export interface IssueFacts {
  status: string;
  parentKey: string | undefined;
  summary: string | undefined;
}

export interface JiraWorkflow {
  currentStatus: string | undefined;
  statuses: string[];
  transitions: JiraTransition[];
}

const TICKET_KEY_PATTERN = /^([A-Z][A-Z0-9]+)-\d+$/;

// Status words map to a theme color id; the first match wins, so "Ready for QA" is ready, not QA.
const STATUS_COLOR_RULES: Array<{ pattern: RegExp; colorId: string }> = [
  { pattern: /block|hold|reject|fail/i, colorId: "overseer.ticketBlocked" },
  { pattern: /done|closed|deployed|shipped|resolved|complete/i, colorId: "overseer.ticketDone" },
  { pattern: /removed|won'?t|cancel|duplicate/i, colorId: "overseer.ticketRemoved" },
  { pattern: /ready/i, colorId: "overseer.ticketReady" },
  { pattern: /review|approved/i, colorId: "overseer.ticketReview" },
  { pattern: /qa|test|validat|verif/i, colorId: "overseer.ticketQa" },
  { pattern: /progress|doing|develop/i, colorId: "overseer.ticketProgress" },
  { pattern: /to ?do|backlog|open|new|triage/i, colorId: "overseer.ticketTodo" },
];
const FALLBACK_STATUS_COLOR_ID = "overseer.ticketOther";

export function projectKeyOf(ticketKey: string): string | undefined {
  return TICKET_KEY_PATTERN.exec(ticketKey)?.[1];
}

export function jiraStatusColorId(statusName: string): string {
  return STATUS_COLOR_RULES.find((rule) => rule.pattern.test(statusName))?.colorId ?? FALLBACK_STATUS_COLOR_ID;
}

// Parses the Jira MCP server's `jira_issues get` envelope; failed tickets are left out.
export function parseIssueStatuses(envelopeText: string): Map<string, IssueFacts> {
  const issueStatuses = new Map<string, IssueFacts>();
  const envelope = parseJsonObject(envelopeText);
  const results = Array.isArray(envelope?.results) ? envelope.results : [];
  for (const result of results) {
    const issueData = isRecord(result) && result.success === true ? result.data : undefined;
    if (isRecord(issueData) && typeof issueData.key === "string" && typeof issueData.status === "string") {
      issueStatuses.set(issueData.key, {
        status: issueData.status,
        parentKey: nonEmptyString(issueData.parent),
        summary: nonEmptyString(issueData.summary),
      });
    }
  }
  return issueStatuses;
}

// Parses the Jira MCP server's `jira_issues get_workflow` envelope for one ticket.
export function parseWorkflow(envelopeText: string): JiraWorkflow | undefined {
  const envelope = parseJsonObject(envelopeText);
  const firstResult = Array.isArray(envelope?.results) ? envelope.results[0] : undefined;
  if (!isRecord(firstResult) || firstResult.success !== true || !Array.isArray(firstResult.statuses)) {
    return undefined;
  }
  const statuses = firstResult.statuses.filter((status): status is string => typeof status === "string");
  const transitions = Array.isArray(firstResult.transitions)
    ? firstResult.transitions.flatMap((transition): JiraTransition[] => {
        const isValid = isRecord(transition) && typeof transition.name === "string" && typeof transition.to_status === "string";
        return isValid ? [{ name: transition.name as string, toStatus: transition.to_status as string }] : [];
      })
    : [];
  const currentStatus = typeof firstResult.current_status === "string" ? firstResult.current_status : undefined;
  return { currentStatus, statuses, transitions };
}

export function issueStatusesArgs(ticketKeys: string[]): Record<string, unknown> {
  return { action: "get", issue_keys: ticketKeys, fields: "status,parent,summary", comment_limit: 0 };
}

export function workflowArgs(ticketKey: string): Record<string, unknown> {
  return { action: "get_workflow", issue_keys: [ticketKey] };
}

export function transitionArgs(ticketKey: string, transitionName: string): Record<string, unknown> {
  return { action: "transition", transitions: [[ticketKey, transitionName]] };
}

// A batch envelope can succeed overall while the one transition in it failed.
export function transitionError(envelopeText: string): string | undefined {
  const envelope = parseJsonObject(envelopeText);
  const firstResult = Array.isArray(envelope?.results) ? envelope.results[0] : undefined;
  if (isRecord(firstResult) && firstResult.success === true) {
    return undefined;
  }
  const message = isRecord(firstResult) ? (firstResult.error ?? firstResult.message) : envelope?.error;
  return typeof message === "string" ? message : "the transition failed";
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
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
