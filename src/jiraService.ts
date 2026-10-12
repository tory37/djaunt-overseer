import * as path from "path";
import * as vscode from "vscode";
import {
  IssueFacts,
  issueStatusesArgs,
  JiraWorkflow,
  parseIssueStatuses,
  parseWorkflow,
  transitionArgs,
  transitionError,
  workflowArgs,
} from "./jira";
import { resolveCliBinary } from "./liveSessions";
import { claudeJsonPath, McpServerConfig, McpStdioClient, readClaudeJson, readMcpServerConfig } from "./mcpClient";

const JIRA_TOOL_NAME = "jira_issues";
const DEFAULT_SERVER_NAME = "jira";
export const MAX_TICKETS_PER_CALL = 50;

// Talks to the same Jira MCP server Claude Code uses, so Overseer needs no Jira login of its own.
export class JiraService implements vscode.Disposable {
  private readonly client: McpStdioClient;

  constructor(log: vscode.OutputChannel) {
    this.client = new McpStdioClient(() => this.serverConfig(), (line) => log.appendLine(line));
  }

  async issueStatuses(ticketKeys: string[]): Promise<Map<string, IssueFacts>> {
    return parseIssueStatuses(await this.client.callTool(JIRA_TOOL_NAME, issueStatusesArgs(ticketKeys)));
  }

  async workflow(ticketKey: string): Promise<JiraWorkflow | undefined> {
    return parseWorkflow(await this.client.callTool(JIRA_TOOL_NAME, workflowArgs(ticketKey)));
  }

  async transition(ticketKey: string, transitionName: string): Promise<void> {
    const failure = transitionError(await this.client.callTool(JIRA_TOOL_NAME, transitionArgs(ticketKey, transitionName)));
    if (failure !== undefined) {
      throw new Error(failure);
    }
  }

  dispose(): void {
    this.client.dispose();
  }

  // VS Code started from the Dock lacks the login shell's PATH, so the command is resolved through that shell.
  private async serverConfig(): Promise<McpServerConfig> {
    const serverName =
      vscode.workspace.getConfiguration("overseer.jira").get<string>("mcpServer", DEFAULT_SERVER_NAME) || DEFAULT_SERVER_NAME;
    const config = readMcpServerConfig(await readClaudeJson(), serverName);
    if (config === undefined) {
      throw new Error(`No stdio MCP server named "${serverName}" in ${claudeJsonPath()}`);
    }
    const commandPath = path.isAbsolute(config.command) ? config.command : await resolveCliBinary(config.command);
    const commandDir = path.dirname(commandPath);
    const searchPath = commandDir === "." ? process.env.PATH : `${commandDir}${path.delimiter}${process.env.PATH ?? ""}`;
    return { ...config, command: commandPath, env: { PATH: searchPath ?? "", ...config.env } };
  }
}
