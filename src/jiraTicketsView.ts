import { jiraStatusColorId } from "./jira";
import {
  currentUserFilterText,
  FilterTerm,
  isFilterableField,
  isSameUser,
  issueMatchesFilter,
  noValueFilterText,
  noValueText,
  scopedFilterText,
  unassignedFilterText,
} from "./jiraFilter";
import { cellText, cellTexts, JiraIssueRow, JiraQuery, parseIsoTimestamp } from "./jiraQueries";
import { themeColorValue } from "./statusConfig";

export interface QueryRunState {
  query: JiraQuery;
  issues: JiraIssueRow[];
  hasMore: boolean;
  error?: string;
  isRunning: boolean;
  lastCheckedMs?: number;
}

export type JiraDetailTone = "attention" | "muted";

export interface JiraFilterChip {
  text: string;
  filterText: string;
  title: string;
}

export interface JiraDetailView {
  field: string;
  label: string;
  text: string;
  title: string;
  icon?: string;
  tone?: JiraDetailTone;
  isEmpty?: boolean;
  filterChips?: JiraFilterChip[];
}

export interface JiraRowView {
  key: string;
  url?: string;
  title: string;
  status?: string;
  statusColor?: string;
  statusFilterChip?: JiraFilterChip;
  age?: string;
  ageTitle?: string;
  summary?: string;
  details: JiraDetailView[];
}

export interface JiraSectionView {
  queryIndex: number;
  name: string;
  headerTitle: string;
  countText: string;
  isLoading: boolean;
  isQuiet: boolean;
  error?: string;
  rows: JiraRowView[];
  hasMore: boolean;
  shownCount: number;
  matchCount: number;
  totalCount: number;
  hiddenByFilter: boolean;
  searchUrl?: string;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const ASSIGNEE_FIELD = "assignee";
const ASSIGNEE_ICON = "account";
const SELF_ASSIGNEE_TEXT = "Me";
const UNASSIGNED_TEXT = "Unassigned";
const FIELD_LABELS: Record<string, string> = { issuetype: "type", sprint: "Sprint", fixVersions: "Fix versions" };
const DETAIL_ICONS: Record<string, string> = {
  priority: "arrow-up",
  issuetype: "tag",
  sprint: "history",
  fixVersions: "milestone",
};
const LEADING_DETAIL_FIELDS = [ASSIGNEE_FIELD, "priority", "sprint", "fixVersions"];

export function queryIdentity(query: JiraQuery): string {
  return JSON.stringify([query.name, query.jql, query.fields]);
}

// Keeps the last results of a query whose name, JQL, and fields are unchanged, so a settings edit doesn't blank the view.
export function reconcileQueryStates(previous: QueryRunState[], queries: JiraQuery[]): QueryRunState[] {
  const previousByIdentity = new Map(previous.map((state) => [queryIdentity(state.query), state]));
  return queries.map((query) => {
    const kept = previousByIdentity.get(queryIdentity(query));
    return kept === undefined ? { query, issues: [], hasMore: false, isRunning: false } : { ...kept, query };
  });
}

export function isQueryDue(lastCheckedMs: number | undefined, intervalMinutes: number, nowMs: number): boolean {
  return lastCheckedMs === undefined || nowMs - lastCheckedMs >= intervalMinutes * MINUTE_MS;
}

export function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n").find((line) => line.trim() !== "")?.trim() ?? "the search failed";
}

export function relativeAge(atMs: number, nowMs: number): string {
  const elapsedMs = Math.max(0, nowMs - atMs);
  if (elapsedMs < MINUTE_MS) {
    return "now";
  }
  if (elapsedMs < HOUR_MS) {
    return `${Math.floor(elapsedMs / MINUTE_MS)}m`;
  }
  if (elapsedMs < DAY_MS) {
    return `${Math.floor(elapsedMs / HOUR_MS)}h`;
  }
  if (elapsedMs < WEEK_MS) {
    return `${Math.floor(elapsedMs / DAY_MS)}d`;
  }
  return `${Math.floor(elapsedMs / WEEK_MS)}w`;
}

export function jqlSearchUrl(issueUrl: string | undefined, jql: string): string | undefined {
  if (issueUrl === undefined) {
    return undefined;
  }
  try {
    return `${new URL(issueUrl).origin}/issues/?jql=${encodeURIComponent(jql)}`;
  } catch {
    return undefined;
  }
}

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

export function sectionView(
  state: QueryRunState,
  queryIndex: number,
  nowMs: number,
  currentUserName?: string,
  filterTerms: FilterTerm[] = [],
): JiraSectionView {
  const { query, issues } = state;
  const hasChecked = state.lastCheckedMs !== undefined;
  const isFiltering = filterTerms.length > 0;
  const matchingIssues = issues.filter((issue) => issueMatchesFilter(issue, query.fields, filterTerms, currentUserName));
  const totalText = state.hasMore ? `${issues.length}+` : String(issues.length);
  const section: JiraSectionView = {
    queryIndex,
    name: query.name,
    headerTitle: headerTitle(state, nowMs),
    countText: isFiltering ? `${matchingIssues.length}/${totalText}` : totalText,
    isLoading: state.isRunning || !hasChecked,
    isQuiet: hasChecked && issues.length === 0 && state.error === undefined,
    rows: matchingIssues.map((issue) => rowView(issue, query.fields, nowMs, currentUserName)),
    hasMore: state.hasMore,
    shownCount: issues.length,
    matchCount: matchingIssues.length,
    totalCount: issues.length,
    hiddenByFilter: isFiltering && matchingIssues.length === 0,
  };
  const searchUrl = jqlSearchUrl(issues[0]?.url, query.jql);
  if (searchUrl !== undefined) {
    section.searchUrl = searchUrl;
  }
  if (state.error !== undefined) {
    section.error = state.error;
  }
  return section;
}

function headerTitle(state: QueryRunState, nowMs: number): string {
  const cadence = `every ${state.query.intervalMinutes} min`;
  if (state.lastCheckedMs === undefined) {
    return `Not checked yet · ${cadence}\n${state.query.jql}`;
  }
  const age = relativeAge(state.lastCheckedMs, nowMs);
  const checked = age === "now" ? "Checked just now" : `Checked ${age} ago`;
  return `${checked} · ${cadence}\n${state.query.jql}`;
}

// The key always shows: it names the row and is what a click opens.
export function rowView(issue: JiraIssueRow, fields: string[], nowMs: number, currentUserName?: string): JiraRowView {
  const summary = cellText(issue, "summary");
  const row: JiraRowView = {
    key: issue.key,
    title: summary === "" ? issue.key : `${issue.key} · ${summary}`,
    details: [],
  };
  if (issue.url !== undefined) {
    row.url = issue.url;
  }
  for (const field of fields) {
    if (field !== "key" && field !== ASSIGNEE_FIELD) {
      placeField(row, issue, field, nowMs);
    }
  }
  if (fields.includes(ASSIGNEE_FIELD)) {
    row.details.push(assigneeDetail(cellText(issue, ASSIGNEE_FIELD), currentUserName));
  }
  row.details.sort((first, second) => detailRank(first.field) - detailRank(second.field));
  return row;
}

function detailRank(field: string): number {
  const leadingIndex = LEADING_DETAIL_FIELDS.indexOf(field);
  return leadingIndex === -1 ? LEADING_DETAIL_FIELDS.length : leadingIndex;
}

// Until the current user's name is known, a named assignee shows with no tone rather than as someone else.
function assigneeDetail(assigneeName: string, currentUserName: string | undefined): JiraDetailView {
  const label = fieldLabel(ASSIGNEE_FIELD);
  const detail: JiraDetailView = {
    field: ASSIGNEE_FIELD,
    label,
    text: assigneeName,
    title: `${label}: ${assigneeName}`,
    icon: ASSIGNEE_ICON,
  };
  if (assigneeName === "") {
    const filterChips = [filterChip(label, UNASSIGNED_TEXT, unassignedFilterText())];
    return { ...detail, text: UNASSIGNED_TEXT, title: `${label}: ${UNASSIGNED_TEXT}`, tone: "attention", filterChips };
  }
  const isCurrentUser = currentUserName !== undefined && isSameUser(assigneeName, currentUserName);
  if (isCurrentUser) {
    return { ...detail, text: SELF_ASSIGNEE_TEXT, tone: "muted", filterChips: [filterChip(label, SELF_ASSIGNEE_TEXT, currentUserFilterText())] };
  }
  const filterChips = [filterChip(label, assigneeName, scopedFilterText(ASSIGNEE_FIELD, assigneeName))];
  return currentUserName === undefined ? { ...detail, filterChips } : { ...detail, tone: "attention", filterChips };
}

function filterChip(label: string, text: string, filterText: string): JiraFilterChip {
  return { text, filterText, title: `Filter by ${label}: ${text}` };
}

function fieldFilterChips(issue: JiraIssueRow, field: string, label: string): JiraFilterChip[] | undefined {
  if (!isFilterableField(field)) {
    return undefined;
  }
  return cellTexts(issue, field).map((value) => filterChip(label, value, scopedFilterText(field, value)));
}

function noValueDetail(field: string, emptyText: string): JiraDetailView {
  const label = fieldLabel(field);
  const detail: JiraDetailView = {
    field,
    label,
    text: emptyText,
    title: `${label}: none`,
    tone: "muted",
    isEmpty: true,
    filterChips: [{ text: emptyText, filterText: noValueFilterText(field), title: `Filter by tickets with no ${label}` }],
  };
  const icon = DETAIL_ICONS[field];
  return icon === undefined ? detail : { ...detail, icon };
}

function placeField(row: JiraRowView, issue: JiraIssueRow, field: string, nowMs: number): void {
  const text = cellText(issue, field);
  if (text === "") {
    const emptyText = noValueText(field);
    if (emptyText !== undefined) {
      row.details.push(noValueDetail(field, emptyText));
    }
    return;
  }
  if (field === "summary") {
    row.summary = text;
    return;
  }
  if (field === "status") {
    row.status = text;
    row.statusColor = themeColorValue(jiraStatusColorId(text));
    row.statusFilterChip = filterChip(fieldLabel(field), text, scopedFilterText(field, text));
    return;
  }
  const label = fieldLabel(field);
  const timestampMs = parseIsoTimestamp(text);
  if (timestampMs !== undefined) {
    const age = relativeAge(timestampMs, nowMs);
    const fullDate = new Date(timestampMs).toLocaleString();
    if (row.age === undefined) {
      row.age = age;
      row.ageTitle = fullDate;
      return;
    }
    row.details.push({ field, label, text: age, title: `${label}: ${fullDate}` });
    return;
  }
  const detail: JiraDetailView = { field, label, text, title: `${label}: ${text}` };
  const icon = DETAIL_ICONS[field];
  if (icon !== undefined) {
    detail.icon = icon;
  }
  const filterChips = fieldFilterChips(issue, field, label);
  if (filterChips !== undefined) {
    detail.filterChips = filterChips;
  }
  row.details.push(detail);
}
