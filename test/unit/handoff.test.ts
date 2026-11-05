import { describe, expect, it } from "vitest";
import {
  approvedHandoffFile,
  draftSourceSessionId,
  handoffDraftFile,
  handoffSeedPrompt,
  reviseHandoffPrompt,
  sessionOrderWithBelow,
  writeHandoffPrompt,
} from "../../src/handoff";

const CLAUDE_HOME = "/home/me/.claude";
const DRAFT_PATH = "/home/me/.claude/overseer/handoffs/drafts/old-sid.md";

describe("handoff paths", () => {
  it("names the draft after the source session and the approved file after the new session", () => {
    expect(handoffDraftFile(CLAUDE_HOME, "old-sid")).toBe(DRAFT_PATH);
    expect(approvedHandoffFile(CLAUDE_HOME, "new-sid")).toBe("/home/me/.claude/overseer/handoffs/new-sid.md");
  });

  it("reads the source session back from a draft path", () => {
    expect(draftSourceSessionId(CLAUDE_HOME, DRAFT_PATH)).toBe("old-sid");
  });

  it("refuses files outside the drafts folder or with unsafe names", () => {
    expect(draftSourceSessionId(CLAUDE_HOME, "/home/me/.claude/overseer/handoffs/new-sid.md")).toBeUndefined();
    expect(draftSourceSessionId(CLAUDE_HOME, "/home/me/.claude/overseer/handoffs/drafts/a b.md")).toBeUndefined();
    expect(draftSourceSessionId(CLAUDE_HOME, "/home/me/.claude/overseer/handoffs/drafts/old-sid.txt")).toBeUndefined();
  });
});

describe("handoff prompts", () => {
  it("puts the draft path in the write prompt and adds nothing for empty rules", () => {
    const prompt = writeHandoffPrompt(DRAFT_PATH, "  ");
    expect(prompt).toContain(DRAFT_PATH);
    expect(prompt).not.toContain("Extra rules");
  });

  it("appends extra rules on one line", () => {
    const prompt = writeHandoffPrompt(DRAFT_PATH, "keep it short\nlist the PRs");
    expect(prompt).toContain("Extra rules: keep it short list the PRs");
  });

  it("puts feedback and the path in the revise prompt on one line", () => {
    const prompt = reviseHandoffPrompt(DRAFT_PATH, "add the test plan\r\nand drop step 3");
    expect(prompt).toContain("add the test plan and drop step 3");
    expect(prompt).toContain(DRAFT_PATH);
  });

  it("points the seed prompt at the approved file", () => {
    const approvedPath = approvedHandoffFile(CLAUDE_HOME, "new-sid");
    expect(handoffSeedPrompt(approvedPath)).toBe(`Read the handoff at ${approvedPath} and continue the work it describes.`);
  });

  it("never returns a newline", () => {
    const prompts = [
      writeHandoffPrompt(DRAFT_PATH, "a\nb\n"),
      writeHandoffPrompt(DRAFT_PATH, ""),
      reviseHandoffPrompt(DRAFT_PATH, "\nfix\n"),
      handoffSeedPrompt(approvedHandoffFile(CLAUDE_HOME, "new-sid")),
    ];
    for (const prompt of prompts) {
      expect(prompt).not.toMatch(/[\r\n]/);
    }
  });
});

describe("sessionOrderWithBelow", () => {
  it("places the new session right below the source in its group", () => {
    expect(sessionOrderWithBelow(["x", "a", "b"], ["a", "b", "c"], "a", "new")).toEqual(["x", "a", "new", "b", "c"]);
  });

  it("places it last when the source is last", () => {
    expect(sessionOrderWithBelow([], ["a", "b"], "b", "new")).toEqual(["a", "b", "new"]);
  });

  it("keeps the order when the source is not in the group", () => {
    expect(sessionOrderWithBelow(["a"], ["b"], "missing", "new")).toEqual(["a"]);
  });
});
