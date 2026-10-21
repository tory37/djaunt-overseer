import { describe, expect, it } from "vitest";
import { buildPopulateDigest, parsePopulateOutput } from "../../src/populateDigest";

const CONTEXT = { title: "Fix loop", gitBranch: "fix/loop", cwd: "/repo", removedTicketKeys: ["PROJ-9"] };

function userLine(content: unknown): string {
  return JSON.stringify({ type: "user", message: { content } });
}

function assistantLine(content: unknown[]): string {
  return JSON.stringify({ type: "assistant", message: { content } });
}

function bashCall(id: string, command: string): string {
  return assistantLine([{ type: "tool_use", id, name: "Bash", input: { command } }]);
}

function bashResult(id: string, text: string): string {
  return userLine([{ type: "tool_result", tool_use_id: id, content: text }]);
}

describe("buildPopulateDigest", () => {
  it("keeps commit commands and their results, and drops other tool calls", () => {
    const digest = buildPopulateDigest(CONTEXT, [
      userLine("fix PROJ-1 please"),
      bashCall("t1", "git log --oneline"),
      bashResult("t1", "abc1234 someone else's commit"),
      bashCall("t2", 'git commit -m "Fix the loop"'),
      bashResult("t2", "[fix/loop def5678] Fix the loop"),
      assistantLine([{ type: "text", text: "Committed." }]),
    ]);
    expect(digest).toContain("Removed by the user: PROJ-9");
    expect(digest).toContain(
      ['User: fix PROJ-1 please', 'Ran: git commit -m "Fix the loop"', "Result: [fix/loop def5678] Fix the loop", "Claude: Committed."].join("\n"),
    );
    expect(digest).not.toContain("someone else");
  });

  it("keeps evidence when the conversation overflows the budget", () => {
    const chatter = Array.from({ length: 50 }, (_, index) => userLine(`message ${index} ${"x".repeat(200)}`));
    const digest = buildPopulateDigest(CONTEXT, [bashCall("t1", "gh pr create --fill"), bashResult("t1", "https://github.com/o/r/pull/7"), ...chatter], 2_000);
    expect(digest).toContain("Result: https://github.com/o/r/pull/7");
    expect(digest).toContain("message 49");
    expect(digest).not.toContain("message 0 ");
  });

  it("skips lines that don't parse", () => {
    expect(() => buildPopulateDigest(CONTEXT, ['{"type":"user", broken', ""])).not.toThrow();
  });
});

describe("parsePopulateOutput", () => {
  it("reads and normalizes the JSON reply", () => {
    const reply = 'Here you go:\n{"tickets":[{"key":"proj-1","note":"fix"},{"key":"UTF-8"}],"commits":[{"hash":"DEF5678"}],"pullRequests":[{"url":"https://github.com/o/r/pull/7/files"}]}';
    expect(parsePopulateOutput(JSON.stringify({ result: reply }))).toEqual({
      tickets: [{ id: "PROJ-1", note: "fix" }],
      commits: [{ id: "def5678" }],
      pullRequests: [{ id: "https://github.com/o/r/pull/7" }],
    });
  });

  it("throws on a failed run or a reply with no JSON", () => {
    expect(() => parsePopulateOutput(JSON.stringify({ is_error: true, result: "boom" }))).toThrow("boom");
    expect(() => parsePopulateOutput(JSON.stringify({ result: "nothing here" }))).toThrow("no JSON");
  });
});
