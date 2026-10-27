import { describe, expect, it } from "vitest";
import { emptyAnalysis } from "../../src/analysisState";
import { buildAnalyzerDigest, digestEventsOf } from "../../src/analyzerDigest";
import { AnalyzerOp, applyOps } from "../../src/analyzerOps";
import { enrichCandidates } from "../../src/candidateEnrichment";
import { createLinkScanState, scanLinkLine, summarizeAllCandidates } from "../../src/linkCandidates";
import { emptyWorkstreamEdits } from "../../src/workstreamEdits";

const FEATURE_AOS_PR = "pr:amira-rnd/assessments-orchestration/pull/1191";
const FEATURE_DATA_PR = "pr:amira-rnd/assessments-data/pull/504";
const FIX_DATA_PR = "pr:amira-rnd/assessments-data/pull/506";
const FIX_AOS_PR = "pr:amira-rnd/assessments-orchestration/pull/1196";
const QA_PROMPT = "we need to figure out why qa is getting an english orf";

function userPrompt(timestamp: string, text: string): string {
  return JSON.stringify({ type: "user", message: { content: text }, timestamp });
}

function createPr(timestamp: string, toolUseId: string, repo: string, prNumber: number, title: string): string[] {
  const command = `gh pr create --repo amira-rnd/${repo} --title "${title}"`;
  return [
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: toolUseId, name: "Bash", input: { command } }] }, timestamp }),
    JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: toolUseId, content: `https://github.com/amira-rnd/${repo}/pull/${prNumber}` }] },
      timestamp,
    }),
  ];
}

const SODA_TRANSCRIPT = [
  userPrompt("2026-10-22T20:00:00.000Z", "open the PRs for the Spanish SODA blueprints and AOS routing"),
  ...createPr("2026-10-22T20:10:00.000Z", "t1", "assessments-orchestration", 1191, "ASSMNT-2807: resolve Spanish SODA to Evaluar SODA blueprints"),
  ...createPr("2026-10-22T20:12:00.000Z", "t2", "assessments-data", 504, "ASSMNT-796: Add Evaluar SODA ORF blueprints"),
  userPrompt("2026-10-23T19:38:00.000Z", "Move the tickets to ready for qa that are merged and pushed to dev2"),
  userPrompt("2026-10-26T14:56:00.000Z", QA_PROMPT),
  userPrompt("2026-10-26T15:06:00.000Z", "ok do it and run it in local stack and we can prove it"),
  userPrompt("2026-10-26T15:23:00.000Z", "create the prs"),
  ...createPr("2026-10-26T15:24:00.000Z", "t3", "assessments-data", 506, "ASSMNT-798: Filter Evaluar SODA ORF to Spanish testlets"),
  ...createPr("2026-10-26T15:25:00.000Z", "t4", "assessments-orchestration", 1196, "ASSMNT-2807: keep Spanish testlets out of English SODA"),
];

function sodaDigest() {
  const scanState = createLinkScanState();
  for (const line of SODA_TRANSCRIPT) {
    scanLinkLine(scanState, line);
  }
  const candidates = enrichCandidates(summarizeAllCandidates(scanState), new Map(), new Map());
  return buildAnalyzerDigest({
    mode: "recheck",
    session: { title: "Spanish SODA", gitBranch: "main", cwd: "/repo" },
    analysis: emptyAnalysis(),
    edits: emptyWorkstreamEdits(),
    candidates,
    events: digestEventsOf(SODA_TRANSCRIPT),
    overlapPrompt: undefined,
    statusOptions: [],
    transcriptEndBytes: scanState.scannedBytes,
  });
}

function itemEntry(digestText: string, itemKey: string): string {
  const entryStart = digestText.indexOf(`\n- ${itemKey} |`);
  const nextEntryStart = digestText.indexOf("\n- ", entryStart + 1);
  return digestText.slice(entryStart, nextEntryStart === -1 ? undefined : nextEntryStart);
}

describe("analyzer timeline on a QA fix after shipped work", () => {
  it("orders items oldest first with their first-seen times", () => {
    const digest = sodaDigest();
    expect(digest.itemKeys).toEqual([FEATURE_AOS_PR, FEATURE_DATA_PR, FIX_DATA_PR, FIX_AOS_PR]);
    expect(itemEntry(digest.text, FEATURE_AOS_PR)).toContain("first seen 2026-10-22 20:10");
    expect(itemEntry(digest.text, FIX_AOS_PR)).toContain("first seen 2026-10-26 15:25");
  });

  it("attaches the prompt that started the QA fix to both fix PRs, not to the feature PRs", () => {
    const digest = sodaDigest();
    for (const fixPr of [FIX_DATA_PR, FIX_AOS_PR]) {
      expect(itemEntry(digest.text, fixPr)).toContain(`work began with user prompt [2026-10-26 14:56]: ${QA_PROMPT}`);
      expect(itemEntry(digest.text, fixPr)).toContain("user prompt when first seen: create the prs");
    }
    for (const featurePr of [FEATURE_AOS_PR, FEATURE_DATA_PR]) {
      expect(itemEntry(digest.text, featurePr)).not.toContain(QA_PROMPT);
    }
  });

  it("keeps the transcript in time order with stamped prompts", () => {
    const transcriptText = sodaDigest().text.split("Whole transcript")[1];
    const timeline = [
      "User [2026-10-22 20:00]: open the PRs",
      "User [2026-10-23 19:38]: Move the tickets to ready for qa",
      `User [2026-10-26 14:56]: ${QA_PROMPT}`,
      "User [2026-10-26 15:23]: create the prs",
    ].map((promptStart) => transcriptText.indexOf(promptStart));
    expect(timeline.every((position) => position !== -1)).toBe(true);
    expect([...timeline].sort((left, right) => left - right)).toEqual(timeline);
  });

  it("splits the QA fix into its own workstream when the model says so", () => {
    const digest = sodaDigest();
    const splitOps: AnalyzerOp[] = [
      { op: "create_workstream", ref: "new-1", title: "Spanish SODA blueprints and AOS" },
      { op: "create_workstream", ref: "new-2", title: "QA fix: English ORF on Spanish SODA" },
      { op: "assign_item", item: FEATURE_AOS_PR, workstream: "new-1" },
      { op: "assign_item", item: FEATURE_DATA_PR, workstream: "new-1" },
      { op: "assign_item", item: FIX_DATA_PR, workstream: "new-2" },
      { op: "assign_item", item: FIX_AOS_PR, workstream: "new-2" },
    ];
    const analysis = applyOps(emptyAnalysis(), splitOps, emptyWorkstreamEdits(), {
      mode: "recheck",
      knownItemKeys: new Set(digest.itemKeys),
      statusOptions: [],
    });
    expect(analysis.workstreams.map((workstream) => [workstream.title, workstream.itemKeys])).toEqual([
      ["Spanish SODA blueprints and AOS", [FEATURE_AOS_PR, FEATURE_DATA_PR]],
      ["QA fix: English ORF on Spanish SODA", [FIX_DATA_PR, FIX_AOS_PR]],
    ]);
  });
});
