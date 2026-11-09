import { describe, expect, it } from "vitest";
import { parseFilter } from "../../src/jiraFilter";
import { JiraIssueRow, JiraQuery, parseIsoTimestamp } from "../../src/jiraQueries";
import {
  fieldLabel,
  firstLine,
  isQueryDue,
  jqlSearchUrl,
  QueryRunState,
  reconcileQueryStates,
  relativeAge,
  rowView,
  sectionView,
} from "../../src/jiraTicketsView";

const MINUTE_MS = 60_000;
const NOW_MS = Date.parse("2026-11-09T12:00:00Z");

function query(overrides: Partial<JiraQuery> = {}): JiraQuery {
  return { name: "Blocked", jql: 'status = "Blocked"', fields: ["key", "summary", "status", "updated"], intervalMinutes: 5, ...overrides };
}

function issue(key: string, values: Record<string, unknown> = {}): JiraIssueRow {
  return { key, url: `https://acme.atlassian.net/browse/${key}`, values: { key, ...values } };
}

describe("isQueryDue", () => {
  it("is due when never checked", () => {
    expect(isQueryDue(undefined, 5, NOW_MS)).toBe(true);
  });

  it("is due once the interval has passed", () => {
    expect(isQueryDue(NOW_MS - 4 * MINUTE_MS, 5, NOW_MS)).toBe(false);
    expect(isQueryDue(NOW_MS - 5 * MINUTE_MS, 5, NOW_MS)).toBe(true);
  });
});

describe("relativeAge", () => {
  it("steps from now to minutes, hours, days, and weeks", () => {
    expect(relativeAge(NOW_MS - 30_000, NOW_MS)).toBe("now");
    expect(relativeAge(NOW_MS - 5 * MINUTE_MS, NOW_MS)).toBe("5m");
    expect(relativeAge(NOW_MS - 3 * 60 * MINUTE_MS, NOW_MS)).toBe("3h");
    expect(relativeAge(NOW_MS - 2 * 24 * 60 * MINUTE_MS, NOW_MS)).toBe("2d");
    expect(relativeAge(NOW_MS - 6 * 7 * 24 * 60 * MINUTE_MS, NOW_MS)).toBe("6w");
  });

  it("shows a future time as now", () => {
    expect(relativeAge(NOW_MS + 10 * MINUTE_MS, NOW_MS)).toBe("now");
  });
});

describe("parseIsoTimestamp", () => {
  it("reads Jira's compact offset", () => {
    expect(parseIsoTimestamp("2026-11-09T07:00:00.000-0500")).toBe(NOW_MS);
    expect(parseIsoTimestamp("2026-11-09T12:00:00Z")).toBe(NOW_MS);
  });

  it("leaves plain text and bare dates alone", () => {
    expect(parseIsoTimestamp("Blocked")).toBeUndefined();
    expect(parseIsoTimestamp("2026-11-09")).toBeUndefined();
  });
});

describe("jqlSearchUrl", () => {
  it("builds the search URL from the issue's origin", () => {
    expect(jqlSearchUrl("https://acme.atlassian.net/browse/A-1", 'status = "To Do"')).toBe(
      "https://acme.atlassian.net/issues/?jql=status%20%3D%20%22To%20Do%22",
    );
  });

  it("has no URL without a valid issue URL", () => {
    expect(jqlSearchUrl(undefined, "x")).toBeUndefined();
    expect(jqlSearchUrl("not a url", "x")).toBeUndefined();
  });
});

describe("fieldLabel", () => {
  it("labels issuetype, sprint, and fixVersions", () => {
    expect(fieldLabel("issuetype")).toBe("type");
    expect(fieldLabel("sprint")).toBe("Sprint");
    expect(fieldLabel("fixVersions")).toBe("Fix versions");
    expect(fieldLabel("priority")).toBe("priority");
  });
});

describe("rowView", () => {
  const fullIssue = issue("A-1", {
    summary: "Fix it",
    status: "Blocked",
    updated: "2026-11-09T09:00:00Z",
    created: "2026-11-07T12:00:00Z",
    assignee: { displayName: "Ana" },
    priority: { name: "High" },
    issuetype: { name: "Bug" },
    labels: ["ops"],
    sprint: { id: 6117, name: "Assess 2026.11.08", state: "closed" },
    fixVersions: [{ id: "14764", name: "r2026.11.12", released: false }],
  });

  it("puts the key, status, and first date on line one and the summary on line two", () => {
    const row = rowView(fullIssue, ["key", "summary", "status", "updated"], NOW_MS);
    expect(row.key).toBe("A-1");
    expect(row.url).toBe("https://acme.atlassian.net/browse/A-1");
    expect(row.title).toBe("A-1 · Fix it");
    expect(row.status).toBe("Blocked");
    expect(row.statusColor).toBe("var(--vscode-overseer-ticketBlocked)");
    expect(row.age).toBe("3h");
    expect(row.ageTitle).toBe(new Date(Date.parse("2026-11-09T09:00:00Z")).toLocaleString());
    expect(row.summary).toBe("Fix it");
    expect(row.details).toEqual([]);
  });

  it("sends priority, sprint, and fix versions first, then the other fields in field order, with icons and labeled titles", () => {
    const fields = ["key", "priority", "issuetype", "labels", "sprint", "fixVersions"];
    const row = rowView(fullIssue, fields, NOW_MS);
    expect(row.details).toEqual([
      {
        field: "priority",
        label: "priority",
        text: "High",
        title: "priority: High",
        icon: "arrow-up",
        filterChips: [{ text: "High", filterText: "priority:High", title: "Filter by priority: High" }],
      },
      {
        field: "sprint",
        label: "Sprint",
        text: "Assess 2026.11.08",
        title: "Sprint: Assess 2026.11.08",
        icon: "history",
        filterChips: [{ text: "Assess 2026.11.08", filterText: 'sprint:"Assess 2026.11.08"', title: "Filter by Sprint: Assess 2026.11.08" }],
      },
      {
        field: "fixVersions",
        label: "Fix versions",
        text: "r2026.11.12",
        title: "Fix versions: r2026.11.12",
        icon: "milestone",
        filterChips: [{ text: "r2026.11.12", filterText: "fix:r2026.11.12", title: "Filter by Fix versions: r2026.11.12" }],
      },
      { field: "issuetype", label: "type", text: "Bug", title: "type: Bug", icon: "tag" },
      { field: "labels", label: "labels", text: "ops", title: "labels: ops" },
    ]);
  });

  it("gives each fix version its own filter chip", () => {
    const twoVersions = issue("A-2", { fixVersions: [{ name: "r2026.11.12" }, { name: "r2026.12.03" }] });
    const [detail] = rowView(twoVersions, ["key", "fixVersions"], NOW_MS).details;
    expect(detail.text).toBe("r2026.11.12, r2026.12.03");
    expect(detail.filterChips?.map((chip) => chip.filterText)).toEqual(["fix:r2026.11.12", "fix:r2026.12.03"]);
  });

  it("makes the status pill a filter chip", () => {
    const row = rowView(fullIssue, ["key", "status"], NOW_MS);
    expect(row.statusFilterChip).toEqual({ text: "Blocked", filterText: "status:Blocked", title: "Filter by status: Blocked" });
  });

  describe("assignee", () => {
    const fields = ["key", "priority", "assignee"];
    const assigneeOf = (assignee: unknown, currentUserName?: string) =>
      rowView(issue("A-3", { assignee, priority: "High" }), fields, NOW_MS, currentUserName).details[0];

    it("comes first and shows Me, muted, when it is the current user", () => {
      const row = rowView(issue("A-3", { assignee: "Tory Hebert", priority: "High" }), fields, NOW_MS, "tory hebert");
      expect(row.details.map((detail) => [detail.field, detail.text])).toEqual([
        ["assignee", "Me"],
        ["priority", "High"],
      ]);
      expect(assigneeOf("Tory Hebert", "Tory Hebert")).toEqual({
        field: "assignee",
        label: "assignee",
        text: "Me",
        title: "assignee: Tory Hebert",
        icon: "account",
        tone: "muted",
        filterChips: [{ text: "Me", filterText: "assignee:me", title: "Filter by assignee: Me" }],
      });
    });

    it("shows someone else's name with the attention tone", () => {
      expect(assigneeOf("Ana", "Tory Hebert")).toMatchObject({ text: "Ana", title: "assignee: Ana", tone: "attention" });
      expect(assigneeOf({ displayName: "Ana" }, "Tory Hebert")).toMatchObject({ text: "Ana", tone: "attention" });
    });

    it("shows Unassigned with the attention tone when nobody has it", () => {
      expect(assigneeOf(null, "Tory Hebert")).toMatchObject({ text: "Unassigned", title: "assignee: Unassigned", tone: "attention" });
      expect(assigneeOf("", undefined)).toMatchObject({ text: "Unassigned", tone: "attention" });
      expect(assigneeOf(null)?.filterChips?.[0].filterText).toBe("assignee:unassigned");
    });

    it("filters by the full name, quoted when it has spaces", () => {
      expect(assigneeOf("Ana Ruiz", "Tory Hebert")?.filterChips?.[0].filterText).toBe('assignee:"Ana Ruiz"');
    });

    it("shows the name with no tone until the current user is known", () => {
      expect(assigneeOf("Ana")).toEqual({
        field: "assignee",
        label: "assignee",
        text: "Ana",
        title: "assignee: Ana",
        icon: "account",
        filterChips: [{ text: "Ana", filterText: "assignee:Ana", title: "Filter by assignee: Ana" }],
      });
    });

    it("is left out when the query didn't ask for it", () => {
      expect(rowView(issue("A-3", { assignee: "Ana" }), ["key"], NOW_MS, "Tory Hebert").details).toEqual([]);
    });
  });

  describe("empty priority, sprint, and fix versions", () => {
    const fields = ["key", "labels", "fixVersions", "sprint", "assignee", "priority"];
    const emptyIssue = issue("A-4", { labels: ["ops"], assignee: "Ana", sprint: null, priority: null, fixVersions: [] });

    it("shows a muted, empty item for each with its icon and a none filter", () => {
      const details = rowView(emptyIssue, fields, NOW_MS, "Tory Hebert").details;
      expect(details.filter((detail) => detail.isEmpty)).toEqual([
        {
          field: "priority",
          label: "priority",
          text: "No Priority",
          title: "priority: none",
          icon: "arrow-up",
          tone: "muted",
          isEmpty: true,
          filterChips: [{ text: "No Priority", filterText: "priority:none", title: "Filter by tickets with no priority" }],
        },
        {
          field: "sprint",
          label: "Sprint",
          text: "No Sprint",
          title: "Sprint: none",
          icon: "history",
          tone: "muted",
          isEmpty: true,
          filterChips: [{ text: "No Sprint", filterText: "sprint:none", title: "Filter by tickets with no Sprint" }],
        },
        {
          field: "fixVersions",
          label: "Fix versions",
          text: "No Fix Versions",
          title: "Fix versions: none",
          icon: "milestone",
          tone: "muted",
          isEmpty: true,
          filterChips: [{ text: "No Fix Versions", filterText: "fix:none", title: "Filter by tickets with no Fix versions" }],
        },
      ]);
    });

    it("keeps assignee, priority, sprint, fix versions, then the rest, empty or not", () => {
      const emptyOrder = rowView(emptyIssue, fields, NOW_MS).details.map((detail) => detail.field);
      const filledOrder = rowView(fullIssue, fields, NOW_MS).details.map((detail) => detail.field);
      expect(emptyOrder).toEqual(["assignee", "priority", "sprint", "fixVersions", "labels"]);
      expect(filledOrder).toEqual(emptyOrder);
    });

    it("leaves out the empty items when the query didn't ask for the field", () => {
      expect(rowView(emptyIssue, ["key", "labels"], NOW_MS).details.map((detail) => detail.field)).toEqual(["labels"]);
    });
  });

  it("uses only the first date for the age and shows later dates as details", () => {
    const row = rowView(fullIssue, ["key", "created", "updated"], NOW_MS);
    expect(row.age).toBe("2d");
    expect(row.details).toEqual([
      { field: "updated", label: "updated", text: "3h", title: `updated: ${new Date(Date.parse("2026-11-09T09:00:00Z")).toLocaleString()}` },
    ]);
  });

  it("leaves out fields the query didn't ask for and fields with no value", () => {
    const row = rowView(issue("A-2", { summary: "Hidden", status: "Done" }), ["key", "labels", "issuetype"], NOW_MS);
    expect(row.summary).toBeUndefined();
    expect(row.status).toBeUndefined();
    expect(row.age).toBeUndefined();
    expect(row.details).toEqual([]);
  });
});

describe("firstLine", () => {
  it("keeps the first non-empty line of an error", () => {
    expect(firstLine(new Error("\nNo stdio MCP server named \"jira\"\nstack"))).toBe('No stdio MCP server named "jira"');
    expect(firstLine("")).toBe("the search failed");
  });
});

describe("reconcileQueryStates", () => {
  const checked: QueryRunState = { query: query(), issues: [issue("A-1")], hasMore: false, isRunning: false, lastCheckedMs: NOW_MS };

  it("keeps the results of an unchanged query and takes its new interval", () => {
    const [kept] = reconcileQueryStates([checked], [query({ intervalMinutes: 10 })]);
    expect(kept.issues).toEqual(checked.issues);
    expect(kept.lastCheckedMs).toBe(NOW_MS);
    expect(kept.query.intervalMinutes).toBe(10);
  });

  it("starts fresh when the JQL, name, or fields change", () => {
    const changedQueries = [query({ jql: "x" }), query({ name: "Other" }), query({ fields: ["key"] })];
    for (const state of reconcileQueryStates([checked], changedQueries)) {
      expect(state.issues).toEqual([]);
      expect(state.lastCheckedMs).toBeUndefined();
    }
  });
});

describe("sectionView", () => {
  it("builds a row per issue and the header details", () => {
    const state: QueryRunState = {
      query: query(),
      issues: [issue("A-1", { summary: "Fix it", status: "Blocked", updated: "2026-11-09T09:00:00Z" })],
      hasMore: false,
      isRunning: false,
      lastCheckedMs: NOW_MS - 2 * MINUTE_MS,
    };
    const section = sectionView(state, 3, NOW_MS);
    expect(section.queryIndex).toBe(3);
    expect(section.countText).toBe("1");
    expect(section.isLoading).toBe(false);
    expect(section.isQuiet).toBe(false);
    expect(section.headerTitle).toBe('Checked 2m ago · every 5 min\nstatus = "Blocked"');
    expect(section.searchUrl).toBe("https://acme.atlassian.net/issues/?jql=status%20%3D%20%22Blocked%22");
    expect(section.rows.map((row) => [row.key, row.status, row.age, row.summary])).toEqual([["A-1", "Blocked", "3h", "Fix it"]]);
  });

  it("passes the current user name to its rows", () => {
    const state: QueryRunState = {
      query: query({ fields: ["key", "assignee"] }),
      issues: [issue("A-1", { assignee: "Tory Hebert" })],
      hasMore: false,
      isRunning: false,
      lastCheckedMs: NOW_MS,
    };
    expect(sectionView(state, 0, NOW_MS, "Tory Hebert").rows[0].details[0]).toMatchObject({ text: "Me", tone: "muted" });
  });

  it("shows a loading count until the first check", () => {
    const section = sectionView({ query: query(), issues: [], hasMore: false, isRunning: false }, 0, NOW_MS);
    expect(section.isLoading).toBe(true);
    expect(section.isQuiet).toBe(false);
    expect(section.searchUrl).toBeUndefined();
    expect(section.headerTitle.startsWith("Not checked yet")).toBe(true);
  });

  it("is quiet when a check found nothing and had no error", () => {
    const empty: QueryRunState = { query: query(), issues: [], hasMore: false, isRunning: false, lastCheckedMs: NOW_MS };
    expect(sectionView(empty, 0, NOW_MS).isQuiet).toBe(true);
    expect(sectionView({ ...empty, error: "boom" }, 0, NOW_MS).isQuiet).toBe(false);
  });

  describe("with a filter", () => {
    const filtered: QueryRunState = {
      query: query({ fields: ["key", "summary", "fixVersions"] }),
      issues: [
        issue("A-1", { summary: "Fix login", fixVersions: [{ name: "r2026.11.12" }] }),
        issue("A-2", { summary: "Add export", fixVersions: [{ name: "r2026.12.03" }] }),
        issue("A-3", { summary: "Fix logout" }),
      ],
      hasMore: false,
      isRunning: false,
      lastCheckedMs: NOW_MS,
    };

    it("keeps the matching rows and counts matched over total", () => {
      const section = sectionView(filtered, 0, NOW_MS, undefined, parseFilter("fix:r2026.11"));
      expect(section.rows.map((row) => row.key)).toEqual(["A-1"]);
      expect(section.matchCount).toBe(1);
      expect(section.totalCount).toBe(3);
      expect(section.countText).toBe("1/3");
      expect(section.hiddenByFilter).toBe(false);
    });

    it("marks a section with no matches as hidden by the filter", () => {
      const section = sectionView(filtered, 0, NOW_MS, undefined, parseFilter("nothing-like-this"));
      expect(section.rows).toEqual([]);
      expect(section.hiddenByFilter).toBe(true);
      expect(section.countText).toBe("0/3");
    });

    it("shows everything with an empty filter", () => {
      const section = sectionView(filtered, 0, NOW_MS, undefined, parseFilter("   "));
      expect(section.rows).toHaveLength(3);
      expect(section.countText).toBe("3");
      expect(section.hiddenByFilter).toBe(false);
    });
  });

  it("marks a capped count", () => {
    const capped: QueryRunState = { query: query(), issues: [issue("A-1")], hasMore: true, isRunning: true, lastCheckedMs: NOW_MS };
    const section = sectionView(capped, 0, NOW_MS);
    expect(section.countText).toBe("1+");
    expect(section.isLoading).toBe(true);
  });
});
