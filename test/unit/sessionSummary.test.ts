import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import {
  buildSummaryDigest,
  parseSummaryOutput,
  pickHoverSummary,
  readTranscriptTail,
  SummaryCacheEntry,
} from "../../src/sessionSummary";

const CONTEXT = { title: "Fix login", gitBranch: "fix/login", cwd: "/src/web-app", firstPrompt: "fix the login bug" };

function line(record: unknown): string {
  return JSON.stringify(record);
}

describe("buildSummaryDigest", () => {
  it("keeps prompts, Claude's text, and tool descriptions, and drops injected records", () => {
    const digest = buildSummaryDigest(CONTEXT, [
      line({ type: "user", message: { content: "fix the login bug" } }),
      line({ type: "user", isMeta: true, message: { content: "skill body PROJ-1615" } }),
      line({ type: "user", isCompactSummary: true, message: { content: "earlier summary PROJ-2529" } }),
      line({ type: "user", isSidechain: true, message: { content: "subagent prompt" } }),
      line({ type: "user", message: { content: "<local-command-stdout>Compacted</local-command-stdout>" } }),
      line({ type: "user", message: { content: [{ type: "tool_result", content: "huge output" }] } }),
      line({
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "private" },
            { type: "text", text: "The token check is wrong." },
            { type: "tool_use", name: "Bash", input: { description: "Run the auth tests", command: "npm test" } },
          ],
        },
      }),
      "not json",
    ]);

    expect(digest).toContain("Session title: Fix login");
    expect(digest).toContain("User: fix the login bug");
    expect(digest).toContain("Claude: The token check is wrong.");
    expect(digest).toContain("Tool: Bash: Run the auth tests");
    expect(digest).not.toMatch(/PROJ-1615|PROJ-2529|subagent|Compacted|huge output|private/);
  });

  it("keeps the newest turns when the transcript runs past the cap", () => {
    const transcriptLines = Array.from({ length: 200 }, (_, turnNumber) =>
      line({ type: "user", message: { content: `prompt ${turnNumber} ${"x".repeat(200)}` } }),
    );

    const digest = buildSummaryDigest(CONTEXT, transcriptLines);

    expect(Buffer.byteLength(digest, "utf8")).toBeLessThanOrEqual(12 * 1024);
    expect(digest).toContain("prompt 199 ");
    expect(digest).not.toContain("prompt 0 ");
    expect(digest.indexOf("prompt 198 ")).toBeLessThan(digest.indexOf("prompt 199 "));
  });
});

describe("readTranscriptTail", () => {
  it("drops the partial first line of a tail that starts mid-file", async () => {
    const transcriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "overseer-summary-"));
    const transcriptFile = path.join(transcriptDir, "session.jsonl");
    fs.writeFileSync(transcriptFile, "first line\nsecond line\nthird line\n");

    try {
      expect(await readTranscriptTail(transcriptFile)).toEqual(["first line", "second line", "third line", ""]);
      expect(await readTranscriptTail(transcriptFile, 15)).toEqual(["third line", ""]);
    } finally {
      fs.rmSync(transcriptDir, { recursive: true, force: true });
    }
  });
});

describe("parseSummaryOutput", () => {
  it("returns the result text on one line", () => {
    expect(parseSummaryOutput(JSON.stringify({ is_error: false, result: "Login fix done.\nNext: tests." }))).toBe(
      "Login fix done. Next: tests.",
    );
  });

  it("throws on an error envelope or an empty result", () => {
    expect(() => parseSummaryOutput(JSON.stringify({ is_error: true, result: "rate limited" }))).toThrow(/rate limited/);
    expect(() => parseSummaryOutput(JSON.stringify({ result: "  " }))).toThrow(/no text/);
  });
});

describe("pickHoverSummary", () => {
  const haikuSummary: SummaryCacheEntry = {
    text: "Haiku text",
    model: "haiku",
    summarizedAtMs: 2_000,
    transcriptSizeBytes: 500,
  };
  const recap = { text: "Recap text", writtenAtMs: 1_000, isStale: false };

  it("returns nothing when neither exists", () => {
    expect(pickHoverSummary(undefined, undefined, 500)).toBeUndefined();
  });

  it("picks whichever was written last", () => {
    expect(pickHoverSummary(recap, haikuSummary, 500)?.source).toBe("haiku");
    expect(pickHoverSummary({ ...recap, writtenAtMs: 3_000 }, haikuSummary, 500)?.source).toBe("recap");
  });

  it("marks the Haiku summary stale once the transcript grows", () => {
    expect(pickHoverSummary(undefined, haikuSummary, 500)?.isStale).toBe(false);
    expect(pickHoverSummary(undefined, haikuSummary, 501)?.isStale).toBe(true);
  });

  it("keeps the recap's own staleness", () => {
    expect(pickHoverSummary({ ...recap, isStale: true }, undefined, 500)).toEqual({
      source: "recap",
      text: "Recap text",
      writtenAtMs: 1_000,
      isStale: true,
    });
  });
});
