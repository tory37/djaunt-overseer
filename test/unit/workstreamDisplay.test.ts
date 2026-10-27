import { describe, expect, it } from "vitest";
import { emptyAnalysis, SessionAnalysis, Workstream } from "../../src/analysisState";
import {
  buildWorkstreamDisplay,
  MAX_EXPANDED_UNSORTED_ITEMS,
  orderWorkstreams,
  resolveItemDrop,
  WorkstreamDisplayInput,
} from "../../src/workstreamDisplay";
import { UNSORTED_WORKSTREAM_ID } from "../../src/workstreamEdits";

const PR_A = "pr:amira/api/pull/1";
const PR_B = "pr:amira/web/pull/2";
const COMMIT = "commit:abc1234";
const ARTIFACT = "artifact:plan";

function workstream(id: string, overrides: Partial<Workstream> = {}): Workstream {
  return { id, title: `Title ${id}`, ticketKeys: [], itemKeys: [], done: false, ...overrides };
}

function analysisWith(workstreams: Workstream[]): SessionAnalysis {
  return { ...emptyAnalysis(), workstreams };
}

function displayInput(overrides: Partial<WorkstreamDisplayInput<{ key: string }>> = {}): WorkstreamDisplayInput<{ key: string }> {
  return {
    analysis: undefined,
    workstreamOrder: [],
    candidateItemKeys: [],
    removedItemKeys: [],
    lastActivityOf: () => 0,
    rowFor: (itemKey) => ({ key: itemKey }),
    ...overrides,
  };
}

describe("orderWorkstreams", () => {
  const activity: Record<string, number> = { [PR_A]: 10, [PR_B]: 30, [COMMIT]: 20, "ticket:SOA-1": 40 };
  const lastActivityOf = (itemKey: string): number => activity[itemKey] ?? 0;

  it("puts the saved order first, then active newest first, then done", () => {
    const workstreams = [
      workstream("ws-1", { itemKeys: [PR_A] }),
      workstream("ws-2", { itemKeys: [PR_B], done: true }),
      workstream("ws-3", { itemKeys: [COMMIT] }),
      workstream("ws-4", { ticketKeys: ["SOA-1"] }),
      workstream("ws-5"),
    ];
    const ordered = orderWorkstreams(workstreams, ["ws-1", "ws-gone"], lastActivityOf);
    expect(ordered.map((shown) => shown.id)).toEqual(["ws-1", "ws-4", "ws-3", "ws-5", "ws-2"]);
  });

  it("breaks an activity tie by the later workstream", () => {
    const ordered = orderWorkstreams([workstream("ws-1"), workstream("ws-2")], [], () => 0);
    expect(ordered.map((shown) => shown.id)).toEqual(["ws-2", "ws-1"]);
  });
});

describe("buildWorkstreamDisplay", () => {
  it("shows the empty state with no workstreams and nothing unsorted", () => {
    const display = buildWorkstreamDisplay(displayInput({ removedItemKeys: [PR_A] }));
    expect(display.isEmpty).toBe(true);
    expect(display.groups).toEqual([]);
    expect(display.removedRows).toEqual([{ key: PR_A }]);
  });

  it("builds groups with ticket chips, rows, and a collapsed done group", () => {
    const analysis = analysisWith([workstream("ws-1", { itemKeys: [PR_A], ticketKeys: ["SOA-1"], done: true })]);
    const [group] = buildWorkstreamDisplay(displayInput({ analysis })).groups;
    expect(group).toEqual({
      id: "ws-1",
      isUnsorted: false,
      title: "Title ws-1",
      isDone: true,
      tickets: [{ key: "ticket:SOA-1" }],
      rows: [{ key: PR_A }],
      isCollapsedByDefault: true,
    });
  });

  it("puts unplaced candidates in Unsorted at the end, newest first, without placed or removed items", () => {
    const analysis = analysisWith([workstream("ws-1", { itemKeys: [PR_A], ticketKeys: ["SOA-1"] })]);
    const activity: Record<string, number> = { [COMMIT]: 5, [ARTIFACT]: 9 };
    const display = buildWorkstreamDisplay(
      displayInput({
        analysis,
        candidateItemKeys: [PR_A, "ticket:SOA-1", COMMIT, ARTIFACT, PR_B, COMMIT],
        removedItemKeys: [PR_B],
        lastActivityOf: (itemKey) => activity[itemKey] ?? 0,
      }),
    );
    const unsorted = display.groups[display.groups.length - 1];
    expect(unsorted.id).toBe(UNSORTED_WORKSTREAM_ID);
    expect(unsorted.isUnsorted).toBe(true);
    expect(unsorted.rows).toEqual([{ key: ARTIFACT }, { key: COMMIT }]);
    expect(unsorted.isCollapsedByDefault).toBe(false);
    expect(display.removedRows).toEqual([{ key: PR_B }]);
  });

  it("collapses Unsorted past the item limit", () => {
    const keys = Array.from({ length: MAX_EXPANDED_UNSORTED_ITEMS + 1 }, (_, index) => `commit:${index}`);
    const [unsorted] = buildWorkstreamDisplay(displayInput({ candidateItemKeys: keys })).groups;
    expect(unsorted.isCollapsedByDefault).toBe(true);
  });

  it("skips items that have no row", () => {
    const analysis = analysisWith([workstream("ws-1", { itemKeys: [PR_A, "junk"] })]);
    const display = buildWorkstreamDisplay(
      displayInput({ analysis, candidateItemKeys: ["junk"], rowFor: (itemKey) => (itemKey === "junk" ? undefined : { key: itemKey }) }),
    );
    expect(display.groups.map((group) => group.rows)).toEqual([[{ key: PR_A }]]);
  });
});

describe("resolveItemDrop", () => {
  const analysis = analysisWith([workstream("ws-1", { itemKeys: [PR_A] }), workstream("ws-2")]);
  const { groups } = buildWorkstreamDisplay(displayInput({ analysis, candidateItemKeys: [COMMIT] }));

  it("pins to another workstream or to Unsorted", () => {
    expect(resolveItemDrop(groups, PR_A, "ws-2")).toBe("ws-2");
    expect(resolveItemDrop(groups, PR_A, UNSORTED_WORKSTREAM_ID)).toBe(UNSORTED_WORKSTREAM_ID);
    expect(resolveItemDrop(groups, COMMIT, "ws-1")).toBe("ws-1");
  });

  it("ignores a drop on the same group, an unknown group, or an item not shown", () => {
    expect(resolveItemDrop(groups, PR_A, "ws-1")).toBeUndefined();
    expect(resolveItemDrop(groups, COMMIT, UNSORTED_WORKSTREAM_ID)).toBeUndefined();
    expect(resolveItemDrop(groups, PR_A, "ws-9")).toBeUndefined();
    expect(resolveItemDrop(groups, PR_B, "ws-2")).toBeUndefined();
  });
});
