import { describe, expect, it } from "vitest";
import { issueMatchesFilter, parseFilter, scopedFilterText } from "../../src/jiraFilter";
import { JiraIssueRow } from "../../src/jiraQueries";

const FIELDS = ["key", "summary", "status", "updated", "assignee", "priority", "sprint", "fixVersions"];

function issue(key: string, values: Record<string, unknown> = {}): JiraIssueRow {
  return { key, values: { key, ...values } };
}

const releaseIssue = issue("ASSMNT-12", {
  summary: "Fix the login loop",
  status: "In Progress",
  updated: "2026-11-09T09:00:00.000-0500",
  assignee: { displayName: "Tory Hebert" },
  priority: { name: "High" },
  sprint: [{ id: 6117, name: "Assess 2026.11.08", state: "active" }],
  fixVersions: [{ name: "r2026.11.12" }, { name: "r2026.12.03" }],
});
const unassignedIssue = issue("ASSMNT-13", { summary: "Add export", status: "To Do", assignee: null });

function matches(text: string, target: JiraIssueRow = releaseIssue, currentUserName?: string): boolean {
  return issueMatchesFilter(target, FIELDS, parseFilter(text), currentUserName);
}

describe("parseFilter", () => {
  it("splits on whitespace and keeps quoted values whole", () => {
    expect(parseFilter('r2026  sprint:"Assess 2026"')).toEqual([
      { value: "r2026" },
      { field: "sprint", value: "assess 2026" },
    ]);
    expect(parseFilter('"login loop"')).toEqual([{ value: "login loop" }]);
  });

  it("maps field aliases, ignoring case", () => {
    const fields = parseFilter("fix:a FixVersion:a version:a RELEASE:a who:a pri:a type:a key:a summary:a status:a").map((term) => term.field);
    expect(fields).toEqual(["fixVersions", "fixVersions", "fixVersions", "fixVersions", "assignee", "priority", "issuetype", "key", "summary", "status"]);
  });

  it("treats an unknown prefix as free text", () => {
    expect(parseFilter("labels:ops")).toEqual([{ value: "labels:ops" }]);
    expect(parseFilter('"fix:r1"')).toEqual([{ value: "fix:r1" }]);
  });

  it("drops terms with an empty value", () => {
    expect(parseFilter('fix: sprint:"" ""')).toEqual([]);
    expect(parseFilter("")).toEqual([]);
  });
});

describe("issueMatchesFilter", () => {
  it("matches everything with no terms", () => {
    expect(matches("")).toBe(true);
    expect(matches("", unassignedIssue)).toBe(true);
  });

  it("matches free text across key, summary, status, and details, ignoring case", () => {
    expect(matches("assmnt-12")).toBe(true);
    expect(matches("LOGIN")).toBe(true);
    expect(matches("progress")).toBe(true);
    expect(matches("tory")).toBe(true);
    expect(matches("high")).toBe(true);
    expect(matches("assess 2026")).toBe(true);
    expect(matches("r2026.12")).toBe(true);
    expect(matches("nowhere")).toBe(false);
  });

  it("leaves raw date values out of free text", () => {
    expect(matches("2026-11-09")).toBe(false);
  });

  it("needs every term to match", () => {
    expect(matches("login high")).toBe(true);
    expect(matches("login low")).toBe(false);
  });

  it("matches any of several fix versions", () => {
    expect(matches("fix:r2026.11.12")).toBe(true);
    expect(matches("release:r2026.12.03")).toBe(true);
    expect(matches("fix:r2027")).toBe(false);
  });

  it("matches the sprint by name", () => {
    expect(matches('sprint:"assess 2026.11"')).toBe(true);
    expect(matches("sprint:other")).toBe(false);
  });

  it("checks a scoped term against that field only", () => {
    expect(matches("status:login")).toBe(false);
    expect(matches("summary:login")).toBe(true);
    expect(matches("key:ASSMNT-12")).toBe(true);
  });

  it("matches assignee:me only for the current user", () => {
    expect(matches("assignee:me", releaseIssue, "tory hebert")).toBe(true);
    expect(matches("me", releaseIssue, "Tory Hebert")).toBe(true);
    expect(matches("assignee:me", releaseIssue, "Ana Ruiz")).toBe(false);
    expect(matches("assignee:me", releaseIssue)).toBe(false);
  });

  it("matches assignee:unassigned and assignee:none for an empty assignee", () => {
    expect(matches("assignee:unassigned", unassignedIssue)).toBe(true);
    expect(matches("who:none", unassignedIssue)).toBe(true);
    expect(matches("unassigned", unassignedIssue)).toBe(true);
    expect(matches("assignee:unassigned")).toBe(false);
  });

  it("matches a scoped term only on fields the query asked for", () => {
    expect(issueMatchesFilter(releaseIssue, ["key", "summary"], parseFilter("fix:r2026"))).toBe(false);
    expect(issueMatchesFilter(releaseIssue, ["key", "summary"], parseFilter("high"))).toBe(false);
  });
});

describe("scopedFilterText", () => {
  it("uses the short prefix and quotes values with spaces", () => {
    expect(scopedFilterText("fixVersions", "r2026.11.12")).toBe("fix:r2026.11.12");
    expect(scopedFilterText("sprint", "Assess 2026.11.08")).toBe('sprint:"Assess 2026.11.08"');
  });

  it("round-trips through parseFilter", () => {
    expect(parseFilter(scopedFilterText("assignee", "Ana Ruiz"))).toEqual([{ field: "assignee", value: "ana ruiz" }]);
  });
});
