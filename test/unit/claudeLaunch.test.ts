import { execFileSync } from "child_process";
import { describe, expect, it } from "vitest";
import {
  agentIntegrationEnv,
  compareVersions,
  quoteForShell,
  shellCommandWithAgentIntegration,
  shouldRepointStableLink,
  stableExtensionLink,
} from "../../src/claudeLaunch";

const INTEGRATION = { extensionDir: "/ext/it's here", nodePath: "/vscode/node", claudeHome: "/home/me/.claude" };

describe("shellCommandWithAgentIntegration", () => {
  it("execs claude unchanged without an integration", () => {
    expect(shellCommandWithAgentIntegration("claude --resume abc", undefined)).toBe("exec claude --resume abc");
  });

  it("puts the overseer CLI on PATH and loads the plugin with the CLI allowed", () => {
    expect(shellCommandWithAgentIntegration("claude --resume abc", INTEGRATION)).toBe(
      `export PATH='/ext/it'\\''s here/bin':"$PATH"; exec claude --resume abc ` +
        `--plugin-dir '/ext/it'\\''s here/plugin' --allowedTools 'Bash(overseer *)'`,
    );
  });

  it("produces a command the shell parses back to the right arguments", () => {
    const shellCommand = shellCommandWithAgentIntegration("printf '%s\\n'", INTEGRATION).replace("exec ", "");
    const printedLines = execFileSync("/bin/sh", ["-c", `${shellCommand}; printf '%s\\n' "$PATH"`], { encoding: "utf8" }).split("\n");
    expect(printedLines.slice(0, 4)).toEqual(["--plugin-dir", "/ext/it's here/plugin", "--allowedTools", "Bash(overseer *)"]);
    expect(printedLines[4].startsWith("/ext/it's here/bin:")).toBe(true);
  });
});

describe("stableExtensionLink", () => {
  it("lives under the Claude home, outside any versioned extension folder", () => {
    expect(stableExtensionLink("/home/me/.claude")).toBe("/home/me/.claude/overseer/current");
  });

  it("launches through the link when the integration uses it", () => {
    const integration = { ...INTEGRATION, extensionDir: stableExtensionLink("/home/me/.claude") };
    expect(shellCommandWithAgentIntegration("claude", integration)).toBe(
      `export PATH='/home/me/.claude/overseer/current/bin':"$PATH"; exec claude ` +
        `--plugin-dir '/home/me/.claude/overseer/current/plugin' --allowedTools 'Bash(overseer *)'`,
    );
  });
});

describe("compareVersions", () => {
  it("compares each number, not the text", () => {
    expect(compareVersions("0.0.10", "0.0.9")).toBe(1);
    expect(compareVersions("0.0.9", "0.0.10")).toBe(-1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("treats missing parts as zero and ignores a prerelease suffix", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.3-beta.1", "1.2.3")).toBe(0);
  });
});

describe("shouldRepointStableLink", () => {
  const OURS = "/ext/overseer-0.0.17";

  it("points a missing or broken link at this extension", () => {
    expect(shouldRepointStableLink(undefined, OURS, "0.0.17")).toBe(true);
    expect(shouldRepointStableLink({ targetDir: "/ext/overseer-0.0.12", version: undefined }, OURS, "0.0.17")).toBe(true);
  });

  it("leaves a link that already points here", () => {
    expect(shouldRepointStableLink({ targetDir: OURS, version: "0.0.17" }, OURS, "0.0.17")).toBe(false);
    expect(shouldRepointStableLink({ targetDir: `${OURS}/`, version: "0.0.17" }, OURS, "0.0.17")).toBe(false);
  });

  it("moves an older or same-version link forward to this folder", () => {
    expect(shouldRepointStableLink({ targetDir: "/ext/overseer-0.0.12", version: "0.0.12" }, OURS, "0.0.17")).toBe(true);
    expect(shouldRepointStableLink({ targetDir: "/src/overseer", version: "0.0.17" }, OURS, "0.0.17")).toBe(true);
  });

  it("never moves a link back from a newer extension", () => {
    expect(shouldRepointStableLink({ targetDir: "/ext/overseer-0.0.18", version: "0.0.18" }, OURS, "0.0.17")).toBe(false);
  });
});

describe("agentIntegrationEnv", () => {
  it("passes VS Code's runtime and the Claude home to the CLI", () => {
    expect(agentIntegrationEnv(INTEGRATION)).toEqual({ OVERSEER_NODE: "/vscode/node", OVERSEER_CLAUDE_HOME: "/home/me/.claude" });
    expect(agentIntegrationEnv(undefined)).toEqual({});
  });
});

describe("quoteForShell", () => {
  it("strips newlines and escapes single quotes", () => {
    expect(quoteForShell("it's\nfine")).toBe(`'it'\\''s fine'`);
  });
});
