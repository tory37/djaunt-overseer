import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createLinkScanState,
  fallbackRole,
  LinkCandidate,
  LinkScanState,
  scanLinkLine,
  scanTranscriptLinks,
  summarizeCandidates,
} from "../../src/linkCandidates";
import { loadLinkCache, saveLinkCache } from "../../src/linkCache";
import { findTicketKeysInText } from "../../src/ticket";

const PR_URL = "https://github.com/acme/web-app/pull/2384";
const OTHER_PR_URL = "https://github.com/acme/api/pull/77";
const ARTIFACT_URL = "https://claude.ai/artifact/G6QrRRBpv1HyNzN2Udxaub";

function toolUse(id: string, name: string, input: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: "2026-10-05T14:30:00.000Z",
    gitBranch: "feat/proj-1068-spanish-soda",
    message: { content: [{ type: "tool_use", id, name, input }] },
    ...extra,
  });
}

function toolResult(toolUseId: string, content: unknown): string {
  return JSON.stringify({
    type: "user",
    timestamp: "2026-10-05T14:30:05.000Z",
    message: { content: [{ type: "tool_result", tool_use_id: toolUseId, content }] },
  });
}

function userPrompt(text: string): string {
  return JSON.stringify({ type: "user", timestamp: "2026-10-05T14:00:00.000Z", message: { role: "user", content: text } });
}

function scanAll(lines: string[]): LinkScanState {
  const state = createLinkScanState();
  for (const line of lines) {
    scanLinkLine(state, line);
  }
  return state;
}

function find(candidates: LinkCandidate[], kind: string, id: string): LinkCandidate | undefined {
  return candidates.find((candidate) => candidate.kind === kind && candidate.id === id);
}

describe("scanLinkLine", () => {
  it("marks a PR from gh pr create output as owned, with its title", () => {
    const state = scanAll([
      toolUse("t1", "Bash", { command: 'gh pr create --base develop --title "PROJ-1068: Spanish SODA" --body "x"' }),
      toolResult("t1", PR_URL),
    ]);
    const pr = find(summarizeCandidates(state), "pr", "acme/web-app/pull/2384");

    expect(pr).toMatchObject({ url: PR_URL, title: "PROJ-1068: Spanish SODA" });
    expect(pr?.signals["pr-created"]).toBe(1);
    expect(fallbackRole(pr!)).toBe("owned");
  });

  it("marks a pr-link record alone as touched", () => {
    const state = scanAll([JSON.stringify({ type: "pr-link", prNumber: 2384, prUrl: PR_URL })]);
    expect(fallbackRole(find(summarizeCandidates(state), "pr", "acme/web-app/pull/2384")!)).toBe("touched");
  });

  it("resolves gh pr number plus --repo, and ranks a comment as touched", () => {
    const state = scanAll([toolUse("t1", "Bash", { command: "gh pr comment 77 -R acme/api --body-file /tmp/c.md" })]);
    const pr = find(summarizeCandidates(state), "pr", "acme/api/pull/77");

    expect(pr?.url).toBe(OTHER_PR_URL);
    expect(fallbackRole(pr!)).toBe("touched");
  });

  it("keeps a PR that is only mentioned in tool output as mentioned", () => {
    const state = scanAll([toolResult("unrelated", `see ${OTHER_PR_URL} for context`)]);
    const pr = find(summarizeCandidates(state), "pr", "acme/api/pull/77");

    expect(fallbackRole(pr!)).toBe("mentioned");
    expect(pr?.snippets[0]).toContain("for context");
  });

  it("splits Jira writes from reads and learns the site from cloudId", () => {
    const state = scanAll([
      toolUse("j1", "mcp__jira__jira_comments", { action: "add", issue_key: "PROJ-2668", body: { text: "see OPS-1" } }),
      toolUse("j2", "mcp__claude_ai_Atlassian__getJiraIssue", { cloudId: "acme.atlassian.net", issueIdOrKey: "PROJ-798" }),
      toolUse("j3", "mcp__jira__jira_issues", { action: "transition", transitions: [["PROJ-5", "Done"]] }),
      toolUse("j4", "mcp__jira__jira_issues", { action: "search", jql: "key = PROJ-9" }),
    ]);
    const candidates = summarizeCandidates(state);

    expect(fallbackRole(find(candidates, "ticket", "PROJ-2668")!)).toBe("touched");
    expect(fallbackRole(find(candidates, "ticket", "PROJ-5")!)).toBe("touched");
    expect(find(candidates, "ticket", "PROJ-798")).toMatchObject({
      url: "https://acme.atlassian.net/browse/PROJ-798",
      signals: { "ticket-read": 1 },
    });
    expect(find(candidates, "ticket", "OPS-1")).toBeUndefined();
    expect(find(candidates, "ticket", "PROJ-9")).toBeUndefined();
  });

  it("adds the branch ticket as owned", () => {
    const state = scanAll([toolUse("t1", "Read", { file_path: "/x" })]);
    expect(fallbackRole(find(summarizeCandidates(state), "ticket", "PROJ-1068")!)).toBe("owned");
  });

  it("takes ticket keys typed by the user but not from system reminders", () => {
    const state = scanAll([userPrompt("work on PROJ-42 please <system-reminder>PROJ-1615 example</system-reminder>")]);
    const candidates = summarizeCandidates(state);

    expect(find(candidates, "ticket", "PROJ-42")?.signals["user-mention"]).toBe(1);
    expect(find(candidates, "ticket", "PROJ-1615")).toBeUndefined();
  });

  it("skips compaction summaries and meta records such as skill bodies", () => {
    const summaryLine = JSON.stringify({
      type: "user",
      isCompactSummary: true,
      message: { role: "user", content: `Tested the judge on CR-10770 and ${PR_URL}` },
    });
    const skillBodyLine = JSON.stringify({
      type: "user",
      isMeta: true,
      message: { role: "user", content: [{ type: "text", text: "/djt-test-plan PROJ-1615 # work from a ticket" }] },
    });
    const candidates = summarizeCandidates(scanAll([summaryLine, skillBodyLine]));

    expect(candidates).toEqual([]);
  });

  it("records the URL from an Artifact publish result as owned", () => {
    const state = scanAll([
      toolUse("a1", "Artifact", { file_path: "/tmp/plan.html", icon: "checklist" }),
      toolResult("a1", `Published /tmp/plan.html at ${ARTIFACT_URL} (Version 1) see also https://claude.ai/artifact/Other123`),
    ]);
    const candidates = summarizeCandidates(state);

    expect(fallbackRole(find(candidates, "artifact", "G6QrRRBpv1HyNzN2Udxaub")!)).toBe("owned");
    expect(find(candidates, "artifact", "Other123")?.signals["artifact-published"]).toBeUndefined();
  });

  it("sorts owned links before touched and mentioned", () => {
    const state = scanAll([
      toolResult("x", `mention ${OTHER_PR_URL}`),
      toolUse("t1", "Bash", { command: "gh pr view 2384 -R acme/web-app" }),
      JSON.stringify({ type: "pr-link", prUrl: PR_URL }),
    ]);
    expect(summarizeCandidates(state).map((candidate) => candidate.id)).toEqual([
      "PROJ-1068",
      "acme/web-app/pull/2384",
      "acme/api/pull/77",
    ]);
  });
});

describe("findTicketKeysInText", () => {
  it("needs the hyphen and skips non-ticket prefixes", () => {
    expect(findTicketKeysInText("PROJ-1 and OPS 2 and UTF-8 and PROJ-1 again")).toEqual(["PROJ-1"]);
  });
});

describe("scanTranscriptLinks", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "overseer-links-"));
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it("scans only appended lines and leaves a partial last line for the next pass", async () => {
    const transcriptFile = path.join(workDir, "session.jsonl");
    fs.writeFileSync(transcriptFile, toolUse("t1", "Bash", { command: "gh pr create --title \"x\"" }) + "\n");

    const firstPass = await scanTranscriptLinks(transcriptFile, undefined);
    expect(firstPass?.state.pendingToolCalls.t1?.signal).toBe("pr-created");

    const resultLine = toolResult("t1", PR_URL);
    fs.appendFileSync(transcriptFile, resultLine.slice(0, 20));
    const partialPass = await scanTranscriptLinks(transcriptFile, firstPass);
    expect(partialPass?.offsetBytes).toBe(firstPass?.offsetBytes);

    fs.appendFileSync(transcriptFile, resultLine.slice(20) + "\n");
    const secondPass = await scanTranscriptLinks(transcriptFile, partialPass);
    const pr = find(summarizeCandidates(secondPass!.state), "pr", "acme/web-app/pull/2384");

    expect(pr?.signals["pr-created"]).toBe(1);
    expect(secondPass?.offsetBytes).toBe(fs.statSync(transcriptFile).size);
  });

  it("rescans from the start when the file shrank", async () => {
    const transcriptFile = path.join(workDir, "session.jsonl");
    fs.writeFileSync(transcriptFile, toolResult("x", `see ${OTHER_PR_URL}`) + "\n" + toolResult("y", `see ${PR_URL}`) + "\n");
    const firstPass = await scanTranscriptLinks(transcriptFile, undefined);

    fs.writeFileSync(transcriptFile, toolResult("x", `see ${OTHER_PR_URL}`) + "\n");
    const rescan = await scanTranscriptLinks(transcriptFile, firstPass);

    expect(Object.keys(rescan!.state.candidates)).toEqual(["pr:acme/api/pull/77"]);
  });

  it("round-trips through the cache file", async () => {
    const transcriptFile = path.join(workDir, "session.jsonl");
    fs.writeFileSync(transcriptFile, JSON.stringify({ type: "pr-link", prUrl: PR_URL }) + "\n");
    const entry = await scanTranscriptLinks(transcriptFile, undefined);
    const cacheFile = path.join(workDir, "cache", "session-links.json");

    await saveLinkCache(cacheFile, { [transcriptFile]: entry! });

    expect(await loadLinkCache(cacheFile)).toEqual({ [transcriptFile]: entry });
  });
});
