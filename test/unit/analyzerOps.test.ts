import { describe, expect, it } from "vitest";
import { emptyAnalysis, MAX_ARTIFACT_TITLE_CHARS, readSessionAnalysis, SessionAnalysis, trimToWholeWords } from "../../src/analysisState";
import {
  ANALYZER_SYSTEM_PROMPT,
  analyzerArgs,
  AnalyzerOp,
  analyzerOutputSchema,
  ApplyContext,
  applyOps,
  isRecheckDropTooLarge,
  parseAnalyzerOutput,
  recheckDropOf,
} from "../../src/analyzerOps";
import { StatusOption } from "../../src/sessionStatuses";
import { applyUserEdits, emptyWorkstreamEdits, readWorkstreamEdits, WorkstreamEdits } from "../../src/workstreamEdits";

const STATUS_OPTIONS: StatusOption[] = [
  { id: "in-progress", name: "In Progress", asksReason: false, done: false },
  { id: "done", name: "Done", asksReason: false, done: true },
];
const STATUS_IDS = STATUS_OPTIONS.map((option) => option.id);
const PR_A = "pr:amira/api/pull/1";
const PR_B = "pr:amira/web/pull/2";
const ARTIFACT = "artifact:abc";

function envelope(output: unknown): string {
  return JSON.stringify({ type: "result", is_error: false, structured_output: output });
}

function context(mode: ApplyContext["mode"] = "diff", knownItemKeys = [PR_A, PR_B, ARTIFACT]): ApplyContext {
  return { mode, knownItemKeys: new Set(knownItemKeys), statusOptions: STATUS_OPTIONS };
}

function edits(overrides: Partial<WorkstreamEdits> = {}): WorkstreamEdits {
  return { ...emptyWorkstreamEdits(), ...overrides };
}

const GROUP_OPS: AnalyzerOp[] = [
  { op: "create_workstream", ref: "new-1", title: "Fix retry bug" },
  { op: "assign_item", item: PR_A, workstream: "new-1" },
  { op: "assign_item", item: PR_B, workstream: "new-1" },
  { op: "tag_ticket", ticket: "SOA-12", workstream: "new-1" },
];

describe("parseAnalyzerOutput", () => {
  it("reads structured output and a JSON result string", () => {
    expect(parseAnalyzerOutput(envelope({ ops: GROUP_OPS }), STATUS_IDS)).toEqual(GROUP_OPS);
    const resultEnvelope = JSON.stringify({ is_error: false, result: JSON.stringify({ ops: [] }) });
    expect(parseAnalyzerOutput(resultEnvelope, STATUS_IDS)).toEqual([]);
  });

  it.each([
    ["not json", "not json"],
    ["an error envelope", JSON.stringify({ is_error: true, result: "boom" })],
    ["no ops array", envelope({ operations: [] })],
    ["an unknown op", envelope({ ops: [{ op: "delete_everything" }] })],
    ["a missing field", envelope({ ops: [{ op: "create_workstream", ref: "new-1" }] })],
    ["a blank title", envelope({ ops: [{ op: "retitle_workstream", workstream: "ws-1", title: "  " }] })],
    ["a status outside the list", envelope({ ops: [{ op: "set_session_status", status: "shipped", done: true }] })],
    ["a non-boolean done", envelope({ ops: [{ op: "mark_workstream_done", workstream: "ws-1", done: "yes" }] })],
    ["too many where lines", envelope({ ops: [{ op: "set_where", lines: ["a", "b", "c", "d"] }] })],
    ["a null op", envelope({ ops: [null] })],
  ])("fails the whole reply on %s", (_label, stdout) => {
    expect(parseAnalyzerOutput(stdout, STATUS_IDS)).toBeUndefined();
  });

  it("puts the status ids in the schema and passes it with --json-schema", () => {
    const schemaText = JSON.stringify(analyzerOutputSchema(STATUS_IDS));
    expect(schemaText).toContain('"enum":["in-progress","done"]');
    const args = analyzerArgs("haiku", STATUS_IDS);
    expect(args[args.indexOf("--model") + 1]).toBe("haiku");
    expect(JSON.parse(args[args.indexOf("--json-schema") + 1])).toEqual(analyzerOutputSchema(STATUS_IDS));
  });

  it("leaves the status op out of the schema when no statuses are configured", () => {
    expect(JSON.stringify(analyzerOutputSchema([]))).not.toContain("set_session_status");
  });

  it("caps the artifact name in the schema and the prompt", () => {
    expect(JSON.stringify(analyzerOutputSchema(STATUS_IDS))).toContain(`"title":{"type":"string","maxLength":${MAX_ARTIFACT_TITLE_CHARS}}`);
    expect(ANALYZER_SYSTEM_PROMPT).toContain(`at most ${MAX_ARTIFACT_TITLE_CHARS} characters`);
  });

  it("trims a long artifact name at a word boundary instead of failing the reply", () => {
    const longTitle = "Spanish SODA rollout: PRs, tickets, changes by repo, ship order, and open items.";
    const ops = parseAnalyzerOutput(envelope({ ops: [{ op: "set_artifact_title", item: ARTIFACT, title: longTitle }] }), STATUS_IDS);
    expect(ops).toEqual([{ op: "set_artifact_title", item: ARTIFACT, title: "Spanish SODA rollout: PRs, tickets" }]);
  });
});

describe("applyOps", () => {
  it("groups items, tags tickets, titles artifacts, and sets where and status", () => {
    const analysis = applyOps(
      emptyAnalysis(),
      [
        ...GROUP_OPS,
        { op: "set_artifact_title", item: ARTIFACT, title: "Retry bug test plan" },
        { op: "set_where", lines: ["Both PRs open", "Waiting on QA"] },
        { op: "set_session_status", status: "done", done: false },
      ],
      edits(),
      context(),
    );
    expect(analysis.workstreams).toEqual([
      { id: "ws-1", title: "Fix retry bug", ticketKeys: ["SOA-12"], itemKeys: [PR_A, PR_B], done: false },
    ]);
    expect(analysis.artifactTitles).toEqual({ [ARTIFACT]: "Retry bug test plan" });
    expect(analysis.where).toEqual(["Both PRs open", "Waiting on QA"]);
    expect(analysis.sessionStatus).toBe("done");
    expect(analysis.sessionDone).toBe(true);
  });

  it("keeps ids stable: a repeated create reuses the workstream and new ones get the next number", () => {
    const firstPass = applyOps(emptyAnalysis(), GROUP_OPS, edits(), context());
    const secondPass = applyOps(firstPass, GROUP_OPS, edits(), context());
    expect(secondPass).toEqual(firstPass);
    const thirdPass = applyOps(
      secondPass,
      [
        { op: "create_workstream", ref: "new-1", title: "Write the test plan" },
        { op: "assign_item", item: ARTIFACT, workstream: "new-1" },
      ],
      edits(),
      context(),
    );
    expect(thirdPass.workstreams.map((workstream) => workstream.id)).toEqual(["ws-1", "ws-2"]);
  });

  it("skips items the model was not shown and workstreams that do not exist", () => {
    const analysis = applyOps(
      emptyAnalysis(),
      [...GROUP_OPS, { op: "assign_item", item: "pr:other/repo/pull/9", workstream: "new-1" }, { op: "assign_item", item: ARTIFACT, workstream: "ws-77" }],
      edits(),
      context(),
    );
    expect(analysis.workstreams[0].itemKeys).toEqual([PR_A, PR_B]);
  });

  it("moves an item between workstreams and unsorts it with an empty workstream", () => {
    const firstPass = applyOps(emptyAnalysis(), GROUP_OPS, edits(), context());
    const moved = applyOps(
      firstPass,
      [
        { op: "create_workstream", ref: "new-1", title: "Web cleanup" },
        { op: "assign_item", item: PR_B, workstream: "new-1" },
        { op: "assign_item", item: PR_A, workstream: "" },
      ],
      edits(),
      context(),
    );
    expect(moved.workstreams.map(({ id, itemKeys }) => ({ id, itemKeys }))).toEqual([
      { id: "ws-1", itemKeys: [] },
      { id: "ws-2", itemKeys: [PR_B] },
    ]);
  });

  it("drops a workstream left with nothing unless the user edited it", () => {
    const firstPass = applyOps(emptyAnalysis(), [GROUP_OPS[0], GROUP_OPS[1]], edits(), context());
    const emptied = applyOps(firstPass, [{ op: "assign_item", item: PR_A, workstream: "" }], edits(), context());
    expect(emptied.workstreams).toEqual([]);
    const kept = applyOps(firstPass, [{ op: "assign_item", item: PR_A, workstream: "" }], edits({ workstreamTitles: { "ws-1": "Mine" } }), context());
    expect(kept.workstreams.map((workstream) => workstream.title)).toEqual(["Mine"]);
  });

  describe("user edits win", () => {
    const firstPass = applyOps(emptyAnalysis(), GROUP_OPS, edits(), context());

    it("keeps a renamed title over a model retitle", () => {
      const analysis = applyOps(
        firstPass,
        [{ op: "retitle_workstream", workstream: "ws-1", title: "Model title" }],
        edits({ workstreamTitles: { "ws-1": "User title" } }),
        context(),
      );
      expect(analysis.workstreams[0].title).toBe("User title");
    });

    it("never moves a pinned item", () => {
      const analysis = applyOps(
        firstPass,
        [{ op: "create_workstream", ref: "new-1", title: "Other" }, { op: "assign_item", item: PR_A, workstream: "new-1" }],
        edits({ pinnedItems: { [PR_A]: "ws-1" } }),
        context(),
      );
      expect(analysis.workstreams.find((workstream) => workstream.id === "ws-1")?.itemKeys).toContain(PR_A);
      expect(analysis.workstreams.some((workstream) => workstream.id !== "ws-1" && workstream.itemKeys.includes(PR_A))).toBe(false);
    });

    it("never re-adds a removed item or re-tags a removed ticket", () => {
      const analysis = applyOps(firstPass, GROUP_OPS, edits({ removedItems: [PR_B, "ticket:SOA-12"] }), context());
      expect(analysis.workstreams[0].itemKeys).toEqual([PR_A]);
      expect(analysis.workstreams[0].ticketKeys).toEqual([]);
    });

    it("keeps the user's workstream done state", () => {
      const analysis = applyOps(
        firstPass,
        [{ op: "mark_workstream_done", workstream: "ws-1", done: true }],
        edits({ workstreamDone: { "ws-1": false } }),
        context(),
      );
      expect(analysis.workstreams[0].done).toBe(false);
    });

    it("keeps the user's session status and done", () => {
      const analysis = applyOps(
        firstPass,
        [{ op: "set_session_status", status: "done", done: true }],
        edits({ sessionStatus: "in-progress", sessionDone: false }),
        context(),
      );
      expect(analysis.sessionStatus).toBe("in-progress");
      expect(analysis.sessionDone).toBe(false);
    });
  });

  it("drops a model workstream created with nothing in it", () => {
    const analysis = applyOps(emptyAnalysis(), [...GROUP_OPS, { op: "create_workstream", ref: "new-2", title: "Nothing here" }], edits(), context());
    expect(analysis.workstreams.map((workstream) => workstream.title)).toEqual(["Fix retry bug"]);
  });

  it("never unsorts an item the user kept, but still moves it between workstreams", () => {
    const firstPass = applyOps({ ...emptyAnalysis(), seedFacts: { knownItems: [], keptItemKeys: [PR_A], removedItemKeys: [] } }, GROUP_OPS, edits(), context());
    const unsorted = applyOps(firstPass, [{ op: "assign_item", item: PR_A, workstream: "" }], edits(), context());
    expect(unsorted.workstreams[0].itemKeys).toContain(PR_A);
    const moved = applyOps(
      firstPass,
      [{ op: "create_workstream", ref: "new-1", title: "Other" }, { op: "assign_item", item: PR_A, workstream: "new-1" }],
      edits(),
      context(),
    );
    expect(moved.workstreams.find((workstream) => workstream.title === "Other")?.itemKeys).toEqual([PR_A]);
  });

  describe("recheck", () => {
    it("discards model workstreams and keeps only the ones the user renamed or pinned into", () => {
      const firstPass = applyOps(
        emptyAnalysis(),
        [
          ...GROUP_OPS,
          { op: "create_workstream", ref: "new-2", title: "Plan" },
          { op: "assign_item", item: ARTIFACT, workstream: "new-2" },
          { op: "mark_workstream_done", workstream: "new-2", done: true },
        ],
        edits(),
        context(),
      );
      const userEdits = edits({ pinnedItems: { [PR_B]: "ws-1" }, workstreamTitles: { "ws-1": "My fix" } });
      const rechecked = applyOps(
        firstPass,
        [
          { op: "assign_item", item: PR_A, workstream: "ws-2" },
          { op: "create_workstream", ref: "new-1", title: "Write the plan" },
          { op: "assign_item", item: PR_A, workstream: "new-1" },
          { op: "assign_item", item: ARTIFACT, workstream: "new-1" },
        ],
        userEdits,
        context("recheck"),
      );
      expect(rechecked.workstreams).toEqual([
        { id: "ws-1", title: "My fix", ticketKeys: [], itemKeys: [PR_B], done: false },
        { id: "ws-3", title: "Write the plan", ticketKeys: [], itemKeys: [PR_A, ARTIFACT], done: false },
      ]);
      expect(rechecked.nextWorkstreamNumber).toBe(4);
    });

    it("recreates a model workstream under a new id even with the same title", () => {
      const firstPass = applyOps(emptyAnalysis(), GROUP_OPS, edits(), context());
      const rechecked = applyOps(firstPass, GROUP_OPS, edits(), context("recheck"));
      expect(rechecked.workstreams).toEqual([{ id: "ws-2", title: "Fix retry bug", ticketKeys: ["SOA-12"], itemKeys: [PR_A, PR_B], done: false }]);
    });

    it("drops everything the recheck leaves empty", () => {
      const firstPass = applyOps(emptyAnalysis(), GROUP_OPS, edits(), context());
      const rechecked = applyOps(firstPass, [{ op: "create_workstream", ref: "n", title: "New split" }], edits(), context("recheck"));
      expect(rechecked.workstreams).toEqual([]);
    });
  });
});

describe("artifact placement", () => {
  const TEST_PLAN = "artifact:test-plan";
  const BACKEND_WRITEUP = "artifact:backend-writeup";
  const TRACKER = "artifact:tracker";

  it("tells the model an artifact goes with the work it documents", () => {
    expect(ANALYZER_SYSTEM_PROMPT).toContain("An artifact goes in the workstream of the work it documents or serves.");
    expect(ANALYZER_SYSTEM_PROMPT).toContain("Only an artifact that covers the whole session");
  });

  it("accepts a reply that spreads artifacts across their workstreams", () => {
    const reply = {
      ops: [
        { op: "create_workstream", ref: "new-1", title: "Client scheduling" },
        { op: "create_workstream", ref: "new-2", title: "Backend blueprints" },
        { op: "create_workstream", ref: "new-3", title: "Rollout tracking" },
        { op: "assign_item", item: PR_A, workstream: "new-1" },
        { op: "assign_item", item: TEST_PLAN, workstream: "new-1" },
        { op: "assign_item", item: PR_B, workstream: "new-2" },
        { op: "assign_item", item: BACKEND_WRITEUP, workstream: "new-2" },
        { op: "assign_item", item: TRACKER, workstream: "new-3" },
        { op: "set_artifact_title", item: TEST_PLAN, title: "RT-1068 local test plan" },
        { op: "set_artifact_title", item: TRACKER, title: "Spanish SODA tracker" },
      ],
    };
    const ops = parseAnalyzerOutput(envelope(reply), STATUS_IDS);
    expect(ops).toBeDefined();
    const analysis = applyOps(emptyAnalysis(), ops ?? [], edits(), context("recheck", [PR_A, PR_B, TEST_PLAN, BACKEND_WRITEUP, TRACKER]));
    expect(analysis.workstreams.map((workstream) => [workstream.title, workstream.itemKeys])).toEqual([
      ["Client scheduling", [PR_A, TEST_PLAN]],
      ["Backend blueprints", [PR_B, BACKEND_WRITEUP]],
      ["Rollout tracking", [TRACKER]],
    ]);
    expect(analysis.artifactTitles).toEqual({ [TEST_PLAN]: "RT-1068 local test plan", [TRACKER]: "Spanish SODA tracker" });
  });
});

describe("trimToWholeWords", () => {
  it("keeps a short name and cuts a long one at its last whole word with no ellipsis", () => {
    expect(trimToWholeWords("  Spanish SODA   tracker ", 40)).toBe("Spanish SODA tracker");
    expect(trimToWholeWords("RT-1068 local test plan: E2E setup, backend script", 40)).toBe("RT-1068 local test plan: E2E setup");
    expect(trimToWholeWords("Supercalifragilisticexpialidocious", 10)).toBe("Supercalif");
  });
});

describe("applyUserEdits", () => {
  it("adds a pinned ticket tag without dropping its other tags, and removal beats a pin", () => {
    const analysis: SessionAnalysis = {
      ...emptyAnalysis(),
      workstreams: [
        { id: "ws-1", title: "One", ticketKeys: ["SOA-1"], itemKeys: [PR_A], done: false },
        { id: "ws-2", title: "Two", ticketKeys: [], itemKeys: [], done: false },
      ],
    };
    const edited = applyUserEdits(analysis, edits({ pinnedItems: { "ticket:SOA-1": "ws-2", [PR_A]: "ws-2" }, removedItems: [PR_A] }));
    expect(edited.workstreams.map(({ ticketKeys, itemKeys }) => ({ ticketKeys, itemKeys }))).toEqual([
      { ticketKeys: ["SOA-1"], itemKeys: [] },
      { ticketKeys: ["SOA-1"], itemKeys: [] },
    ]);
  });

  it("reads stored edits defensively", () => {
    expect(readWorkstreamEdits("junk")).toEqual(emptyWorkstreamEdits());
    expect(
      readWorkstreamEdits({ workstreamTitles: { "ws-1": "Ok", "ws-2": 5 }, removedItems: ["pr:a/b/pull/1", 3], sessionDone: "yes" }),
    ).toEqual({ ...emptyWorkstreamEdits(), workstreamTitles: { "ws-1": "Ok" }, removedItems: ["pr:a/b/pull/1"] });
  });
});

describe("readSessionAnalysis", () => {
  it("returns empty state for junk and drops bad workstreams", () => {
    expect(readSessionAnalysis(null)).toEqual(emptyAnalysis());
    const analysis = readSessionAnalysis({
      workstreams: [
        { id: "ws-3", title: "Good", ticketKeys: ["soa-1", "nope"], itemKeys: [PR_A], done: true },
        { id: "ws-3", title: "Duplicate id" },
        { id: "ws-4", title: "" },
        { id: "ws-5", title: "Steals an item", itemKeys: [PR_A, PR_B] },
      ],
      where: ["one", 2, "two", "three", "four"],
      watermarkBytes: -5,
    });
    expect(analysis.workstreams).toEqual([
      { id: "ws-3", title: "Good", ticketKeys: ["SOA-1"], itemKeys: [PR_A], done: true },
      { id: "ws-5", title: "Steals an item", ticketKeys: [], itemKeys: [PR_B], done: false },
    ]);
    expect(analysis.where).toEqual(["one", "two", "three"]);
    expect(analysis.watermarkBytes).toBe(0);
    expect(analysis.nextWorkstreamNumber).toBe(6);
  });
});

describe("recheck drop guard", () => {
  function analysisWith(itemKeys: string[], ticketKeys: string[] = []): SessionAnalysis {
    return { ...emptyAnalysis(), workstreams: [{ id: "ws-1", title: "Fix retry bug", ticketKeys, itemKeys, done: false }] };
  }

  it("counts sorted items and tagged tickets that a recheck left unsorted", () => {
    const previousAnalysis = analysisWith([PR_A, PR_B, ARTIFACT], ["SOA-1"]);
    expect(recheckDropOf(previousAnalysis, analysisWith([PR_A]), edits())).toEqual({ droppedCount: 3, previouslyAssignedCount: 4 });
  });

  it("does not count items the user removed", () => {
    const previousAnalysis = analysisWith([PR_A, PR_B, ARTIFACT]);
    expect(recheckDropOf(previousAnalysis, analysisWith([PR_A]), edits({ removedItems: [PR_B] }))).toEqual({
      droppedCount: 1,
      previouslyAssignedCount: 2,
    });
  });

  it("allows up to 2 dropped items, or a quarter of the sorted items when that is more", () => {
    expect(isRecheckDropTooLarge({ droppedCount: 2, previouslyAssignedCount: 3 })).toBe(false);
    expect(isRecheckDropTooLarge({ droppedCount: 3, previouslyAssignedCount: 6 })).toBe(true);
    expect(isRecheckDropTooLarge({ droppedCount: 5, previouslyAssignedCount: 20 })).toBe(false);
    expect(isRecheckDropTooLarge({ droppedCount: 6, previouslyAssignedCount: 20 })).toBe(true);
  });

  it("never rejects a first pass with nothing sorted before", () => {
    expect(isRecheckDropTooLarge(recheckDropOf(emptyAnalysis(), emptyAnalysis(), edits()))).toBe(false);
  });
});
