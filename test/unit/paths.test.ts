import { describe, expect, it } from "vitest";
import { encodeProjectDir, isTemporaryPath } from "../../src/paths";

describe("encodeProjectDir", () => {
  it("turns slashes into dashes", () => {
    expect(encodeProjectDir("/Users/dev/src/tools/agent-tools")).toBe(
      "-Users-dev-src-tools-agent-tools",
    );
  });

  it("turns dots and other punctuation into dashes", () => {
    expect(encodeProjectDir("/Users/dev/src/web-app/.claude/worktrees/proj_2567 x")).toBe(
      "-Users-dev-src-web-app--claude-worktrees-proj-2567-x",
    );
  });
});

describe("isTemporaryPath", () => {
  it("flags macOS and Unix temp roots only", () => {
    expect(isTemporaryPath("/private/tmp/claude-502/scratchpad/aec-pr")).toBe(true);
    expect(isTemporaryPath("/tmp/web-app-ref")).toBe(true);
    expect(isTemporaryPath("/var/folders/xy/T/overseer")).toBe(true);
    expect(isTemporaryPath("/Users/dev/src/tmp-tools")).toBe(false);
  });
});
