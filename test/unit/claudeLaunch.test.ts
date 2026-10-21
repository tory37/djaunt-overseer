import { execFileSync } from "child_process";
import { describe, expect, it } from "vitest";
import { agentIntegrationEnv, quoteForShell, shellCommandWithAgentIntegration } from "../../src/claudeLaunch";

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
