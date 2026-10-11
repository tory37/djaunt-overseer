import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface McpServerConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: { message?: string };
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const MCP_PROTOCOL_VERSION = "2025-06-18";
const REQUEST_TIMEOUT_MS = 60_000;

// Reads a stdio server from the user scope of ~/.claude.json, the same entry Claude Code starts.
export function readMcpServerConfig(claudeJsonText: string, serverName: string): McpServerConfig | undefined {
  let claudeJson: unknown;
  try {
    claudeJson = JSON.parse(claudeJsonText);
  } catch {
    return undefined;
  }
  const servers = isRecord(claudeJson) ? claudeJson.mcpServers : undefined;
  const server = isRecord(servers) ? servers[serverName] : undefined;
  if (!isRecord(server) || typeof server.command !== "string") {
    return undefined;
  }
  const isStdio = server.type === undefined || server.type === "stdio";
  if (!isStdio) {
    return undefined;
  }
  const args = Array.isArray(server.args) ? server.args.filter((arg): arg is string => typeof arg === "string") : [];
  const env = isRecord(server.env)
    ? Object.fromEntries(Object.entries(server.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : {};
  return { command: server.command, args, env };
}

export function claudeJsonPath(): string {
  return path.join(os.homedir(), ".claude.json");
}

// Splits newline-delimited JSON-RPC from stdout chunks, keeping a partial last line for the next chunk.
export class JsonLineReader {
  private bufferedText = "";

  push(chunk: string): unknown[] {
    this.bufferedText += chunk;
    const lines = this.bufferedText.split("\n");
    this.bufferedText = lines.pop() ?? "";
    return lines.flatMap((line) => {
      if (line.trim() === "") {
        return [];
      }
      try {
        return [JSON.parse(line) as unknown];
      } catch {
        return [];
      }
    });
  }
}

// Returns the text of an MCP tools/call result, or throws when the tool reports an error.
export function toolResultText(toolResult: unknown): string {
  if (!isRecord(toolResult) || !Array.isArray(toolResult.content)) {
    throw new Error("MCP tool returned no content");
  }
  const text = toolResult.content
    .filter((block): block is { type: string; text: string } => isRecord(block) && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
  if (toolResult.isError === true) {
    throw new Error(text || "MCP tool failed");
  }
  return text;
}

// A minimal MCP client over stdio: one server process, started on first use, restarted after it exits.
export class McpStdioClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private ready: Promise<void> | undefined;
  private nextRequestId = 0;
  private readonly pendingRequests = new Map<number, PendingRequest>();

  constructor(
    private readonly resolveConfig: () => Promise<McpServerConfig>,
    private readonly logLine: (line: string) => void,
  ) {}

  async callTool(toolName: string, toolArguments: Record<string, unknown>): Promise<string> {
    await this.start();
    return toolResultText(await this.request("tools/call", { name: toolName, arguments: toolArguments }));
  }

  dispose(): void {
    this.child?.kill();
    this.child = undefined;
    this.ready = undefined;
  }

  private start(): Promise<void> {
    this.ready ??= this.launch().catch((error: unknown) => {
      this.dispose();
      throw error;
    });
    return this.ready;
  }

  private async launch(): Promise<void> {
    const config = await this.resolveConfig();
    const child = spawn(config.command, config.args, { env: { ...process.env, ...config.env } });
    this.child = child;
    const lineReader = new JsonLineReader();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => lineReader.push(chunk).forEach((message) => this.receive(message)));
    child.stderr.on("data", () => undefined);
    child.on("error", (error) => this.failAll(error));
    child.on("exit", (exitCode) => {
      if (this.child === child) {
        this.child = undefined;
        this.ready = undefined;
      }
      this.failAll(new Error(`MCP server exited with code ${exitCode}`));
    });
    await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "djaunt-overseer", version: "1" },
    });
    this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    this.logLine(`Started MCP server: ${config.command} ${config.args.join(" ")}`);
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const requestId = ++this.nextRequestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`MCP ${method} timed out`));
      }, REQUEST_TIMEOUT_MS);
      this.pendingRequests.set(requestId, { resolve, reject, timer });
      this.send({ jsonrpc: "2.0", id: requestId, method, params });
    });
  }

  private send(message: unknown): void {
    this.child?.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private receive(message: unknown): void {
    const response = message as JsonRpcResponse;
    if (typeof response.id !== "number") {
      return;
    }
    const pendingRequest = this.pendingRequests.get(response.id);
    if (pendingRequest === undefined) {
      return;
    }
    this.pendingRequests.delete(response.id);
    clearTimeout(pendingRequest.timer);
    if (response.error !== undefined) {
      pendingRequest.reject(new Error(response.error.message ?? "MCP request failed"));
    } else {
      pendingRequest.resolve(response.result);
    }
  }

  private failAll(error: Error): void {
    for (const pendingRequest of this.pendingRequests.values()) {
      clearTimeout(pendingRequest.timer);
      pendingRequest.reject(error);
    }
    this.pendingRequests.clear();
  }
}

export async function readClaudeJson(): Promise<string> {
  return fs.promises.readFile(claudeJsonPath(), "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
