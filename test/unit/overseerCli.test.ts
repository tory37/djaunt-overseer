import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { AGENT_TICKETS_SCHEMA_VERSION, declaredTicketsFile, userTicketMarksFile } from "../../src/agentTickets";
import { AGENT_TRACKER_SCHEMA_VERSION, whereFile } from "../../src/agentTracker";
import { AGENT_WORK_SCHEMA_VERSION, declaredWorkFile } from "../../src/agentWork";
import { OVERSEER_USAGE, runOverseerCli } from "../../src/overseerCli";
import { saveVersionedCache } from "../../src/linkCache";
import { STATUS_SYNC_SCHEMA_VERSION, statusContextFile, statusOptionsFile, statusRequestFile } from "../../src/sessionStatusSync";

const SESSION_ID = "0b1e7a6c-1f7e-4a5e-9d7e-2b8c3f1a9e10";
const SESSION_ENV = { CLAUDE_CODE_SESSION_ID: SESSION_ID };

let claudeHome: string;

beforeEach(() => {
  claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), "overseer-cli-"));
});

function readDeclaredFile(sessionId: string = SESSION_ID): unknown {
  return JSON.parse(fs.readFileSync(declaredTicketsFile(claudeHome, sessionId), "utf8"));
}

describe("runOverseerCli", () => {
  it("prints usage for --help and no arguments", async () => {
    expect(await runOverseerCli(["--help"], {}, claudeHome)).toEqual({ exitCode: 0, output: OVERSEER_USAGE });
    expect(await runOverseerCli([], {}, claudeHome)).toEqual({ exitCode: 0, output: OVERSEER_USAGE });
  });

  it("adds, lists, and removes a ticket", async () => {
    const added = await runOverseerCli(["ticket", "add", "proj-12", "--note", "fixing", "login"], SESSION_ENV, claudeHome, 100);
    expect(added).toEqual({ exitCode: 0, output: "Declared PROJ-12.\nWorking on:\n  PROJ-12  (fixing login)" });
    expect(readDeclaredFile()).toEqual({
      version: AGENT_TICKETS_SCHEMA_VERSION,
      entries: [{ key: "PROJ-12", note: "fixing login", addedAt: 100 }],
    });

    const listed = await runOverseerCli(["ticket", "list"], SESSION_ENV, claudeHome);
    expect(listed.output).toBe("Working on:\n  PROJ-12  (fixing login)");

    const removed = await runOverseerCli(["ticket", "remove", "PROJ-12"], SESSION_ENV, claudeHome);
    expect(removed).toEqual({ exitCode: 0, output: "Removed PROJ-12.\nNo tickets declared for this session." });
  });

  it("shows the user's panel marks in the list", async () => {
    const marksFile = userTicketMarksFile(claudeHome, SESSION_ID);
    fs.mkdirSync(path.dirname(marksFile), { recursive: true });
    fs.writeFileSync(marksFile, JSON.stringify({ version: AGENT_TICKETS_SCHEMA_VERSION, entries: { pinned: [], removed: ["PROJ-7"] } }));

    const listed = await runOverseerCli(["ticket", "list"], SESSION_ENV, claudeHome);
    expect(listed.output).toBe("Removed by the user (do not declare again):\n  PROJ-7");
  });

  it("falls back to OVERSEER_SESSION_ID", async () => {
    await runOverseerCli(["ticket", "add", "PROJ-1"], { OVERSEER_SESSION_ID: "fallback-id" }, claudeHome, 1);
    expect(readDeclaredFile("fallback-id")).toEqual({ version: AGENT_TICKETS_SCHEMA_VERSION, entries: [{ key: "PROJ-1", addedAt: 1 }] });
  });

  it.each([
    [["ticket", "add", "not-a-key!"], "Not a Jira ticket key: not-a-key!"],
    [["ticket", "add"], "Not a Jira ticket key: (missing)"],
    [["ticket", "remove", "PROJ-1", "--note", "x"], "Unexpected arguments: --note x"],
    [["ticket", "add", "PROJ-1", "--note"], "Unexpected arguments: --note"],
    [["ticket", "close", "PROJ-1"], "Unknown ticket action: close"],
    [["pr", "add"], "Not a GitHub pull request URL: (missing)"],
    [["commit", "add", "xyz"], "Not a commit hash: xyz"],
    [["commit", "squash", "abc1234"], "Unknown commit action: squash"],
    [["branch", "add"], "Unknown command: branch add"],
  ])("rejects %o with usage", async (args, message) => {
    const result = await runOverseerCli(args, SESSION_ENV, claudeHome);
    expect(result.exitCode).toBe(2);
    expect(result.output.startsWith(`${message}\n\n`)).toBe(true);
  });

  it("declares commits and pull requests in the work file", async () => {
    await runOverseerCli(["commit", "add", "ABC1234", "--note", "fix the loop"], SESSION_ENV, claudeHome, 100);
    const added = await runOverseerCli(["pr", "add", "https://github.com/o/r/pull/12/files"], SESSION_ENV, claudeHome, 200);
    expect(added.output).toBe(
      "Declared https://github.com/o/r/pull/12.\nCommits:\n  abc1234  (fix the loop)\nPull requests:\n  https://github.com/o/r/pull/12",
    );
    expect(JSON.parse(fs.readFileSync(declaredWorkFile(claudeHome, SESSION_ID), "utf8"))).toEqual({
      version: AGENT_WORK_SCHEMA_VERSION,
      entries: {
        commits: [{ hash: "abc1234", note: "fix the loop", addedAt: 100 }],
        pullRequests: [{ url: "https://github.com/o/r/pull/12", addedAt: 200 }],
        artifacts: [],
      },
    });

    const removed = await runOverseerCli(["commit", "remove", "abc1234"], SESSION_ENV, claudeHome);
    expect(removed.output).toBe("Removed abc1234.\nPull requests:\n  https://github.com/o/r/pull/12");
  });

  it("declares artifacts with a note and a parent", async () => {
    const artifactUrl = "https://claude.ai/code/artifact/abc-123";
    const added = await runOverseerCli(
      ["artifact", "add", `${artifactUrl}?tab=1`, "--parent", "proj-7", "--note", "release", "plan"],
      SESSION_ENV,
      claudeHome,
      300,
    );
    expect(added).toEqual({ exitCode: 0, output: `Declared ${artifactUrl}.\nArtifacts:\n  ${artifactUrl}  (release plan)` });
    await runOverseerCli(["artifact", "add", artifactUrl, "--parent", "https://github.com/o/r/pull/12/files"], SESSION_ENV, claudeHome, 400);
    expect(JSON.parse(fs.readFileSync(declaredWorkFile(claudeHome, SESSION_ID), "utf8")).entries.artifacts).toEqual([
      { url: artifactUrl, note: "release plan", parentKey: "https://github.com/o/r/pull/12", addedAt: 300 },
    ]);

    expect((await runOverseerCli(["artifact", "list"], SESSION_ENV, claudeHome)).output).toBe(
      `Artifacts:\n  ${artifactUrl}  (release plan)`,
    );
    const removed = await runOverseerCli(["artifact", "remove", artifactUrl], SESSION_ENV, claudeHome);
    expect(removed.exitCode).toBe(0);
    expect(JSON.parse(fs.readFileSync(declaredWorkFile(claudeHome, SESSION_ID), "utf8")).entries.artifacts).toEqual([]);
  });

  it.each([
    [["artifact", "add", "https://example.com/artifact/abc"], "Not a claude.ai artifact URL: https://example.com/artifact/abc"],
    [["artifact", "add"], "Not a claude.ai artifact URL: (missing)"],
    [["artifact", "add", "https://claude.ai/artifact/abc", "--parent", "not a key"], "Not a Jira ticket key or GitHub pull request URL: not a key"],
    [["artifact", "add", "https://claude.ai/artifact/abc", "--note"], "Unexpected arguments: --note"],
    [["artifact", "add", "https://claude.ai/artifact/abc", "--note", "a", "--note", "b"], "Unexpected arguments: --note a --note b"],
    [["artifact", "remove", "https://claude.ai/artifact/abc", "--parent", "PROJ-1"], "Unexpected arguments: --parent PROJ-1"],
    [["pr", "add", "https://github.com/o/r/pull/12", "--parent", "PROJ-1"], "Unexpected arguments: --parent PROJ-1"],
    [["artifact", "rename", "https://claude.ai/artifact/abc"], "Unknown artifact action: rename"],
  ])("rejects bad artifact arguments: %o", async (args, message) => {
    const result = await runOverseerCli(args, SESSION_ENV, claudeHome);
    expect(result).toEqual({ exitCode: 2, output: `${message}\n\n${OVERSEER_USAGE}` });
    expect(fs.existsSync(declaredWorkFile(claudeHome, SESSION_ID))).toBe(false);
  });

  it.each([[{}], [{ CLAUDE_CODE_SESSION_ID: "../escape" }]])("refuses to run without a safe session id: %o", async (env) => {
    const result = await runOverseerCli(["ticket", "list"], env, claudeHome);
    expect(result.exitCode).toBe(1);
    expect(fs.existsSync(path.join(claudeHome, "overseer"))).toBe(false);
  });

  it("starts fresh when the declarations file is corrupt", async () => {
    const ticketsFile = declaredTicketsFile(claudeHome, SESSION_ID);
    fs.mkdirSync(path.dirname(ticketsFile), { recursive: true });
    fs.writeFileSync(ticketsFile, "{not json");

    const added = await runOverseerCli(["ticket", "add", "PROJ-3"], SESSION_ENV, claudeHome, 9);
    expect(added.exitCode).toBe(0);
    expect(readDeclaredFile()).toEqual({ version: AGENT_TICKETS_SCHEMA_VERSION, entries: [{ key: "PROJ-3", addedAt: 9 }] });
  });
});

describe("overseer status", () => {
  const options = [
    { id: "in-progress", name: "In Progress", asksReason: false, done: false },
    { id: "blocked", name: "Blocked", asksReason: true, done: false },
  ];

  it("lists options, current status, and ticket statuses", async () => {
    await saveVersionedCache(statusOptionsFile(claudeHome), options, STATUS_SYNC_SCHEMA_VERSION);
    await saveVersionedCache(
      statusContextFile(claudeHome, SESSION_ID),
      { currentStatusId: "in-progress", tickets: [{ key: "AB-1", status: "Peer Review" }] },
      STATUS_SYNC_SCHEMA_VERSION,
    );
    const listed = await runOverseerCli(["status", "list"], SESSION_ENV, claudeHome);
    expect(listed.exitCode).toBe(0);
    expect(listed.output).toContain("Session status: in-progress (In Progress)");
    expect(listed.output).toContain("AB-1  Peer Review");
  });

  it("writes a request for a status by name, with a reason", async () => {
    await saveVersionedCache(statusOptionsFile(claudeHome), options, STATUS_SYNC_SCHEMA_VERSION);
    const result = await runOverseerCli(["status", "set", "Blocked", "--reason", "waiting", "on", "QA"], SESSION_ENV, claudeHome);
    expect(result).toEqual({ exitCode: 0, output: "Set the session status to Blocked." });
    expect(JSON.parse(fs.readFileSync(statusRequestFile(claudeHome, SESSION_ID), "utf8"))).toEqual({
      version: STATUS_SYNC_SCHEMA_VERSION,
      entries: { statusId: "blocked", reason: "waiting on QA" },
    });
  });

  it("refuses a status that is not an option", async () => {
    await saveVersionedCache(statusOptionsFile(claudeHome), options, STATUS_SYNC_SCHEMA_VERSION);
    const result = await runOverseerCli(["status", "set", "done"], SESSION_ENV, claudeHome);
    expect(result.exitCode).toBe(1);
    expect(fs.existsSync(statusRequestFile(claudeHome, SESSION_ID))).toBe(false);
  });

  it("rejects an unknown action and a bad option", async () => {
    expect((await runOverseerCli(["status", "nope"], SESSION_ENV, claudeHome)).exitCode).toBe(2);
    expect((await runOverseerCli(["status", "set", "blocked", "--why", "x"], SESSION_ENV, claudeHome)).exitCode).toBe(2);
  });
});

describe("overseer where", () => {
  function readWhereFile(): unknown {
    return JSON.parse(fs.readFileSync(whereFile(claudeHome, SESSION_ID), "utf8"));
  }

  it("sets, replaces, and shows the tracker lines", async () => {
    await runOverseerCli(["where", "set", "old line"], SESSION_ENV, claudeHome, 100);
    const replaced = await runOverseerCli(["where", "set", "writing tests", "then\nPR", "a", "b"], SESSION_ENV, claudeHome, 200);
    expect(replaced).toEqual({ exitCode: 0, output: "Where this session is:\n  writing tests\n  then PR\n  a" });
    expect(readWhereFile()).toEqual({
      version: AGENT_TRACKER_SCHEMA_VERSION,
      entries: { lines: ["writing tests", "then PR", "a"], updatedAt: 200 },
    });
    expect((await runOverseerCli(["where", "show"], SESSION_ENV, claudeHome)).output).toBe(replaced.output);
  });

  it("shows when nothing is set", async () => {
    expect(await runOverseerCli(["where", "show"], SESSION_ENV, claudeHome)).toEqual({
      exitCode: 0,
      output: "No tracker lines set for this session.",
    });
  });

  it.each([
    [["where", "set"], "Missing tracker line."],
    [["where", "set", "  "], "Missing tracker line."],
    [["where", "clear"], "Unknown where action: clear"],
    [["where", "show", "x"], "Unknown where action: show x"],
    [["where"], "Unknown command: where"],
  ])("rejects %o with usage", async (args, message) => {
    expect(await runOverseerCli(args, SESSION_ENV, claudeHome)).toEqual({ exitCode: 2, output: `${message}\n\n${OVERSEER_USAGE}` });
    expect(fs.existsSync(whereFile(claudeHome, SESSION_ID))).toBe(false);
  });
});

describe("overseer done", () => {
  const options = [
    { id: "in-progress", name: "In Progress", asksReason: false, done: false },
    { id: "finished", name: "Finished", asksReason: false, done: true },
  ];

  it("marks the tracker done and requests the done status", async () => {
    await saveVersionedCache(statusOptionsFile(claudeHome), options, STATUS_SYNC_SCHEMA_VERSION);
    await runOverseerCli(["where", "set", "shipping"], SESSION_ENV, claudeHome, 100);
    const result = await runOverseerCli(["done", "--reason", "merged", "and", "deployed"], SESSION_ENV, claudeHome, 300);
    expect(result).toEqual({ exitCode: 0, output: "Marked the work done and set the session status to Finished." });
    expect(JSON.parse(fs.readFileSync(whereFile(claudeHome, SESSION_ID), "utf8")).entries).toEqual({
      lines: ["shipping"],
      updatedAt: 300,
      doneAt: 300,
    });
    expect(JSON.parse(fs.readFileSync(statusRequestFile(claudeHome, SESSION_ID), "utf8"))).toEqual({
      version: STATUS_SYNC_SCHEMA_VERSION,
      entries: { statusId: "finished", reason: "merged and deployed" },
    });
  });

  it("creates the tracker file when it is missing", async () => {
    await saveVersionedCache(statusOptionsFile(claudeHome), options, STATUS_SYNC_SCHEMA_VERSION);
    expect((await runOverseerCli(["done"], SESSION_ENV, claudeHome, 50)).exitCode).toBe(0);
    expect(JSON.parse(fs.readFileSync(whereFile(claudeHome, SESSION_ID), "utf8")).entries).toEqual({ lines: [], updatedAt: 50, doneAt: 50 });
    expect(JSON.parse(fs.readFileSync(statusRequestFile(claudeHome, SESSION_ID), "utf8")).entries).toEqual({ statusId: "finished" });
  });

  it("fails without writing when no status is marked done, including older option files", async () => {
    await saveVersionedCache(statusOptionsFile(claudeHome), [{ id: "in-progress", name: "In Progress" }], STATUS_SYNC_SCHEMA_VERSION);
    const result = await runOverseerCli(["done"], SESSION_ENV, claudeHome);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("No status is marked done");
    expect(fs.existsSync(whereFile(claudeHome, SESSION_ID))).toBe(false);
    expect(fs.existsSync(statusRequestFile(claudeHome, SESSION_ID))).toBe(false);
  });

  it("rejects a bad option", async () => {
    expect((await runOverseerCli(["done", "--why", "x"], SESSION_ENV, claudeHome)).exitCode).toBe(2);
  });
});
