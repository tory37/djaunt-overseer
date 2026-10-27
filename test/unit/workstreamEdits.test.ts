import { describe, expect, it } from "vitest";
import { emptyAnalysis, SessionAnalysis, Workstream } from "../../src/analysisState";
import {
  applyUserEdits,
  emptyWorkstreamEdits,
  hasWorkstreamEdits,
  readWorkstreamEdits,
  UNSORTED_WORKSTREAM_ID,
  withLinkMarkRemovals,
  withoutRemovedItem,
  withPinnedItem,
  withRenamedWorkstream,
  withWorkstreamDone,
  withWorkstreamOrder,
} from "../../src/workstreamEdits";

const PR_A = "pr:amira/api/pull/1";
const COMMIT = "commit:abc1234";

function workstream(id: string, overrides: Partial<Workstream> = {}): Workstream {
  return { id, title: `Title ${id}`, ticketKeys: [], itemKeys: [], done: false, ...overrides };
}

function analysisWith(workstreams: Workstream[]): SessionAnalysis {
  return { ...emptyAnalysis(), workstreams };
}

describe("sidebar edit writers", () => {
  it("renames, and an empty title drops the rename", () => {
    const renamed = withRenamedWorkstream(emptyWorkstreamEdits(), "ws-1", "  Retry   fix ");
    expect(renamed.workstreamTitles).toEqual({ "ws-1": "Retry fix" });
    expect(withRenamedWorkstream(renamed, "ws-1", "   ").workstreamTitles).toEqual({});
  });

  it("pins items, sets done, and keeps a unique order", () => {
    const edits = withWorkstreamOrder(withWorkstreamDone(withPinnedItem(emptyWorkstreamEdits(), PR_A, "ws-2"), "ws-1", true), ["ws-2", "ws-1", "ws-2"]);
    expect(edits.pinnedItems).toEqual({ [PR_A]: "ws-2" });
    expect(edits.workstreamDone).toEqual({ "ws-1": true });
    expect(edits.workstreamOrder).toEqual(["ws-2", "ws-1"]);
    expect(hasWorkstreamEdits(withWorkstreamOrder(emptyWorkstreamEdits(), ["ws-1"]))).toBe(true);
  });

  it("folds link-mark removals in and restores an older edit removal", () => {
    const edits = { ...emptyWorkstreamEdits(), removedItems: [COMMIT] };
    expect(withLinkMarkRemovals(edits, { [PR_A]: "removed", "ticket:SOA-1": "pinned" }).removedItems).toEqual([COMMIT, PR_A]);
    expect(withoutRemovedItem(edits, COMMIT).removedItems).toEqual([]);
  });

  it("reads a saved order and drops bad entries", () => {
    expect(readWorkstreamEdits({ workstreamOrder: ["ws-2", 3, "", "ws-2", "ws-1"] }).workstreamOrder).toEqual(["ws-2", "ws-1"]);
    expect(readWorkstreamEdits({}).workstreamOrder).toEqual([]);
  });
});

describe("applyUserEdits with an Unsorted pin", () => {
  it("takes the item and ticket tag out of every workstream", () => {
    const analysis = analysisWith([workstream("ws-1", { itemKeys: [PR_A], ticketKeys: ["SOA-1"] }), workstream("ws-2", { ticketKeys: ["SOA-1"] })]);
    const edits = withPinnedItem(withPinnedItem(emptyWorkstreamEdits(), PR_A, UNSORTED_WORKSTREAM_ID), "ticket:SOA-1", UNSORTED_WORKSTREAM_ID);
    const edited = applyUserEdits(analysis, edits);
    expect(edited.workstreams.map(({ itemKeys, ticketKeys }) => ({ itemKeys, ticketKeys }))).toEqual([
      { itemKeys: [], ticketKeys: [] },
      { itemKeys: [], ticketKeys: [] },
    ]);
  });

  it("moves a pinned item between workstreams", () => {
    const analysis = analysisWith([workstream("ws-1", { itemKeys: [PR_A] }), workstream("ws-2")]);
    const edited = applyUserEdits(analysis, withPinnedItem(emptyWorkstreamEdits(), PR_A, "ws-2"));
    expect(edited.workstreams.map((shown) => shown.itemKeys)).toEqual([[], [PR_A]]);
  });
});
