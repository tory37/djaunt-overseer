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
import {
  currentUserArgs,
  getFieldsArgs,
  JiraIssueRow,
  MAX_ISSUES_PER_QUERY,
  parseCurrentUserName,
  parseSearchPage,
  parseSprintFieldId,
  searchArgs,
  searchError,
  SPRINT_FIELD,
} from "./jiraQueries";
import { resolveCliBinary } from "./liveSessions";
import { claudeJsonPath, McpServerConfig, McpStdioClient, readClaudeJson, readMcpServerConfig } from "./mcpClient";

const JIRA_TOOL_NAME = "jira_issues";
const JIRA_METADATA_TOOL_NAME = "jira_metadata";
const DEFAULT_SERVER_NAME = "jira";
export const MAX_TICKETS_PER_CALL = 50;

// Talks to the same Jira MCP server Claude Code uses, so Overseer needs no Jira login of its own.
export class JiraService implements vscode.Disposable {
  private readonly client: McpStdioClient;
  private sprintFieldId: string | undefined;
  private currentUserNameLookup: Promise<string | undefined> | undefined;

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

  async search(jql: string, fields: string[]): Promise<{ issues: JiraIssueRow[]; hasMore: boolean }> {
    const fieldIds = fields.includes(SPRINT_FIELD) ? await this.sprintFieldIds() : {};
    const issues: JiraIssueRow[] = [];
    let pageToken: string | undefined;
    do {
      const envelopeText = await this.client.callTool(JIRA_TOOL_NAME, searchArgs(jql, fields, pageToken, fieldIds));
      const failure = searchError(envelopeText);
      if (failure !== undefined) {
        throw new Error(failure);
      }
      const page = parseSearchPage(envelopeText);
      issues.push(...page.issues);
      pageToken = page.nextPageToken;
    } while (pageToken !== undefined && issues.length < MAX_ISSUES_PER_QUERY);
    const hasMore = pageToken !== undefined || issues.length > MAX_ISSUES_PER_QUERY;
    return { issues: issues.slice(0, MAX_ISSUES_PER_QUERY), hasMore };
  }

  // Cached for the service's life; a failed lookup is retried on the next call.
  currentUserName(): Promise<string | undefined> {
    if (this.currentUserNameLookup === undefined) {
      const lookup = this.lookUpCurrentUserName();
      this.currentUserNameLookup = lookup;
      void lookup.then((name) => {
        if (name === undefined && this.currentUserNameLookup === lookup) {
          this.currentUserNameLookup = undefined;
        }
      });
    }
    return this.currentUserNameLookup;
  }

  dispose(): void {
    this.client.dispose();
  }

  private async lookUpCurrentUserName(): Promise<string | undefined> {
    try {
      return parseCurrentUserName(await this.client.callTool(JIRA_METADATA_TOOL_NAME, currentUserArgs()));
    } catch {
      return undefined;
    }
  }

  // An unresolved id leaves `sprint` as asked; the search still runs, its sprint just comes back empty.
  private async sprintFieldIds(): Promise<Record<string, string>> {
    if (this.sprintFieldId === undefined) {
      try {
        this.sprintFieldId = parseSprintFieldId(await this.client.callTool(JIRA_METADATA_TOOL_NAME, getFieldsArgs(SPRINT_FIELD)));
      } catch {
        this.sprintFieldId = undefined;
      }
    }
    return this.sprintFieldId === undefined ? {} : { [SPRINT_FIELD]: this.sprintFieldId };
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
