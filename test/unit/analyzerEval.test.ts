import { describe, expect, it } from "vitest";
import { EvalLabel, scoreGrouping } from "../../src/analyzerEval";

function labelOf(...itemKeyGroups: string[][]): EvalLabel {
  return {
    sessionId: "s1",
    workstreams: itemKeyGroups.map((itemKeys, index) => ({ title: `Workstream ${index + 1}`, itemKeys })),
  };
}

function outputOf(...itemKeyGroups: string[][]): { itemKeys: string[] }[] {
  return itemKeyGroups.map((itemKeys) => ({ itemKeys }));
}

const PERFECT_PAIR_PARTS = { pairPrecision: 1, pairRecall: 1, pairF1: 1, coverage: 1, countDelta: 0, unsortedItems: 0 };

describe("scoreGrouping", () => {
  it("scores an identical grouping 1 on every part", () => {
    const label = labelOf(["pr:1", "commit:a"], ["ticket:X-1", "artifact:b"]);
    expect(scoreGrouping(label, outputOf(["pr:1", "commit:a"], ["ticket:X-1", "artifact:b"]))).toEqual({
      ...PERFECT_PAIR_PARTS,
      labeledItems: 4,
    });
  });

  it("ignores workstream order and ids", () => {
    const label = labelOf(["pr:1", "commit:a"], ["ticket:X-1", "artifact:b"]);
    const output = [
      { id: "ws-7", itemKeys: ["artifact:b", "ticket:X-1"] },
      { id: "ws-2", itemKeys: ["commit:a", "pr:1"] },
    ];
    expect(scoreGrouping(label, output)).toEqual({ ...PERFECT_PAIR_PARTS, labeledItems: 4 });
  });

  it("lowers only precision when two label workstreams are merged", () => {
    const score = scoreGrouping(labelOf(["a1", "a2"], ["b1", "b2"]), outputOf(["a1", "a2", "b1", "b2"]));
    expect(score.pairPrecision).toBeCloseTo(1 / 3);
    expect(score.pairRecall).toBe(1);
    expect(score.pairF1).toBeCloseTo(0.5);
    expect(score.coverage).toBe(1);
    expect(score.countDelta).toBe(1);
  });

  it("lowers only recall when one label workstream is split", () => {
    const score = scoreGrouping(labelOf(["a1", "a2", "a3", "a4"]), outputOf(["a1", "a2"], ["a3", "a4"]));
    expect(score.pairPrecision).toBe(1);
    expect(score.pairRecall).toBeCloseTo(1 / 3);
    expect(score.pairF1).toBeCloseTo(0.5);
    expect(score.countDelta).toBe(-1);
  });

  it("lowers coverage and recall for a labeled item the output left unsorted", () => {
    const score = scoreGrouping(labelOf(["a1", "a2", "a3"]), outputOf(["a1", "a2"]));
    expect(score.coverage).toBeCloseTo(2 / 3);
    expect(score.unsortedItems).toBe(1);
    expect(score.labeledItems).toBe(3);
    expect(score.pairPrecision).toBe(1);
    expect(score.pairRecall).toBeCloseTo(1 / 3);
    expect(score.countDelta).toBe(0);
  });

  it("ignores output items the label does not have", () => {
    const label = labelOf(["a1", "a2"], ["b1"]);
    const output = outputOf(["a1", "a2", "removed:1"], ["b1", "removed:2"], ["removed:3"]);
    expect(scoreGrouping(label, output)).toEqual({ ...PERFECT_PAIR_PARTS, labeledItems: 3 });
  });

  it("scores F1 1 when every workstream holds one item", () => {
    const score = scoreGrouping(labelOf(["a"], ["b"], ["c"]), outputOf(["c"], ["a"], ["b"]));
    expect(score).toEqual({ ...PERFECT_PAIR_PARTS, labeledItems: 3 });
  });

  it("counts a merge of singletons as a false positive", () => {
    const score = scoreGrouping(labelOf(["a"], ["b"]), outputOf(["a", "b"]));
    expect(score.pairPrecision).toBe(0);
    expect(score.pairRecall).toBe(1);
    expect(score.pairF1).toBe(0);
  });

  it("gives an empty label coverage 1", () => {
    const score = scoreGrouping(labelOf(), outputOf(["removed:1"]));
    expect(score).toEqual({ ...PERFECT_PAIR_PARTS, labeledItems: 0 });
  });

  it("does not count empty label workstreams", () => {
    const score = scoreGrouping(labelOf(["a1", "a2"], []), outputOf(["a1", "a2"]));
    expect(score.countDelta).toBe(0);
  });
});
