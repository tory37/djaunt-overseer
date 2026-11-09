export interface JiraQuery {
  name: string;
  jql: string;
  fields: string[];
  intervalMinutes: number;
}

export interface JiraIssueRow {
  key: string;
  url?: string;
  values: Record<string, unknown>;
}

export interface JiraSearchPage {
  issues: JiraIssueRow[];
  nextPageToken?: string;
}

export const DEFAULT_QUERY_FIELDS = ["key", "summary", "status", "assignee", "updated"];
export const DEFAULT_INTERVAL_MINUTES = 5;
export const MIN_INTERVAL_MINUTES = 1;
export const MAX_ISSUES_PER_QUERY = 100;
const SEARCH_PAGE_LIMIT = 50;
const FALLBACK_SEARCH_FIELD = "summary";
// The search always returns these, so asking for them is redundant.
const ALWAYS_RETURNED_FIELDS = new Set(["key", "url"]);

export const DEFAULT_JIRA_QUERIES: Array<Pick<JiraQuery, "name" | "jql">> = [
  { name: "Blocked", jql: 'assignee = currentUser() AND status = "Blocked"' },
  { name: "To Do", jql: 'assignee = currentUser() AND status = "To Do"' },
  { name: "In Progress", jql: 'assignee = currentUser() AND status = "In Progress"' },
  { name: "Peer Review", jql: 'assignee = currentUser() AND status = "Peer Review"' },
  { name: "QA", jql: 'assignee = currentUser() AND (status = "Ready for QA" OR status = "IN QA")' },
  { name: "Ready to Ship", jql: 'assignee = currentUser() AND status = "Ready to Ship"' },
  { name: "CR Validating", jql: 'assignee WAS currentUser() AND status = "CR Validating"' },
];

export function readJiraQueries(raw: unknown): JiraQuery[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((entry): JiraQuery[] => {
    const jql = isRecord(entry) ? nonEmptyString(entry.jql) : undefined;
    if (!isRecord(entry) || jql === undefined) {
      return [];
    }
    return [
      {
        name: nonEmptyString(entry.name) ?? jql,
        jql,
        fields: readFields(entry.fields),
        intervalMinutes: readInterval(entry.intervalMinutes),
      },
    ];
  });
}

export function searchArgs(jql: string, fields: string[], pageToken?: string): Record<string, unknown> {
  const requestedFields = fields.filter((field) => !ALWAYS_RETURNED_FIELDS.has(field));
  const fieldList = requestedFields.length > 0 ? requestedFields.join(",") : FALLBACK_SEARCH_FIELD;
  const args: Record<string, unknown> = { action: "search", jql, fields: fieldList, limit: SEARCH_PAGE_LIMIT, response_format: "json" };
  if (pageToken !== undefined) {
    args.next_page_token = pageToken;
  }
  return args;
}

// Parses the Jira MCP server's `jira_issues search` envelope; entries without a key are left out.
export function parseSearchPage(envelopeText: string): JiraSearchPage {
  const envelope = parseJsonObject(envelopeText);
  if (envelope?.success !== true || !Array.isArray(envelope.data)) {
    return { issues: [] };
  }
  const issues = envelope.data.flatMap((issue): JiraIssueRow[] =>
    isRecord(issue) && typeof issue.key === "string"
      ? [{ key: issue.key, url: nonEmptyString(issue.url), values: issue }]
      : [],
  );
  const pagination = isRecord(envelope.pagination) ? envelope.pagination : undefined;
  const nextPageToken = pagination?.has_more_pages === true ? nonEmptyString(pagination.next_page_token) : undefined;
  return nextPageToken === undefined ? { issues } : { issues, nextPageToken };
}

export function searchError(envelopeText: string): string | undefined {
  const envelope = parseJsonObject(envelopeText);
  if (envelope?.success !== false) {
    return undefined;
  }
  const message = envelope.error ?? envelope.message;
  return typeof message === "string" ? message : "the search failed";
}

export function cellText(issue: JiraIssueRow, field: string): string {
  if (field === "key") {
    return issue.key;
  }
  const customFields = isRecord(issue.values.custom_fields) ? issue.values.custom_fields : {};
  return valueText(issue.values[field] ?? customFields[field]);
}

function valueText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(valueText).join(", ");
  }
  if (isRecord(value)) {
    const label = value.displayName ?? value.name ?? value.value;
    return typeof label === "string" ? label : "";
  }
  return "";
}

function readFields(raw: unknown): string[] {
  const fields = Array.isArray(raw) ? raw.filter((field): field is string => nonEmptyString(field) !== undefined) : [];
  return fields.length > 0 ? fields : [...DEFAULT_QUERY_FIELDS];
}

function readInterval(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) ? Math.max(raw, MIN_INTERVAL_MINUTES) : DEFAULT_INTERVAL_MINUTES;
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
