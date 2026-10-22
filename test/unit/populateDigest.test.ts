import { describe, expect, it } from "vitest";
import { buildPopulateDigest, parsePopulateOutput, populateFailureReason, RECHECK_DIGEST_BYTES } from "../../src/populateDigest";

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

  it("keeps overseer commands and their failures as evidence", () => {
    const digest = buildPopulateDigest(CONTEXT, [
      bashCall("t1", "overseer ticket add PROJ-2 --note 'scaling'"),
      bashResult("t1", "zsh: command not found: overseer"),
    ]);
    expect(digest).toContain("Ran: overseer ticket add PROJ-2 --note 'scaling'\nResult: zsh: command not found: overseer");
  });

  it("keeps Artifact calls, and artifact URLs a long result would clip", () => {
    const publishResult = `${"Published. ".repeat(60)}https://claude.ai/artifact/abc-123`;
    const digest = buildPopulateDigest(CONTEXT, [
      assistantLine([{ type: "tool_use", id: "a1", name: "Artifact", input: { file_path: "/tmp/report.html" } }]),
      bashResult("a1", publishResult),
      assistantLine([{ type: "tool_use", id: "r1", name: "Read", input: { file_path: "/x" } }]),
      bashResult("r1", "see https://claude.ai/code/artifact/def-456 for details"),
    ]);
    expect(digest).toContain('Ran: Artifact {"file_path":"/tmp/report.html"}');
    expect(digest).toContain("(artifacts: https://claude.ai/artifact/abc-123)");
    expect(digest).toContain("Tool result names artifacts: https://claude.ai/code/artifact/def-456");
  });

  it("fits more of the conversation under the recheck cap", () => {
    const chatter = Array.from({ length: 400 }, (_, index) => userLine(`message ${index} ${"x".repeat(300)}`));
    expect(buildPopulateDigest(CONTEXT, chatter)).not.toContain("message 200 ");
    const recheckDigest = buildPopulateDigest(CONTEXT, chatter, RECHECK_DIGEST_BYTES);
    expect(recheckDigest).toContain("message 200 ");
    expect(Buffer.byteLength(recheckDigest, "utf8")).toBeLessThanOrEqual(RECHECK_DIGEST_BYTES);
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
      artifacts: [],
    });
  });

  it("reads parents and artifacts, and drops bad ones", () => {
    const reply = JSON.stringify({
      tickets: [
        { key: "PROJ-2", note: "scaling", parent: "proj-1" },
        { key: "PROJ-3", parent: "the epic" },
        { key: "PROJ-4", parent: "PROJ-4" },
      ],
      pullRequests: [{ url: "https://github.com/o/r/pull/7", parent: "https://github.com/o/r/pull/8" }],
      artifacts: [
        { url: "https://claude.ai/artifact/abc-1?x=1", note: "report", parent: "https://github.com/o/r/pull/7/files" },
        { url: "https://claude.ai/code/artifact/def-2", note: "", parent: "PROJ-2" },
        { url: "https://example.com/artifact/x" },
        "garbage",
        null,
      ],
      commits: "not a list",
    });
    expect(parsePopulateOutput(JSON.stringify({ result: reply }))).toEqual({
      tickets: [{ id: "PROJ-2", note: "scaling", parentKey: "PROJ-1" }, { id: "PROJ-3" }, { id: "PROJ-4" }],
      commits: [],
      pullRequests: [{ id: "https://github.com/o/r/pull/7" }],
      artifacts: [
        { id: "https://claude.ai/artifact/abc-1", note: "report", parentKey: "https://github.com/o/r/pull/7" },
        { id: "https://claude.ai/code/artifact/def-2", parentKey: "PROJ-2" },
      ],
    });
  });

  it("throws on a failed run or a reply with no JSON", () => {
    expect(() => parsePopulateOutput(JSON.stringify({ is_error: true, result: "boom" }))).toThrow("boom");
    expect(() => parsePopulateOutput(JSON.stringify({ result: "nothing here" }))).toThrow("no JSON");
  });
});

describe("populateFailureReason", () => {
  it("turns run errors into one short sentence", () => {
    expect(populateFailureReason(new Error("spawn claude ENOENT"))).toBe("Couldn't find the claude CLI.");
    expect(populateFailureReason(new Error("headless claude run failed: timed out after 120s"))).toBe("Haiku timed out.");
    expect(populateFailureReason(new Error("populate run returned no JSON"))).toBe("Haiku's reply had no usable list.");
    expect(populateFailureReason("boom")).toBe("Haiku run failed. See the Overseer output.");
  });
});
