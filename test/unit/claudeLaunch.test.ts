import { describe, expect, it } from "vitest";
import { launchShellCommand, newSessionCommand, quoteForShell } from "../../src/claudeLaunch";

describe("launchShellCommand", () => {
  it("execs claude with no Overseer flags", () => {
    expect(launchShellCommand("claude --resume abc")).toBe("exec claude --resume abc");
  });
});

describe("quoteForShell", () => {
  it("strips newlines and escapes single quotes", () => {
    expect(quoteForShell("it's\nfine")).toBe(`'it'\\''s fine'`);
  });
});

describe("newSessionCommand", () => {
  it("starts a session with only its id", () => {
    expect(newSessionCommand("sid", undefined, undefined)).toBe("claude --session-id sid");
  });

  it("quotes the name and the initial prompt", () => {
    expect(newSessionCommand("sid", "it's mine", "Read /a b.md\nnow")).toBe(
      `claude --session-id sid -n 'it'\\''s mine' 'Read /a b.md now'`,
    );
  });
});
