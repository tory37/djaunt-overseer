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
  scanStatsSince,
  scanTranscriptLinks,
  summarizeAllCandidates,
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

function commitResult(toolUseId: string, stdout: string, commitSha: string): string {
  return JSON.stringify({
    type: "user",
    timestamp: "2026-10-05T14:31:00.000Z",
    cwd: "/repo/web-app",
    message: { content: [{ type: "tool_result", tool_use_id: toolUseId, content: stdout }] },
    toolUseResult: { stdout, stderr: "", gitOperation: { commit: { sha: commitSha, kind: "committed" } } },
  });
}

function collectorTranscript(): string[] {
  return [
    JSON.stringify({ type: "user", cwd: "/repo/web-app", message: { role: "user", content: "fix the option tile bug QA found" } }),
    toolUse("c1", "Bash", { command: 'git add -A && git commit -m "PROJ-1068: fix tile"' }, { cwd: "/repo/web-app" }),
    commitResult("c1", "[feat/tile 09912f0e8] PROJ-1068: fix tile\n 2 files changed", "09912f0e8"),
    userPrompt("<local-command-stdout>Compacted</local-command-stdout>"),
    userPrompt("now publish the test plan"),
    toolUse("w1", "Write", { file_path: "/scratch/plan.html", content: "<html><head><title>SODA test plan</title></head></html>" }),
    toolUse("a1", "Artifact", { file_path: "/scratch/plan.html", icon: "checklist", description: "Steps to test the tile fix." }),
    toolResult("a1", `Published /scratch/plan.html at ${ARTIFACT_URL} (Version 1)`),
  ];
}

describe("collector candidates", () => {
  it("records a commit with its subject, branch, and directory, counted once", () => {
    const state = scanAll(collectorTranscript());
    const commit = find(summarizeAllCandidates(state), "commit", "09912f0e8");

    expect(commit).toMatchObject({ title: "PROJ-1068: fix tile", branch: "feat/tile", directory: "/repo/web-app" });
    expect(commit?.signals["commit-created"]).toBe(1);
    expect(fallbackRole(commit!)).toBe("owned");
  });

  it("keeps commits out of the judge and sidebar list", () => {
    const state = scanAll(collectorTranscript());

    expect(summarizeCandidates(state).some((candidate) => candidate.kind === "commit")).toBe(false);
  });

  it("names the repo from git -C and keeps the full hash Claude Code recorded", () => {
    const fullSha = "5c4cd8906" + "a".repeat(31);
    const state = scanAll([
      toolUse("c1", "Bash", { command: "git -C ../api commit -m x" }, { cwd: "/repo/web-app" }),
      commitResult("c1", "[main 5c4cd8906] x", fullSha),
    ]);
    const commit = find(summarizeAllCandidates(state), "commit", "5c4cd8906");

    expect(commit).toMatchObject({ directory: "/repo/api", fullHash: fullSha });
    expect(summarizeAllCandidates(state).filter((candidate) => candidate.kind === "commit")).toHaveLength(1);
  });

  it("finds a quiet commit through the git log --oneline in the same call", () => {
    const command = 'cd ~/src/api && git add -A && git commit -q -m "$(cat <<\'EOF\'\nPROJ-9: filter testlets\n\nBody.\nEOF\n)" && git log --oneline -2';
    const state = scanAll([
      toolUse("c1", "Bash", { command }, { cwd: "/repo/web-app" }),
      toolResult("c1", "8e3be43 PROJ-9: filter testlets\n1111111 older commit"),
    ]);
    const commits = summarizeAllCandidates(state).filter((candidate) => candidate.kind === "commit");

    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({ id: "8e3be43", title: "PROJ-9: filter testlets", directory: path.join(os.homedir(), "src/api") });
  });

  it("ignores commit-shaped text in results of non-git commands", () => {
    const state = scanAll([toolUse("c1", "Bash", { command: "cat notes.txt" }), commitResult("c1", "[main 1a2b3c4] x", "1a2b3c4")]);

    expect(summarizeAllCandidates(state).filter((candidate) => candidate.kind === "commit")).toEqual([]);
  });

  it("titles a published artifact from the written file and keeps its description", () => {
    const state = scanAll(collectorTranscript());
    const artifact = find(summarizeAllCandidates(state), "artifact", "G6QrRRBpv1HyNzN2Udxaub");

    expect(artifact).toMatchObject({
      title: "SODA test plan",
      description: "Steps to test the tile fix.",
      filePath: "/scratch/plan.html",
    });
  });

  it("prefers the title field of a typed artifact create", () => {
    const state = scanAll([
      toolUse("a1", "Artifact", { action: "publish", type_url: "https://claude.ai/artifact/type1", title: "Release notes" }),
      toolResult("a1", `Created ${ARTIFACT_URL}`),
    ]);

    expect(find(summarizeAllCandidates(state), "artifact", "G6QrRRBpv1HyNzN2Udxaub")?.title).toBe("Release notes");
  });

  it("titles a read artifact from the page HTML in the result", () => {
    const state = scanAll([
      toolUse("r1", "Artifact", { action: "read", url: `${ARTIFACT_URL}?sk=abc`, prompt: "list tickets" }),
      toolResult("r1", [{ type: "text", text: "raw HTML follows\n<html><title>Backend work</title></html>" }]),
    ]);

    expect(find(summarizeAllCandidates(state), "artifact", "G6QrRRBpv1HyNzN2Udxaub")?.title).toBe("Backend work");
    expect(state.pendingToolCalls).toEqual({});
  });

  it("survives malformed Artifact input", () => {
    const state = scanAll([
      toolUse("a1", "Artifact", { file_path: 42, description: ["x"], title: null }),
      toolResult("a1", `Published at ${ARTIFACT_URL}`),
      "{not json",
    ]);

    expect(find(summarizeAllCandidates(state), "artifact", "G6QrRRBpv1HyNzN2Udxaub")?.title).toBeUndefined();
  });

  it("records the nearest real user prompt and the byte offsets on each candidate", () => {
    const lines = collectorTranscript();
    const state = scanAll(lines);
    const candidates = summarizeAllCandidates(state);
    const commit = find(candidates, "commit", "09912f0e8")!;
    const artifact = find(candidates, "artifact", "G6QrRRBpv1HyNzN2Udxaub")!;
    const lineEndOffsets = lines.map((_, index) => lines.slice(0, index + 1).join("\n").length + 1);

    expect(commit.promptBeforeFirstSeen).toBe("fix the option tile bug QA found");
    expect(artifact.promptBeforeLastSeen).toBe("now publish the test plan");
    expect(commit.lastSeenOffsetBytes).toBe(lineEndOffsets[2]);
    expect(artifact.firstSeenOffsetBytes).toBe(lineEndOffsets[7]);
  });

  it("treats a user prompt's own ticket mention as preceded by that prompt", () => {
    const state = scanAll([userPrompt("start on PROJ-77 please")]);

    expect(find(summarizeAllCandidates(state), "ticket", "PROJ-77")?.promptBeforeFirstSeen).toBe("start on PROJ-77 please");
  });

  it("counts only typed prompts and slash commands with arguments", () => {
    const state = scanAll([
      userPrompt("first"),
      userPrompt("<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>"),
      userPrompt("<command-name>/djt-work</command-name>\n<command-args>bug PROJ-9</command-args>"),
      userPrompt("<task-notification>agent done</task-notification>"),
      userPrompt("[Request interrupted by user]"),
      userPrompt("<system-reminder>only a reminder</system-reminder>"),
      JSON.stringify({ type: "user", isMeta: true, message: { content: "skill body" } }),
      toolResult("t1", "a tool result"),
    ]);

    expect(state.userPromptEndOffsets).toHaveLength(2);
    expect(state.latestPrompt?.text).toBe("/djt-work bug PROJ-9");
  });

  it("clips long prompts", () => {
    const state = scanAll([userPrompt("x".repeat(1000))]);

    expect(state.latestPrompt?.text.length).toBe(300);
  });

  it("counts new prompts and bytes after an offset", () => {
    const lines = [userPrompt("one"), userPrompt("two"), toolResult("t1", "ok"), userPrompt("three")];
    const state = scanAll(lines);
    const afterFirstLine = Buffer.byteLength(lines[0]) + 1;

    expect(scanStatsSince(state, afterFirstLine)).toEqual({
      scannedBytes: state.scannedBytes,
      userPromptCount: 3,
      newBytes: state.scannedBytes - afterFirstLine,
      newUserPromptCount: 2,
    });
    expect(scanStatsSince(state, state.scannedBytes).newUserPromptCount).toBe(0);
    expect(scanStatsSince(state, 0).newUserPromptCount).toBe(3);
  });
});

describe("scanTranscriptLinks collector", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "overseer-collector-"));
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it("gives the same candidates and stats when resumed from an offset as a full scan", async () => {
    const lines = collectorTranscript();
    const transcriptFile = path.join(workDir, "session.jsonl");
    fs.writeFileSync(transcriptFile, lines.slice(0, 3).join("\n") + "\n");
    const firstPass = await scanTranscriptLinks(transcriptFile, undefined);
    fs.appendFileSync(transcriptFile, lines.slice(3).join("\n") + "\n");
    const resumedPass = await scanTranscriptLinks(transcriptFile, firstPass);

    const fullFile = path.join(workDir, "full.jsonl");
    fs.writeFileSync(fullFile, lines.join("\n") + "\n");
    const fullPass = await scanTranscriptLinks(fullFile, undefined);

    expect(resumedPass!.offsetBytes).toBe(fullPass!.offsetBytes);
    expect(summarizeAllCandidates(resumedPass!.state)).toEqual(summarizeAllCandidates(fullPass!.state));
    expect(scanStatsSince(resumedPass!.state, firstPass!.offsetBytes)).toEqual(scanStatsSince(fullPass!.state, firstPass!.offsetBytes));
    expect(scanStatsSince(resumedPass!.state, firstPass!.offsetBytes).newUserPromptCount).toBe(1);
  });

  it("reads the title from the published file when the transcript has none, and skips a missing file", async () => {
    const pageFile = path.join(workDir, "page.html");
    fs.writeFileSync(pageFile, "<!doctype html><title>Ship order</title>");
    const transcriptFile = path.join(workDir, "session.jsonl");
    const lines = [
      toolUse("a1", "Artifact", { file_path: pageFile }),
      toolResult("a1", `Published at ${ARTIFACT_URL}`),
      toolUse("a2", "Artifact", { file_path: path.join(workDir, "gone.html") }),
      toolResult("a2", "Published at https://claude.ai/artifact/Other123"),
    ];
    fs.writeFileSync(transcriptFile, lines.join("\n") + "\n");

    const entry = await scanTranscriptLinks(transcriptFile, undefined);
    const candidates = summarizeAllCandidates(entry!.state);

    expect(find(candidates, "artifact", "G6QrRRBpv1HyNzN2Udxaub")?.title).toBe("Ship order");
    expect(find(candidates, "artifact", "Other123")?.title).toBeUndefined();
  });
});
