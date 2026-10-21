import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { AGENT_TICKETS_SCHEMA_VERSION, declaredTicketsFile, userTicketMarksFile } from "../../src/agentTickets";
import { OVERSEER_USAGE, runOverseerCli } from "../../src/overseerCli";

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
    [["pr", "add"], "Unknown command: pr add"],
  ])("rejects %o with usage", async (args, message) => {
    const result = await runOverseerCli(args, SESSION_ENV, claudeHome);
    expect(result.exitCode).toBe(2);
    expect(result.output.startsWith(`${message}\n\n`)).toBe(true);
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
