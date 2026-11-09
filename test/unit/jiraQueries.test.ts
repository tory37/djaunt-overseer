import { describe, expect, it } from "vitest";
import {
  cellText,
  DEFAULT_INTERVAL_MINUTES,
  DEFAULT_JIRA_QUERIES,
  DEFAULT_QUERY_FIELDS,
  JiraIssueRow,
  MIN_INTERVAL_MINUTES,
  parseSearchPage,
  readJiraQueries,
  searchArgs,
  searchError,
} from "../../src/jiraQueries";

describe("readJiraQueries", () => {
  it("returns nothing for a value that is not an array", () => {
    expect(readJiraQueries(undefined)).toEqual([]);
    expect(readJiraQueries({ jql: "x" })).toEqual([]);
    expect(readJiraQueries("x")).toEqual([]);
  });

  it("skips entries that are not objects or have no jql", () => {
    const raw = [null, "x", 3, [], { name: "No jql" }, { jql: "" }, { jql: "   " }, { jql: 7 }, { name: "Ok", jql: "a = b" }];
    expect(readJiraQueries(raw).map((query) => query.name)).toEqual(["Ok"]);
  });

  it("fills defaults and falls back to the jql for a name", () => {
    expect(readJiraQueries([{ jql: "status = Done" }])).toEqual([
      { name: "status = Done", jql: "status = Done", fields: DEFAULT_QUERY_FIELDS, intervalMinutes: DEFAULT_INTERVAL_MINUTES },
    ]);
    expect(readJiraQueries([{ name: "", jql: "a = b" }])[0].name).toBe("a = b");
  });

  it("keeps given fields and drops bad ones", () => {
    expect(readJiraQueries([{ jql: "a", fields: ["key", "", 3, "priority"] }])[0].fields).toEqual(["key", "priority"]);
    expect(readJiraQueries([{ jql: "a", fields: [] }])[0].fields).toEqual(DEFAULT_QUERY_FIELDS);
    expect(readJiraQueries([{ jql: "a", fields: "key" }])[0].fields).toEqual(DEFAULT_QUERY_FIELDS);
  });

  it("clamps the interval up to the minimum and ignores non-numbers", () => {
    const intervalOf = (intervalMinutes: unknown) => readJiraQueries([{ jql: "a", intervalMinutes }])[0].intervalMinutes;
    expect(intervalOf(0)).toBe(MIN_INTERVAL_MINUTES);
    expect(intervalOf(-5)).toBe(MIN_INTERVAL_MINUTES);
    expect(intervalOf(15)).toBe(15);
    expect(intervalOf(Number.NaN)).toBe(DEFAULT_INTERVAL_MINUTES);
    expect(intervalOf(Number.POSITIVE_INFINITY)).toBe(DEFAULT_INTERVAL_MINUTES);
    expect(intervalOf("10")).toBe(DEFAULT_INTERVAL_MINUTES);
  });

  it("reads every default query", () => {
    const queries = readJiraQueries(DEFAULT_JIRA_QUERIES);
    expect(queries).toHaveLength(7);
    expect(queries.map((query) => query.name)).toEqual([
      "Blocked",
      "To Do",
      "In Progress",
      "Peer Review",
      "QA",
      "Ready to Ship",
      "CR Validating",
    ]);
  });
});

describe("searchArgs", () => {
  it("drops key and url from the fields and omits a missing token", () => {
    expect(searchArgs("a = b", ["key", "summary", "status", "url"])).toEqual({
      action: "search",
      jql: "a = b",
      fields: "summary,status",
      limit: 50,
      response_format: "json",
    });
  });

  it("sends the page token when given", () => {
    expect(searchArgs("a = b", ["status"], "tok")).toMatchObject({ fields: "status", next_page_token: "tok" });
  });

  it("asks for summary when no other field is left", () => {
    expect(searchArgs("a = b", ["key", "url"]).fields).toBe("summary");
    expect(searchArgs("a = b", []).fields).toBe("summary");
  });
});

const LIVE_SEARCH_PAGE = JSON.stringify({
  success: true,
  data: [
    {
      key: "ASSMNT-2277",
      id: "139541",
      summary: "Fix scoring",
      status: "Ready to Ship",
      priority: "P2- Medium/Normal",
      issuetype: "Bug",
      assignee: "Tory Hebert",
      project: null,
      updated: "2026-11-09T11:07:36.289-0600",
      sprint: null,
      fixVersions: null,
      custom_fields: {},
      url: "https://istation.atlassian.net/browse/ASSMNT-2277",
    },
    { id: "no key" },
    "junk",
  ],
  total: 2,
  pagination: { has_more_pages: true, next_page_token: "Cl123" },
  jql_query: "assignee = currentUser()",
  api_version: "v3",
});

describe("parseSearchPage", () => {
  it("reads the live response shape and its next page token", () => {
    const page = parseSearchPage(LIVE_SEARCH_PAGE);
    expect(page.nextPageToken).toBe("Cl123");
    expect(page.issues).toHaveLength(1);
    expect(page.issues[0].key).toBe("ASSMNT-2277");
    expect(page.issues[0].url).toBe("https://istation.atlassian.net/browse/ASSMNT-2277");
    expect(page.issues[0].values.status).toBe("Ready to Ship");
  });

  it("has no token when there are no more pages", () => {
    const lastPage = JSON.stringify({
      success: true,
      data: [{ key: "A-1" }],
      pagination: { has_more_pages: false, next_page_token: "stale" },
    });
    expect(parseSearchPage(lastPage)).toEqual({ issues: [{ key: "A-1", url: undefined, values: { key: "A-1" } }] });
    const emptyToken = JSON.stringify({ success: true, data: [], pagination: { has_more_pages: true, next_page_token: "" } });
    expect(parseSearchPage(emptyToken).nextPageToken).toBeUndefined();
  });

  it("returns no issues for bad JSON, a failure, or missing data", () => {
    expect(parseSearchPage("not json")).toEqual({ issues: [] });
    expect(parseSearchPage(JSON.stringify({ success: false, data: [{ key: "A-1" }] }))).toEqual({ issues: [] });
    expect(parseSearchPage(JSON.stringify({ success: true }))).toEqual({ issues: [] });
  });
});

describe("searchError", () => {
  it("returns the failure message, or nothing on success", () => {
    expect(searchError(JSON.stringify({ success: false, error: "Bad JQL" }))).toBe("Bad JQL");
    expect(searchError(JSON.stringify({ success: false, message: "Rate limited" }))).toBe("Rate limited");
    expect(searchError(JSON.stringify({ success: false }))).toBe("the search failed");
    expect(searchError(LIVE_SEARCH_PAGE)).toBeUndefined();
    expect(searchError("not json")).toBeUndefined();
  });
});

describe("cellText", () => {
  const issue: JiraIssueRow = {
    key: "A-1",
    values: {
      key: "A-1",
      summary: "Fix it",
      story_points: 3,
      flagged: false,
      sprint: null,
      labels: ["ui", 2, { name: "backend" }],
      assignee: { displayName: "Tory", name: "tory" },
      reporter: { name: "sam" },
      priority: { value: "High" },
      blob: { other: 1 },
      custom_fields: { team: "Assessments", summary: "shadowed" },
    },
  };

  it("reads each value kind", () => {
    expect(cellText(issue, "key")).toBe("A-1");
    expect(cellText(issue, "summary")).toBe("Fix it");
    expect(cellText(issue, "story_points")).toBe("3");
    expect(cellText(issue, "flagged")).toBe("false");
    expect(cellText(issue, "sprint")).toBe("");
    expect(cellText(issue, "labels")).toBe("ui, 2, backend");
    expect(cellText(issue, "assignee")).toBe("Tory");
    expect(cellText(issue, "reporter")).toBe("sam");
    expect(cellText(issue, "priority")).toBe("High");
    expect(cellText(issue, "blob")).toBe("");
  });

  it("falls back to custom fields and returns empty for a missing field", () => {
    expect(cellText(issue, "team")).toBe("Assessments");
    expect(cellText(issue, "nope")).toBe("");
    expect(cellText({ key: "B-2", values: { custom_fields: "junk" } }, "team")).toBe("");
  });
});
