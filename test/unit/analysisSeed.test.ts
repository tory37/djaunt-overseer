import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { declaredTicketsFile } from "../../src/agentTickets";
import { declaredWorkFile } from "../../src/agentWork";
import { whereFile } from "../../src/agentTracker";
import { pullRequestItemKey, seedAnalysis } from "../../src/analysisSeed";
import { ANALYSIS_SCHEMA_VERSION, emptyAnalysis } from "../../src/analysisState";
import { analysisFile, loadAnalysis, loadLegacySessionData, saveAnalysis } from "../../src/analysisStore";

const PR_URL = "https://github.com/Amira/API/pull/7";
const PR_KEY = "pr:amira/api/pull/7";
const ARTIFACT_URL = "https://claude.ai/artifact/plan-123";

describe("seedAnalysis", () => {
  it("turns declared data into background facts and link marks into kept and removed keys, never workstreams or edits", () => {
    const seededAnalysis = seedAnalysis({
      declaredTickets: [
        { key: "SOA-1", note: "Story: retry bug. In Progress.", parentKey: "SOA-0", addedAt: 1 },
        { key: "SOA-2", addedAt: 2 },
      ],
      work: {
        commits: [{ hash: "ABC1234", note: "fix retry", addedAt: 3 }],
        pullRequests: [
          { url: PR_URL, parentKey: "SOA-1", addedAt: 4 },
          { url: "https://github.com/amira/web/pull/8", addedAt: 5 },
        ],
        artifacts: [{ url: ARTIFACT_URL, note: "Test plan", parentKey: PR_URL, addedAt: 6 }],
      },
      where: { lines: ["Waiting on QA"], updatedAt: 7, doneAt: 8 },
      linkMarks: { "ticket:SOA-2": "removed", [PR_KEY]: "pinned", "ticket:SOA-9": "pinned" },
    });
    expect(seededAnalysis.workstreams).toEqual([]);
    expect(seededAnalysis.nextWorkstreamNumber).toBe(1);
    expect(seededAnalysis.seedFacts).toEqual({
      knownItems: [
        { itemKey: "ticket:SOA-1", note: "Story: retry bug. In Progress.", parentKey: "SOA-0" },
        { itemKey: "ticket:SOA-2" },
        { itemKey: "commit:abc1234", note: "fix retry" },
        { itemKey: PR_KEY, parentKey: "SOA-1" },
        { itemKey: "pr:amira/web/pull/8" },
        { itemKey: "artifact:plan-123", note: "Test plan", parentKey: PR_KEY },
      ],
      keptItemKeys: [PR_KEY, "ticket:SOA-9"],
      removedItemKeys: ["ticket:SOA-2"],
    });
    expect(seededAnalysis.artifactTitles).toEqual({ "artifact:plan-123": "Test plan" });
    expect(seededAnalysis.where).toEqual(["Waiting on QA"]);
    expect(seededAnalysis.sessionDone).toBe(true);
    expect(seededAnalysis.watermarkBytes).toBe(0);
  });

  it("seeds empty state from nothing", () => {
    expect(seedAnalysis({ declaredTickets: [], work: { commits: [], pullRequests: [], artifacts: [] }, where: undefined, linkMarks: {} })).toEqual(
      emptyAnalysis(),
    );
  });

  it("builds PR keys the way the scanner does", () => {
    expect(pullRequestItemKey(`${PR_URL}/files`)).toBe(PR_KEY);
    expect(pullRequestItemKey("not a url")).toBeUndefined();
  });
});

describe("analysis files", () => {
  let claudeHome: string | undefined;
  afterEach(() => {
    if (claudeHome !== undefined) {
      fs.rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("reads missing and older-schema files as undefined, corrupt as empty, and round-trips saved state", async () => {
    claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), "overseer-analysis-"));
    const file = analysisFile(claudeHome, "s1");
    expect(await loadAnalysis(file)).toBeUndefined();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: ANALYSIS_SCHEMA_VERSION - 1, entries: { workstreams: [{ id: "ws-1", title: "SOA-1: old" }] } }));
    expect(await loadAnalysis(file)).toBeUndefined();
    fs.writeFileSync(file, "{not json");
    expect(await loadAnalysis(file)).toEqual(emptyAnalysis());
    const analysis = { ...emptyAnalysis(), where: ["Shipped"], watermarkBytes: 42 };
    await saveAnalysis(file, analysis);
    expect(await loadAnalysis(file)).toEqual(analysis);
  });

  it("loads the old declared files without changing them", async () => {
    claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), "overseer-legacy-"));
    const legacyFiles = {
      [declaredTicketsFile(claudeHome, "s1")]: { version: 1, entries: [{ key: "SOA-1", addedAt: 1 }] },
      [declaredWorkFile(claudeHome, "s1")]: { version: 1, entries: { pullRequests: [{ url: PR_URL, parentKey: "SOA-1", addedAt: 2 }] } },
      [whereFile(claudeHome, "s1")]: { version: 1, entries: { lines: ["Half done"], updatedAt: 3 } },
    };
    for (const [file, content] of Object.entries(legacyFiles)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(content));
    }
    const legacyData = await loadLegacySessionData(claudeHome, "s1", {});
    expect(seedAnalysis(legacyData).seedFacts.knownItems.map((knownItem) => knownItem.itemKey)).toEqual(["ticket:SOA-1", PR_KEY]);
    expect(legacyData.where?.lines).toEqual(["Half done"]);
    for (const [file, content] of Object.entries(legacyFiles)) {
      expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(content);
    }
  });
});
