import { describe, expect, it } from "vitest";
import { JsonLineReader, readMcpServerConfig, toolResultText } from "../../src/mcpClient";

describe("readMcpServerConfig", () => {
  const claudeJson = JSON.stringify({
    mcpServers: {
      jira: { type: "stdio", command: "uvx", args: ["mcp-jira", 4], env: { JIRA_URL: "https://x", BAD: 1 } },
      remote: { type: "http", url: "https://example.invalid" },
    },
  });

  it("reads a stdio server's command, args, and string env", () => {
    expect(readMcpServerConfig(claudeJson, "jira")).toEqual({
      command: "uvx",
      args: ["mcp-jira"],
      env: { JIRA_URL: "https://x" },
    });
  });

  it("returns undefined for a missing, remote, or unparsable entry", () => {
    expect(readMcpServerConfig(claudeJson, "nope")).toBeUndefined();
    expect(readMcpServerConfig(claudeJson, "remote")).toBeUndefined();
    expect(readMcpServerConfig("{", "jira")).toBeUndefined();
  });
});

describe("JsonLineReader", () => {
  it("holds a partial line until the rest arrives", () => {
    const reader = new JsonLineReader();
    expect(reader.push('{"id":1}\n{"id"')).toEqual([{ id: 1 }]);
    expect(reader.push(':2}\n\nnot json\n')).toEqual([{ id: 2 }]);
  });
});

describe("toolResultText", () => {
  it("joins text blocks and throws on a tool error", () => {
    expect(toolResultText({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] })).toBe("ab");
    expect(() => toolResultText({ content: [{ type: "text", text: "denied" }], isError: true })).toThrow("denied");
    expect(() => toolResultText({})).toThrow();
  });
});
