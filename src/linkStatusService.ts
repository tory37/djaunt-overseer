import { execFile } from "child_process";
import * as vscode from "vscode";
import { IssueFacts, projectKeyOf } from "./jira";
import { JiraService, MAX_TICKETS_PER_CALL } from "./jiraService";
import { ResolvedLink } from "./linkJudge";
import { LinkStatus, parsePrStatus, prStatusArgs, ticketStatus } from "./linkStatus";
import { ConcurrencyLimiter } from "./linkView";
import { resolveCliBinary } from "./liveSessions";
import { StatusCacheEntry, StoredStatusCache } from "./statusCache";
import { StatusConfig } from "./statusConfig";

const STATUS_TTL_MS = 5 * 60_000;
// Redraws the tree on the TTL, so rows on screen refetch even when nothing else changes.
const STATUS_REFRESH_INTERVAL_MS = STATUS_TTL_MS;
const STATUS_SAVE_DELAY_MS = 2_000;
const MAX_CONCURRENT_STATUS_CALLS = 4;
const STATUS_COMMAND_TIMEOUT_MS = 20_000;
const STATUS_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
// Tree items render one by one; a short wait lets one Jira call cover every visible ticket.
const TICKET_BATCH_DELAY_MS = 100;

// Fetches PR status through gh and ticket status through the Jira MCP server, for links on screen.
export class LinkStatusService implements vscode.Disposable {
  private readonly statusCache: Map<string, StatusCacheEntry>;
  private readonly refreshTimer: NodeJS.Timeout;
  private saveTimer: NodeJS.Timeout | undefined;
  private readonly fetchesInFlight = new Set<string>();
  private readonly queuedTicketKeys = new Set<string>();
  private ticketBatchTimer: NodeJS.Timeout | undefined;
  private ghPath: Promise<string> | undefined;
  private isGhMissing = false;
  private isJiraFailing = false;
  private readonly limiter = new ConcurrencyLimiter(MAX_CONCURRENT_STATUS_CALLS);
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  constructor(
    private readonly log: vscode.OutputChannel,
    private readonly jiraService: JiraService,
    private readonly statusConfig: StatusConfig,
    private readonly storedStatusCache: StoredStatusCache,
  ) {
    this.statusCache = storedStatusCache.load(Date.now());
    this.refreshTimer = setInterval(() => {
      if (vscode.window.state.focused) {
        this.changeEmitter.fire();
      }
    }, STATUS_REFRESH_INTERVAL_MS);
  }

  // Returns the last known status, and starts a fetch when it is missing or older than five minutes.
  statusFor(link: ResolvedLink): LinkStatus | undefined {
    if (!vscode.workspace.getConfiguration("overseer.links").get<boolean>("liveStatus", true)) {
      return undefined;
    }
    if (link.kind === "ticket") {
      const projectKey = projectKeyOf(link.id);
      if (projectKey === undefined || !this.statusConfig.isProjectEnabled(projectKey)) {
        return undefined;
      }
    }
    if (link.kind === "artifact" || link.kind === "commit" || (link.kind === "pr" && this.isGhMissing)) {
      return undefined;
    }
    const cacheKey = `${link.kind}:${link.id}`;
    const cachedEntry = this.statusCache.get(cacheKey);
    const isStale = cachedEntry === undefined || Date.now() - cachedEntry.fetchedAtMs > STATUS_TTL_MS;
    if (isStale && !this.fetchesInFlight.has(cacheKey)) {
      this.fetchesInFlight.add(cacheKey);
      if (link.kind === "ticket") {
        this.queueTicket(link.id);
      } else {
        void this.limiter.run(() => this.fetchPrStatus(link, cacheKey)).finally(() => this.fetchesInFlight.delete(cacheKey));
      }
    }
    return cachedEntry?.status;
  }

  // Reads the cache only, so the analyzer can enrich candidates without starting a fetch.
  cachedStatuses(kind: "pr" | "ticket"): Map<string, LinkStatus> {
    const statusesById = new Map<string, LinkStatus>();
    const keyPrefix = `${kind}:`;
    for (const [cacheKey, cachedEntry] of this.statusCache) {
      if (cacheKey.startsWith(keyPrefix) && cachedEntry.status !== undefined) {
        statusesById.set(cacheKey.slice(keyPrefix.length), cachedEntry.status);
      }
    }
    return statusesById;
  }

  clear(): void {
    this.statusCache.clear();
    this.isJiraFailing = false;
    this.changeEmitter.fire();
  }

  // Marks these links stale and redraws, so the next render refetches them without blanking the shown status.
  refresh(links: ResolvedLink[]): void {
    for (const link of links) {
      const cachedEntry = this.statusCache.get(`${link.kind}:${link.id}`);
      if (cachedEntry !== undefined) {
        cachedEntry.fetchedAtMs = 0;
      }
    }
    this.changeEmitter.fire();
  }

  forgetTicket(ticketKey: string): void {
    this.statusCache.delete(`ticket:${ticketKey}`);
    this.changeEmitter.fire();
  }

  private queueTicket(ticketKey: string): void {
    this.queuedTicketKeys.add(ticketKey);
    this.ticketBatchTimer ??= setTimeout(() => void this.flushTickets(), TICKET_BATCH_DELAY_MS);
  }

  private async flushTickets(): Promise<void> {
    this.ticketBatchTimer = undefined;
    const ticketKeys = [...this.queuedTicketKeys];
    this.queuedTicketKeys.clear();
    for (let batchStart = 0; batchStart < ticketKeys.length; batchStart += MAX_TICKETS_PER_CALL) {
      const batchKeys = ticketKeys.slice(batchStart, batchStart + MAX_TICKETS_PER_CALL);
      await this.limiter.run(() => this.fetchTicketStatuses(batchKeys));
      batchKeys.forEach((ticketKey) => this.fetchesInFlight.delete(`ticket:${ticketKey}`));
    }
  }

  private async fetchTicketStatuses(ticketKeys: string[]): Promise<void> {
    let issueStatuses: Map<string, IssueFacts>;
    try {
      issueStatuses = await this.jiraService.issueStatuses(ticketKeys);
      this.isJiraFailing = false;
    } catch (error) {
      if (!this.isJiraFailing) {
        this.isJiraFailing = true;
        this.log.appendLine(`Jira status lookup failed: ${firstLine(error)}`);
      }
      // Cache the miss too, so a broken server is retried every five minutes, not on every render.
      ticketKeys.forEach((ticketKey) => this.store(`ticket:${ticketKey}`, undefined));
      return;
    }
    let hasChanged = false;
    for (const ticketKey of ticketKeys) {
      const issueFacts = issueStatuses.get(ticketKey);
      const status =
        issueFacts === undefined ? undefined : ticketStatus(issueFacts.status, issueFacts.summary, issueFacts.parentKey);
      hasChanged = this.store(`ticket:${ticketKey}`, status) || hasChanged;
      if (issueFacts !== undefined) {
        await this.noteTicketStatus(ticketKey, issueFacts.status);
      }
    }
    if (hasChanged) {
      this.changeEmitter.fire();
    }
  }

  // A ticket from an unknown project adds that project and loads its full status list.
  private async noteTicketStatus(ticketKey: string, statusName: string): Promise<void> {
    const projectKey = projectKeyOf(ticketKey);
    if (projectKey === undefined) {
      return;
    }
    const isNewProject = await this.statusConfig.noteProject(projectKey, ticketKey);
    await this.statusConfig.addStatuses(projectKey, [statusName]);
    if (isNewProject) {
      await this.loadProjectStatuses(projectKey, ticketKey);
    }
  }

  async loadProjectStatuses(projectKey: string, sampleTicketKey: string): Promise<void> {
    try {
      const workflow = await this.jiraService.workflow(sampleTicketKey);
      await this.statusConfig.addStatuses(projectKey, workflow?.statuses ?? []);
    } catch (error) {
      this.log.appendLine(`Jira workflow lookup failed for ${projectKey}: ${firstLine(error)}`);
    }
  }

  private async fetchPrStatus(link: ResolvedLink, cacheKey: string): Promise<void> {
    this.ghPath ??= resolveCliBinary("gh");
    let status: LinkStatus | undefined;
    try {
      const ghBinary = await this.ghPath;
      status = parsePrStatus(await execFileText(ghBinary, prStatusArgs(link.url ?? `https://github.com/${link.id}`)));
    } catch (error) {
      if (String(error).includes("not found on PATH")) {
        this.isGhMissing = true;
        this.log.appendLine("gh not found; PR status is off until reload.");
        return;
      }
      this.log.appendLine(`Status lookup failed for ${cacheKey}: ${firstLine(error)}`);
    }
    if (this.store(cacheKey, status)) {
      this.changeEmitter.fire();
    }
  }

  // Returns true when the status differs from the cached one.
  private store(cacheKey: string, status: LinkStatus | undefined): boolean {
    const previousStatus = this.statusCache.get(cacheKey)?.status;
    this.statusCache.set(cacheKey, { status, fetchedAtMs: Date.now() });
    this.scheduleSave();
    return JSON.stringify(previousStatus) !== JSON.stringify(status);
  }

  private scheduleSave(): void {
    this.saveTimer ??= setTimeout(() => {
      this.saveTimer = undefined;
      void this.storedStatusCache.save(this.statusCache, Date.now());
    }, STATUS_SAVE_DELAY_MS);
  }

  dispose(): void {
    clearTimeout(this.ticketBatchTimer);
    clearInterval(this.refreshTimer);
    if (this.saveTimer !== undefined) {
      clearTimeout(this.saveTimer);
      void this.storedStatusCache.save(this.statusCache, Date.now());
    }
    this.changeEmitter.dispose();
  }
}

function execFileText(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: STATUS_COMMAND_TIMEOUT_MS, maxBuffer: STATUS_MAX_BUFFER_BYTES },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
        } else {
          resolve(stdout);
        }
      },
    );
  });
}

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0];
}
