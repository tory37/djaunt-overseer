import * as fs from "fs";
import * as vscode from "vscode";
import { isSafeSessionId } from "./agentTickets";
import { displayTitle, SessionMeta } from "./indexer";
import { JiraService } from "./jiraService";
import { loadVersionedCache, saveVersionedCache } from "./linkCache";
import { createClaudeRunner } from "./linkJudge";
import { MarkedLink, sessionPanelLinks } from "./linkView";
import { resolveClaudeBinary } from "./liveSessions";
import { LinkStatusService } from "./linkStatusService";
import { Registry } from "./registry";
import { SessionLinkService } from "./sessionLinks";
import { autoStatusArgs, buildAutoStatusDigest, parseAutoStatusOutput } from "./sessionStatusAuto";
import {
  readStatusRequest,
  STATUS_SYNC_SCHEMA_VERSION,
  statusContextFile,
  StatusContext,
  statusOptionsFile,
  statusRequestFile,
  statusRequestsDir,
  StatusOption,
  TicketStatusFact,
} from "./sessionStatusSync";
import { configuredStatuses } from "./sessionStatusView";

// fs.watch can miss events on some file systems, so the folder is also polled.
const REQUEST_POLL_INTERVAL_MS = 15_000;
const AUTO_STATUS_MODEL = "haiku";

interface RelayDependencies {
  claudeHome: string;
  registry: Registry;
  linkService: SessionLinkService;
  linkStatusService: LinkStatusService;
  jiraService: JiraService;
  findSessionMeta: (sessionId: string) => SessionMeta | undefined;
  log: vscode.OutputChannel;
}

// Connects the overseer CLI to the session status: it applies the agent's requests, mirrors the options and each
// session's ticket statuses to files the CLI reads, and lets Haiku condense a session's tickets into one status.
export class SessionStatusRelay implements vscode.Disposable {
  private readonly writtenJson = new Map<string, string>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly watchers: fs.FSWatcher[] = [];
  private readonly pollTimer: NodeJS.Timeout;
  private isApplying = false;
  private claudeBinary: Promise<string> | undefined;

  constructor(private readonly dependencies: RelayDependencies) {
    const { registry, linkStatusService, linkService } = dependencies;
    this.subscriptions.push(
      registry.onDidChange(() => this.publish()),
      linkStatusService.onDidChange(() => this.publish()),
      linkService.onDidChange(() => this.publish()),
      vscode.workspace.onDidChangeConfiguration((change) => {
        if (change.affectsConfiguration("overseer.sessionStatuses")) {
          this.publish();
        }
      }),
    );
    this.watchRequests();
    this.publish();
    void this.applyRequests();
    this.pollTimer = setInterval(() => void this.applyRequests(), REQUEST_POLL_INTERVAL_MS);
  }

  // Asks Haiku for each session's overall status from its tickets' Jira statuses, then sets it.
  async autoSetStatus(sessionIds: string[]): Promise<void> {
    const options = this.statusOptions();
    if (options.length === 0) {
      void vscode.window.showInformationMessage("Overseer: no statuses set up yet.");
      return;
    }
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: "Setting status with Haiku" },
      async () => {
        for (const sessionId of sessionIds) {
          await this.autoSetOne(sessionId, options);
        }
      },
    );
  }

  private async autoSetOne(sessionId: string, options: StatusOption[]): Promise<void> {
    const { registry, findSessionMeta, log } = this.dependencies;
    const meta = findSessionMeta(sessionId);
    const title = registry.labels()[sessionId] ?? (meta === undefined ? sessionId : displayTitle(meta));
    try {
      const tickets = await this.freshTicketFacts(sessionId);
      if (tickets.length === 0) {
        void vscode.window.showInformationMessage(`Overseer: "${title}" has no tickets with a known status.`);
        return;
      }
      this.claudeBinary ??= resolveClaudeBinary();
      const runClaude = createClaudeRunner(await this.claudeBinary);
      const result = parseAutoStatusOutput(await runClaude(autoStatusArgs(AUTO_STATUS_MODEL), buildAutoStatusDigest({ title, options, tickets })), options);
      await registry.setSessionStatus([sessionId], result.statusId, result.reason);
    } catch (error) {
      this.claudeBinary = undefined;
      log.appendLine(`Auto status failed for "${title}": ${String(error)}`);
      void vscode.window.showWarningMessage(`Overseer couldn't set the status for "${title}". See the Overseer output.`);
    }
  }

  private statusOptions(): StatusOption[] {
    return configuredStatuses().map(({ id, name, asksReason, done }) => ({ id, name, asksReason, done }));
  }

  private workingOnTickets(sessionId: string): MarkedLink[] {
    const { linkService, registry } = this.dependencies;
    const visibleLinks = linkService.visibleLinksFor(sessionId) ?? [];
    return sessionPanelLinks(visibleLinks, registry.linkMarks(sessionId)).workingOn.filter((link) => link.kind === "ticket");
  }

  // Asks Jira now, so a click on Auto never works from a five-minute-old status.
  private async freshTicketFacts(sessionId: string): Promise<TicketStatusFact[]> {
    const ticketKeys = [...new Set(this.workingOnTickets(sessionId).map((link) => link.id))];
    if (ticketKeys.length === 0) {
      return [];
    }
    const issueFacts = await this.dependencies.jiraService.issueStatuses(ticketKeys);
    return ticketKeys.flatMap((key) => {
      const facts = issueFacts.get(key);
      return facts === undefined ? [] : [{ key, status: facts.status, ...(facts.summary === undefined ? {} : { summary: facts.summary }) }];
    });
  }

  // Cached statuses only: this runs on every change, so it never waits on Jira.
  private cachedTicketFacts(sessionId: string): TicketStatusFact[] {
    return this.workingOnTickets(sessionId).flatMap((link) => {
      const status = this.dependencies.linkStatusService.statusFor(link);
      return status === undefined ? [] : [{ key: link.id, status: status.text, ...(status.title === undefined ? {} : { summary: status.title }) }];
    });
  }

  private publish(): void {
    const { claudeHome, registry, log } = this.dependencies;
    const writes: Promise<void>[] = [this.writeIfChanged(statusOptionsFile(claudeHome), this.statusOptions())];
    const statusIdBySession = registry.sessionStatusIds();
    for (const sessionId of registry.pinnedSessionIds().filter(isSafeSessionId)) {
      const context: StatusContext = {
        ...(statusIdBySession[sessionId] === undefined ? {} : { currentStatusId: statusIdBySession[sessionId] }),
        tickets: this.cachedTicketFacts(sessionId),
      };
      writes.push(this.writeIfChanged(statusContextFile(claudeHome, sessionId), context));
    }
    Promise.all(writes).catch((error: unknown) => log.appendLine(`Can't write status files for the overseer CLI: ${String(error)}`));
  }

  private async writeIfChanged(file: string, content: unknown): Promise<void> {
    const json = JSON.stringify(content);
    if (this.writtenJson.get(file) !== json) {
      this.writtenJson.set(file, json);
      await saveVersionedCache(file, content, STATUS_SYNC_SCHEMA_VERSION);
    }
  }

  private watchRequests(): void {
    const dir = statusRequestsDir(this.dependencies.claudeHome);
    try {
      fs.mkdirSync(dir, { recursive: true });
      this.watchers.push(fs.watch(dir, () => void this.applyRequests()));
    } catch (error) {
      this.dependencies.log.appendLine(`Can't watch ${dir}: ${String(error)}`);
    }
  }

  // Each request is consumed: applied to the session, then deleted.
  private async applyRequests(): Promise<void> {
    if (this.isApplying) {
      return;
    }
    this.isApplying = true;
    const { claudeHome, registry, log } = this.dependencies;
    try {
      const fileNames = await fs.promises.readdir(statusRequestsDir(claudeHome)).catch(() => [] as string[]);
      const validStatusIds = new Set(this.statusOptions().map((option) => option.id));
      for (const fileName of fileNames.filter((name) => name.endsWith(".json"))) {
        const sessionId = fileName.slice(0, -".json".length);
        if (!isSafeSessionId(sessionId)) {
          continue;
        }
        const file = statusRequestFile(claudeHome, sessionId);
        const request = readStatusRequest(await loadVersionedCache<unknown>(file, STATUS_SYNC_SCHEMA_VERSION));
        await fs.promises.rm(file, { force: true });
        if (request !== undefined && validStatusIds.has(request.statusId)) {
          await registry.setSessionStatus([sessionId], request.statusId, request.reason);
          log.appendLine(`Agent set status "${request.statusId}" on ${sessionId}`);
        }
      }
    } finally {
      this.isApplying = false;
    }
  }

  dispose(): void {
    this.subscriptions.forEach((subscription) => subscription.dispose());
    this.watchers.forEach((watcher) => watcher.close());
    clearInterval(this.pollTimer);
  }
}
