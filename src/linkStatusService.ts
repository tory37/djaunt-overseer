import { execFile } from "child_process";
import * as vscode from "vscode";
import { ResolvedLink } from "./linkJudge";
import { LinkStatus, parsePrStatus, parseTicketStatus, prStatusArgs, ticketStatusArgs } from "./linkStatus";
import { ConcurrencyLimiter } from "./linkView";
import { resolveCliBinary } from "./liveSessions";

const STATUS_TTL_MS = 5 * 60_000;
const MAX_CONCURRENT_STATUS_CALLS = 4;
const STATUS_COMMAND_TIMEOUT_MS = 20_000;
const STATUS_MAX_BUFFER_BYTES = 4 * 1024 * 1024;

interface StatusCacheEntry {
  status: LinkStatus | undefined;
  fetchedAtMs: number;
}

interface StatusSource {
  binaryName: string;
  statusArgs: (link: ResolvedLink) => string[];
  parseStatus: (stdout: string) => LinkStatus | undefined;
}

const STATUS_SOURCES: Partial<Record<ResolvedLink["kind"], StatusSource>> = {
  pr: {
    binaryName: "gh",
    statusArgs: (link) => prStatusArgs(link.url ?? `https://github.com/${link.id}`),
    parseStatus: parsePrStatus,
  },
  ticket: {
    binaryName: "acli",
    statusArgs: (link) => ticketStatusArgs(link.id),
    parseStatus: parseTicketStatus,
  },
};

// Fetches PR and ticket status for links that are on screen, cached for five minutes.
export class LinkStatusService implements vscode.Disposable {
  private readonly statusCache = new Map<string, StatusCacheEntry>();
  private readonly fetchesInFlight = new Set<string>();
  private readonly binaryPaths = new Map<string, Promise<string>>();
  private readonly unavailableBinaries = new Set<string>();
  private readonly limiter = new ConcurrencyLimiter(MAX_CONCURRENT_STATUS_CALLS);
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly log: vscode.OutputChannel) {}

  // Returns the last known status, and starts a fetch when it is missing or older than five minutes.
  statusFor(link: ResolvedLink): LinkStatus | undefined {
    if (!vscode.workspace.getConfiguration("overseer.links").get<boolean>("liveStatus", true)) {
      return undefined;
    }
    const statusSource = STATUS_SOURCES[link.kind];
    if (statusSource === undefined || this.unavailableBinaries.has(statusSource.binaryName)) {
      return undefined;
    }
    const cacheKey = `${link.kind}:${link.id}`;
    const cachedEntry = this.statusCache.get(cacheKey);
    const isStale = cachedEntry === undefined || Date.now() - cachedEntry.fetchedAtMs > STATUS_TTL_MS;
    if (isStale && !this.fetchesInFlight.has(cacheKey)) {
      this.fetchesInFlight.add(cacheKey);
      void this.limiter
        .run(() => this.fetchStatus(link, statusSource, cacheKey))
        .finally(() => this.fetchesInFlight.delete(cacheKey));
    }
    return cachedEntry?.status;
  }

  clear(): void {
    this.statusCache.clear();
    this.changeEmitter.fire();
  }

  private async fetchStatus(link: ResolvedLink, statusSource: StatusSource, cacheKey: string): Promise<void> {
    const binaryPath = await this.binaryPath(statusSource.binaryName);
    if (binaryPath === undefined) {
      return;
    }
    let status: LinkStatus | undefined;
    try {
      status = statusSource.parseStatus(await execFileText(binaryPath, statusSource.statusArgs(link)));
    } catch (error) {
      this.log.appendLine(`Status lookup failed for ${cacheKey}: ${firstLine(error)}`);
    }
    const previousStatus = this.statusCache.get(cacheKey)?.status;
    this.statusCache.set(cacheKey, { status, fetchedAtMs: Date.now() });
    if (previousStatus?.text !== status?.text || previousStatus?.tone !== status?.tone) {
      this.changeEmitter.fire();
    }
  }

  private async binaryPath(binaryName: string): Promise<string | undefined> {
    let resolvedPath = this.binaryPaths.get(binaryName);
    if (resolvedPath === undefined) {
      resolvedPath = resolveCliBinary(binaryName);
      this.binaryPaths.set(binaryName, resolvedPath);
    }
    try {
      return await resolvedPath;
    } catch {
      if (!this.unavailableBinaries.has(binaryName)) {
        this.unavailableBinaries.add(binaryName);
        this.log.appendLine(`${binaryName} not found; link status for its links is off until reload.`);
      }
      return undefined;
    }
  }

  dispose(): void {
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
