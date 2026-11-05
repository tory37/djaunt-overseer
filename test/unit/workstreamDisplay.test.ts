import { describe, expect, it } from "vitest";
import { emptyAnalysis, SessionAnalysis, Workstream } from "../../src/analysisState";
import {
  buildWorkstreamDisplay,
  MAX_EXPANDED_UNSORTED_ITEMS,
  orderWorkstreams,
  resolveItemDrop,
  WorkstreamDisplayInput,
} from "../../src/workstreamDisplay";
import { REFERENCE_WORKSTREAM_ID, UNSORTED_WORKSTREAM_ID } from "../../src/workstreamEdits";

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

  describe("reference items", () => {
    const TICKET = "ticket:SOA-7";
    const OLD_PR = "pr:amira/web/pull/3";
    const activity: Record<string, number> = { [PR_B]: 5, [OLD_PR]: 1, [TICKET]: 3 };

    function referenceDisplay(overrides: Partial<WorkstreamDisplayInput<{ key: string }>> = {}) {
      const analysis = { ...analysisWith([]), referenceItemKeys: [COMMIT, PR_B, OLD_PR, TICKET, PR_A, ARTIFACT] };
      return buildWorkstreamDisplay(
        displayInput({
          analysis,
          candidateItemKeys: [COMMIT, PR_B, OLD_PR, TICKET, PR_A],
          lastActivityOf: (itemKey) => activity[itemKey] ?? 0,
          ...overrides,
        }),
      );
    }

    it("groups reference items by kind in fixed order, newest first, and keeps them out of Unsorted", () => {
      const display = referenceDisplay({ candidateItemKeys: [COMMIT, PR_B, OLD_PR, TICKET, "commit:fff0000"] });
      expect(display.referenceGroups).toEqual([
        { kind: "ticket", rows: [{ key: TICKET }] },
        { kind: "pr", rows: [{ key: PR_B }, { key: OLD_PR }] },
        { kind: "commit", rows: [{ key: COMMIT }] },
      ]);
      expect(display.groups.map((group) => group.rows)).toEqual([[{ key: "commit:fff0000" }]]);
    });

    it("leaves out removed items, items that are not candidates, and items with no row", () => {
      const display = referenceDisplay({
        removedItemKeys: [PR_B],
        rowFor: (itemKey) => (itemKey === TICKET ? undefined : { key: itemKey }),
      });
      expect(display.referenceGroups).toEqual([
        { kind: "pr", rows: [{ key: OLD_PR }, { key: PR_A }] },
        { kind: "commit", rows: [{ key: COMMIT }] },
      ]);
    });

    it("is not empty when only reference items show", () => {
      const display = referenceDisplay();
      expect(display.groups).toEqual([]);
      expect(display.isEmpty).toBe(false);
    });
  });
});

describe("resolveItemDrop", () => {
  const analysis = analysisWith([workstream("ws-1", { itemKeys: [PR_A] }), workstream("ws-2")]);
  const { groups } = buildWorkstreamDisplay(displayInput({ analysis, candidateItemKeys: [COMMIT] }));

  it("pins to another workstream or to Unsorted", () => {
    expect(resolveItemDrop(groups, [], PR_A, "ws-2")).toBe("ws-2");
    expect(resolveItemDrop(groups, [], PR_A, UNSORTED_WORKSTREAM_ID)).toBe(UNSORTED_WORKSTREAM_ID);
    expect(resolveItemDrop(groups, [], COMMIT, "ws-1")).toBe("ws-1");
  });

  it("pins to Reference, and from Reference to a workstream or Unsorted", () => {
    const referenceAnalysis = { ...analysis, referenceItemKeys: [PR_B] };
    const display = buildWorkstreamDisplay(displayInput({ analysis: referenceAnalysis, candidateItemKeys: [COMMIT, PR_B] }));
    expect(resolveItemDrop(display.groups, display.referenceGroups, PR_A, REFERENCE_WORKSTREAM_ID)).toBe(REFERENCE_WORKSTREAM_ID);
    expect(resolveItemDrop(display.groups, display.referenceGroups, COMMIT, REFERENCE_WORKSTREAM_ID)).toBe(REFERENCE_WORKSTREAM_ID);
    expect(resolveItemDrop(display.groups, display.referenceGroups, PR_B, "ws-1")).toBe("ws-1");
    expect(resolveItemDrop(display.groups, display.referenceGroups, PR_B, UNSORTED_WORKSTREAM_ID)).toBe(UNSORTED_WORKSTREAM_ID);
    expect(resolveItemDrop(display.groups, display.referenceGroups, PR_B, REFERENCE_WORKSTREAM_ID)).toBeUndefined();
  });

  it("ignores a drop on the same group, an unknown group, or an item not shown", () => {
    expect(resolveItemDrop(groups, [], PR_A, "ws-1")).toBeUndefined();
    expect(resolveItemDrop(groups, [], COMMIT, UNSORTED_WORKSTREAM_ID)).toBeUndefined();
    expect(resolveItemDrop(groups, [], PR_A, "ws-9")).toBeUndefined();
    expect(resolveItemDrop(groups, [], PR_B, "ws-2")).toBeUndefined();
  });
});
