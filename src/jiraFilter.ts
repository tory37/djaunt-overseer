import { cellTexts, JiraIssueRow, parseIsoTimestamp } from "./jiraQueries";

export interface FilterTerm {
  field?: string;
  value: string;
}

const ASSIGNEE_FIELD = "assignee";
const CURRENT_USER_VALUE = "me";
const UNASSIGNED_VALUE = "unassigned";
const NO_VALUE_FILTER_VALUE = "none";
const NO_VALUE_FILTER_VALUES = new Set([NO_VALUE_FILTER_VALUE, "empty"]);
const UNASSIGNED_VALUES = new Set([UNASSIGNED_VALUE, ...NO_VALUE_FILTER_VALUES]);
const NO_VALUE_TEXTS: Record<string, string> = {
  priority: "No Priority",
  sprint: "No Sprint",
  fixVersions: "No Fix Versions",
};
const TERM_PATTERN = /(?:[^\s"]+|"[^"]*"?)+/g;
const QUOTE_PATTERN = /"/g;
const WHITESPACE_PATTERN = /\s/;
const FIELD_ALIASES: Record<string, string> = {
  fix: "fixVersions",
  fixversion: "fixVersions",
  fixversions: "fixVersions",
  version: "fixVersions",
  release: "fixVersions",
  sprint: "sprint",
  assignee: "assignee",
  who: "assignee",
  status: "status",
  priority: "priority",
  pri: "priority",
  type: "issuetype",
  issuetype: "issuetype",
  key: "key",
  summary: "summary",
};
const FILTER_PREFIXES: Record<string, string> = {
  fixVersions: "fix",
  sprint: "sprint",
  assignee: "assignee",
  priority: "priority",
  status: "status",
};

export function parseFilter(text: string): FilterTerm[] {
  const rawTerms = text.match(TERM_PATTERN) ?? [];
  return rawTerms.flatMap((rawTerm): FilterTerm[] => {
    const term = parseTerm(rawTerm);
    return term.value === "" ? [] : [term];
  });
}

// A colon inside quotes is part of the value, so only a colon before the first quote can scope a term.
function parseTerm(rawTerm: string): FilterTerm {
  const colonIndex = rawTerm.indexOf(":");
  const quoteIndex = rawTerm.indexOf('"');
  const isColonOutsideQuotes = colonIndex > 0 && (quoteIndex === -1 || colonIndex < quoteIndex);
  const field = isColonOutsideQuotes ? FIELD_ALIASES[rawTerm.slice(0, colonIndex).toLowerCase()] : undefined;
  if (field === undefined) {
    return { value: normalizedValue(rawTerm) };
  }
  return { field, value: normalizedValue(rawTerm.slice(colonIndex + 1)) };
}

function normalizedValue(text: string): string {
  return text.replace(QUOTE_PATTERN, "").trim().toLowerCase();
}

export function isFilterableField(field: string): boolean {
  return FILTER_PREFIXES[field] !== undefined;
}

export function scopedFilterText(field: string, value: string): string {
  const prefix = FILTER_PREFIXES[field] ?? field;
  const unquotedValue = value.replace(QUOTE_PATTERN, "");
  return WHITESPACE_PATTERN.test(unquotedValue) ? `${prefix}:"${unquotedValue}"` : `${prefix}:${unquotedValue}`;
}

export function currentUserFilterText(): string {
  return `${FILTER_PREFIXES[ASSIGNEE_FIELD]}:${CURRENT_USER_VALUE}`;
}

export function unassignedFilterText(): string {
  return `${FILTER_PREFIXES[ASSIGNEE_FIELD]}:${UNASSIGNED_VALUE}`;
}

export function noValueText(field: string): string | undefined {
  return NO_VALUE_TEXTS[field];
}

export function noValueFilterText(field: string): string {
  return `${FILTER_PREFIXES[field] ?? field}:${NO_VALUE_FILTER_VALUE}`;
}

export function isSameUser(firstName: string, secondName: string): boolean {
  return firstName.trim().toLowerCase() === secondName.trim().toLowerCase();
}

// Every term must match. Only the query's fields count: the search returns no others.
export function issueMatchesFilter(issue: JiraIssueRow, fields: string[], terms: FilterTerm[], currentUserName?: string): boolean {
  return terms.every((term) => termMatches(issue, fields, term, currentUserName));
}

function termMatches(issue: JiraIssueRow, fields: string[], term: FilterTerm, currentUserName: string | undefined): boolean {
  if (term.field === undefined) {
    return anyContains(freeTexts(issue, fields, currentUserName), term.value);
  }
  if (term.field !== "key" && !fields.includes(term.field)) {
    return false;
  }
  if (term.field === ASSIGNEE_FIELD) {
    return assigneeMatches(issue, term.value, currentUserName);
  }
  if (noValueText(term.field) !== undefined && NO_VALUE_FILTER_VALUES.has(term.value)) {
    return searchableTexts(issue, term.field).length === 0;
  }
  return anyContains(searchableTexts(issue, term.field), term.value);
}

function assigneeMatches(issue: JiraIssueRow, value: string, currentUserName: string | undefined): boolean {
  const assigneeNames = searchableTexts(issue, ASSIGNEE_FIELD);
  if (value === CURRENT_USER_VALUE) {
    return isAssignedTo(assigneeNames, currentUserName);
  }
  if (UNASSIGNED_VALUES.has(value)) {
    return assigneeNames.length === 0;
  }
  return anyContains(assigneeNames, value);
}

function freeTexts(issue: JiraIssueRow, fields: string[], currentUserName: string | undefined): string[] {
  const texts = [issue.key, ...fields.flatMap((field) => searchableTexts(issue, field))];
  if (fields.includes(ASSIGNEE_FIELD)) {
    const assigneeNames = searchableTexts(issue, ASSIGNEE_FIELD);
    if (assigneeNames.length === 0) {
      texts.push(UNASSIGNED_VALUE);
    } else if (isAssignedTo(assigneeNames, currentUserName)) {
      texts.push(CURRENT_USER_VALUE);
    }
  }
  for (const field of fields) {
    const emptyText = noValueText(field);
    if (emptyText !== undefined && searchableTexts(issue, field).length === 0) {
      texts.push(emptyText);
    }
  }
  return texts;
}

function isAssignedTo(assigneeNames: string[], userName: string | undefined): boolean {
  return userName !== undefined && assigneeNames.some((name) => isSameUser(name, userName));
}

// Dates show as ages, so their raw timestamps aren't searchable.
function searchableTexts(issue: JiraIssueRow, field: string): string[] {
  return cellTexts(issue, field).filter((text) => parseIsoTimestamp(text) === undefined);
}

function anyContains(texts: string[], lowercaseValue: string): boolean {
  return texts.some((text) => text.toLowerCase().includes(lowercaseValue));
}
