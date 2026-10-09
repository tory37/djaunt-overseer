import { describe, expect, it } from "vitest";
import { encodeProjectDir } from "../../src/paths";

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
