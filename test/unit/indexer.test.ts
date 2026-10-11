import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanPrompt, displayTitle, indexSessions } from "../../src/indexer";
import { encodeProjectDir } from "../../src/paths";

const REPO_CWD = "/Users/dev/src/web-app";
const WORKTREE_CWD = "/Users/dev/src/web-app/.claude/worktrees/proj-2567";
const SESSION_ID = "8f4bd8be-25fb-43e0-81eb-cdd1ba8c4998";

let projectsRoot: string;

beforeEach(() => {
  projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "overseer-index-"));
});

afterEach(() => {
  fs.rmSync(projectsRoot, { recursive: true, force: true });
});

function writeTranscript(projectCwd: string, sessionId: string, records: unknown[], trailingText = ""): string {
  const projectPath = path.join(projectsRoot, encodeProjectDir(projectCwd));
  fs.mkdirSync(projectPath, { recursive: true });
  const transcriptFile = path.join(projectPath, `${sessionId}.jsonl`);
  const lines = records.map((record) => JSON.stringify(record)).join("\n");
  fs.writeFileSync(transcriptFile, lines + "\n" + trailingText);
  return transcriptFile;
}

function userRecord(cwd: string, content: unknown, extraFields: Record<string, unknown> = {}): unknown {
  return { type: "user", message: { role: "user", content }, cwd, gitBranch: "main", sessionId: SESSION_ID, ...extraFields };
}

describe("indexSessions", () => {
  it("reads cwd, branch, and first prompt past preamble records with no cwd", async () => {
    writeTranscript(REPO_CWD, SESSION_ID, [
      { type: "mode", mode: "default" },
      { type: "permission-mode", permissionMode: "auto" },
      userRecord(REPO_CWD, "fix the   login\n bug"),
      { type: "assistant", cwd: REPO_CWD, gitBranch: "fix/login", sessionId: SESSION_ID },
    ]);

    const { sessions } = await indexSessions(projectsRoot, {});

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: SESSION_ID,
      startCwd: REPO_CWD,
      resumeCwd: REPO_CWD,
      gitBranch: "fix/login",
      firstPrompt: "fix the login bug",
    });
  });

  it("takes the prompt from the first text block when content is an array", async () => {
    writeTranscript(REPO_CWD, SESSION_ID, [
      userRecord(REPO_CWD, [{ type: "image" }, { type: "text", text: "what is in this screenshot" }]),
    ]);

    const { sessions } = await indexSessions(projectsRoot, {});

    expect(sessions[0].firstPrompt).toBe("what is in this screenshot");
  });

  it("skips meta and sidechain user records when picking the first prompt", async () => {
    writeTranscript(REPO_CWD, SESSION_ID, [
      userRecord(REPO_CWD, "<local-command-caveat>Caveat</local-command-caveat>", { isMeta: true }),
      userRecord(REPO_CWD, "subagent prompt", { isSidechain: true }),
      userRecord(REPO_CWD, "the real prompt"),
    ]);

    const { sessions } = await indexSessions(projectsRoot, {});

    expect(sessions[0].firstPrompt).toBe("the real prompt");
  });

  it("uses the last custom title and prefers it over agent name and AI title", async () => {
    writeTranscript(REPO_CWD, SESSION_ID, [
      userRecord(REPO_CWD, "hello"),
      { type: "ai-title", aiTitle: "AI guess", sessionId: SESSION_ID },
      { type: "agent-name", agentName: "OPS-4410 Billing export", sessionId: SESSION_ID },
      { type: "custom-title", customTitle: "first name", sessionId: SESSION_ID },
      { type: "custom-title", customTitle: "PROJ-2567 final name", sessionId: SESSION_ID },
    ]);

    const { sessions } = await indexSessions(projectsRoot, {});

    expect(displayTitle(sessions[0])).toBe("PROJ-2567 final name");
  });

  it("keeps the newest recap and marks it stale once a new prompt follows", async () => {
    const recapRecord = (content: string, timestamp: string) => ({
      type: "system",
      subtype: "away_summary",
      content,
      timestamp,
      cwd: REPO_CWD,
      sessionId: SESSION_ID,
    });
    writeTranscript(REPO_CWD, SESSION_ID, [
      userRecord(REPO_CWD, "hello"),
      { type: "last-prompt", lastPrompt: "fix the login bug", sessionId: SESSION_ID },
      recapRecord("Old recap.", "2026-10-08T14:00:00.000Z"),
      recapRecord("Login fix is done. Next: run the tests. (disable recaps in /config)", "2026-10-08T15:00:00.000Z"),
    ]);

    const { sessions } = await indexSessions(projectsRoot, {});

    expect(sessions[0].lastPrompt).toBe("fix the login bug");
    expect(sessions[0].recap).toEqual({
      text: "Login fix is done. Next: run the tests.",
      writtenAtMs: Date.parse("2026-10-08T15:00:00.000Z"),
      isStale: false,
    });

    writeTranscript(REPO_CWD, SESSION_ID, [
      userRecord(REPO_CWD, "hello"),
      { type: "last-prompt", lastPrompt: "fix the login bug", sessionId: SESSION_ID },
      recapRecord("Login fix is done.", "2026-10-08T15:00:00.000Z"),
      { type: "last-prompt", lastPrompt: "now the signup bug", sessionId: SESSION_ID },
    ]);

    const { sessions: rescannedSessions } = await indexSessions(projectsRoot, {});

    expect(rescannedSessions[0].recap?.isStale).toBe(true);
  });

  it("falls back from agent name to AI title to first prompt", async () => {
    writeTranscript(REPO_CWD, SESSION_ID, [
      userRecord(REPO_CWD, "hello"),
      { type: "ai-title", aiTitle: "AI guess", sessionId: SESSION_ID },
    ]);

    const { sessions } = await indexSessions(projectsRoot, {});

    expect(displayTitle(sessions[0])).toBe("AI guess");
  });

  it("resumes a relocated worktree session from the cwd that matches its folder", async () => {
    writeTranscript(WORKTREE_CWD, SESSION_ID, [
      userRecord(REPO_CWD, "start in the repo"),
      { type: "assistant", cwd: REPO_CWD, sessionId: SESSION_ID },
      { type: "worktree-state", sessionId: SESSION_ID },
      { type: "assistant", cwd: WORKTREE_CWD, sessionId: SESSION_ID },
    ]);

    const { sessions } = await indexSessions(projectsRoot, {});

    expect(sessions[0].startCwd).toBe(REPO_CWD);
    expect(sessions[0].resumeCwd).toBe(WORKTREE_CWD);
  });

  it("ignores a cwd key that only appears inside escaped message text", async () => {
    writeTranscript(REPO_CWD, SESSION_ID, [
      userRecord(REPO_CWD, 'look at this json: {"cwd":"/somewhere/else"}'),
    ]);

    const { sessions } = await indexSessions(projectsRoot, {});

    expect(sessions[0].resumeCwd).toBe(REPO_CWD);
  });

  it("tolerates a truncated last line from a session still being written", async () => {
    writeTranscript(REPO_CWD, SESSION_ID, [userRecord(REPO_CWD, "hello")], '{"type":"custom-title","custom');

    const { sessions } = await indexSessions(projectsRoot, {});

    expect(sessions[0].firstPrompt).toBe("hello");
  });

  it("drops transcripts that never recorded a cwd", async () => {
    writeTranscript(REPO_CWD, SESSION_ID, [{ type: "mode", mode: "default" }]);

    const { sessions } = await indexSessions(projectsRoot, {});

    expect(sessions).toHaveLength(0);
  });

  it("reuses cached entries for unchanged files and rescans changed ones", async () => {
    const transcriptFile = writeTranscript(REPO_CWD, SESSION_ID, [userRecord(REPO_CWD, "hello")]);
    const firstRun = await indexSessions(projectsRoot, {});

    const secondRun = await indexSessions(projectsRoot, firstRun.cacheEntries);
    fs.appendFileSync(transcriptFile, JSON.stringify({ type: "custom-title", customTitle: "renamed" }) + "\n");
    const thirdRun = await indexSessions(projectsRoot, secondRun.cacheEntries);

    expect(firstRun.scannedFileCount).toBe(1);
    expect(secondRun.scannedFileCount).toBe(0);
    expect(thirdRun.scannedFileCount).toBe(1);
    expect(displayTitle(thirdRun.sessions[0])).toBe("renamed");
  });

  it("sorts sessions by most recent activity first", async () => {
    const olderSessionId = "11111111-1111-1111-1111-111111111111";
    const olderFile = writeTranscript(REPO_CWD, olderSessionId, [userRecord(REPO_CWD, "older")]);
    writeTranscript(REPO_CWD, SESSION_ID, [userRecord(REPO_CWD, "newer")]);
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    fs.utimesSync(olderFile, twoDaysAgo, twoDaysAgo);

    const { sessions } = await indexSessions(projectsRoot, {});

    expect(sessions.map((session) => session.firstPrompt)).toEqual(["newer", "older"]);
  });
});

describe("cleanPrompt", () => {
  it("turns a slash command invocation into the command plus its args", () => {
    const rawPrompt =
      "<command-message>djt-bug</command-message>\n<command-name>/djt-bug</command-name>\n<command-args>PROJ-2668 login loop</command-args>";
    expect(cleanPrompt(rawPrompt)).toBe("/djt-bug PROJ-2668 login loop");
  });

  it("strips system reminders", () => {
    expect(cleanPrompt("<system-reminder>ignore me</system-reminder>do the thing")).toBe("do the thing");
  });

  it("truncates long prompts", () => {
    const cleanedPrompt = cleanPrompt("x".repeat(500));
    expect(cleanedPrompt).toHaveLength(200);
    expect(cleanedPrompt?.endsWith("…")).toBe(true);
  });
});
