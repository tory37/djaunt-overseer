import { describe, expect, it } from "vitest";
import { launchShellCommand, quoteForShell } from "../../src/claudeLaunch";

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
