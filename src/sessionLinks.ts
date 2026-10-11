import * as vscode from "vscode";
import { displayTitle, SessionMeta } from "./indexer";
import {
  judgeCacheFilePath,
  JudgeCacheEntries,
  LinkCacheEntries,
  linkCacheFilePath,
  loadJudgeCache,
  loadLinkCache,
  saveJudgeCache,
  saveLinkCache,
} from "./linkCache";
import { LinkCandidate, LinkKind, LinkScanCacheEntry, scanTranscriptLinks, summarizeCandidates } from "./linkCandidates";
import {
  candidateFingerprint,
  createClaudeRunner,
  JudgeSessionContext,
  judgeSessionLinks,
  needsJudging,
  resolveLinks,
} from "./linkJudge";
import {
  ConcurrencyLimiter,
  LinkViewSettings,
  MarkedLink,
  markLinks,
  ownedTicketKey,
  sessionsThatWentIdle,
  visibleLinks,
} from "./linkView";
import { LiveStatus } from "./liveParse";
import { LiveSessionMonitor, resolveClaudeBinary } from "./liveSessions";
import { LinkMarks } from "./registry";

const LINKS_CONFIG_SECTION = "overseer.links";
const IDLE_RESCAN_DELAY_MS = 60_000;
const SCAN_CACHE_SAVE_DELAY_MS = 5_000;
const MAX_CONCURRENT_SCANS = 2;
const MAX_CONCURRENT_JUDGES = 2;
const DEFAULT_JUDGE_MODEL = "haiku";

export interface LinkSettings extends LinkViewSettings {
  judgeModel: string;
}

export function readLinkSettings(): LinkSettings {
  const linksConfig = vscode.workspace.getConfiguration(LINKS_CONFIG_SECTION);
  const enabledKinds = new Set<LinkKind>();
  if (linksConfig.get<boolean>("github.enabled", true)) {
    enabledKinds.add("pr");
  }
  if (linksConfig.get<boolean>("jira.enabled", true)) {
    enabledKinds.add("ticket");
  }
  if (linksConfig.get<boolean>("artifacts.enabled", true)) {
    enabledKinds.add("artifact");
  }
  return {
    enabledKinds,
    showIrrelevant: linksConfig.get<boolean>("showIrrelevant", false),
    showRemoved: linksConfig.get<boolean>("showRemoved", false),
    jiraBaseUrl: linksConfig.get<string>("jira.baseUrl", ""),
    judgeModel: linksConfig.get<string>("judgeModel", DEFAULT_JUDGE_MODEL) || DEFAULT_JUDGE_MODEL,
  };
}

// Scans transcripts for links on first view and after each busy-to-idle flip, and judges them when a session is expanded.
export class SessionLinkService implements vscode.Disposable {
  private scanEntries: LinkCacheEntries = {};
  private judgeEntries: JudgeCacheEntries = {};
  private readonly cachesLoaded: Promise<void>;
  private readonly scannedThisWindow = new Set<string>();
  private readonly scansInFlight = new Map<string, Promise<void>>();
  private readonly judgesInFlight = new Map<string, Promise<void>>();
  private readonly expandedSessionIds = new Set<string>();
  private readonly failedJudgeFingerprints = new Map<string, string>();
  private readonly idleRescanTimers = new Map<string, NodeJS.Timeout>();
  private readonly candidatesByScanEntry = new WeakMap<LinkScanCacheEntry, LinkCandidate[]>();
  private readonly scanLimiter = new ConcurrencyLimiter(MAX_CONCURRENT_SCANS);
  private readonly judgeLimiter = new ConcurrencyLimiter(MAX_CONCURRENT_JUDGES);
  private previousLiveStatuses = new Map<string, LiveStatus>();
  private scanCacheSaveTimer: NodeJS.Timeout | undefined;
  private claudeBinary: Promise<string> | undefined;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly subscriptions: vscode.Disposable[];

  constructor(
    private readonly storageDir: string,
    private readonly liveMonitor: LiveSessionMonitor,
    private readonly findSessionMeta: (sessionId: string) => SessionMeta | undefined,
    private readonly readLinkMarks: (sessionId: string) => LinkMarks,
    private readonly log: vscode.OutputChannel,
  ) {
    this.cachesLoaded = this.loadCaches();
    this.subscriptions = [
      liveMonitor.onDidChange(() => this.scheduleIdleRescans()),
      vscode.workspace.onDidChangeConfiguration((change) => {
        if (change.affectsConfiguration(LINKS_CONFIG_SECTION)) {
          this.changeEmitter.fire();
        }
      }),
    ];
  }

  // Returns undefined until the first scan of this transcript lands; the scan starts here.
  linksFor(meta: SessionMeta): MarkedLink[] | undefined {
    if (!this.scannedThisWindow.has(meta.transcriptFile)) {
      void this.scan(meta);
    }
    const scanEntry = this.scanEntries[meta.transcriptFile];
    if (scanEntry === undefined) {
      return undefined;
    }
    const resolvedLinks = resolveLinks(this.candidatesFor(scanEntry), this.judgeEntries[meta.sessionId]);
    return visibleLinks(markLinks(resolvedLinks, this.readLinkMarks(meta.sessionId)), readLinkSettings());
  }

  ownedTicketKeys(sessionIds: string[]): Record<string, string> {
    const ticketKeys: Record<string, string> = {};
    for (const sessionId of sessionIds) {
      const meta = this.findSessionMeta(sessionId);
      const scanEntry = meta === undefined ? undefined : this.scanEntries[meta.transcriptFile];
      if (scanEntry === undefined) {
        continue;
      }
      const resolvedLinks = resolveLinks(this.candidatesFor(scanEntry), this.judgeEntries[sessionId]);
      const ticketKey = ownedTicketKey(markLinks(resolvedLinks, this.readLinkMarks(sessionId)));
      if (ticketKey !== undefined) {
        ticketKeys[sessionId] = ticketKey;
      }
    }
    return ticketKeys;
  }

  noteExpanded(meta: SessionMeta): void {
    this.expandedSessionIds.add(meta.sessionId);
    void this.judge(meta, false);
  }

  async refreshSession(meta: SessionMeta): Promise<void> {
    this.expandedSessionIds.add(meta.sessionId);
    this.failedJudgeFingerprints.delete(meta.sessionId);
    await this.scan(meta);
    await this.judge(meta, true);
  }

  private candidatesFor(scanEntry: LinkScanCacheEntry): LinkCandidate[] {
    let candidates = this.candidatesByScanEntry.get(scanEntry);
    if (candidates === undefined) {
      candidates = summarizeCandidates(scanEntry.state);
      this.candidatesByScanEntry.set(scanEntry, candidates);
    }
    return candidates;
  }

  private async loadCaches(): Promise<void> {
    const [scanEntries, judgeEntries] = await Promise.all([
      loadLinkCache(linkCacheFilePath(this.storageDir)),
      loadJudgeCache(judgeCacheFilePath(this.storageDir)),
    ]);
    this.scanEntries = { ...scanEntries, ...this.scanEntries };
    this.judgeEntries = { ...judgeEntries, ...this.judgeEntries };
    this.changeEmitter.fire();
  }

  private scan(meta: SessionMeta): Promise<void> {
    const transcriptFile = meta.transcriptFile;
    this.scannedThisWindow.add(transcriptFile);
    const inFlightScan = this.scansInFlight.get(transcriptFile);
    if (inFlightScan !== undefined) {
      return inFlightScan;
    }
    const scanRun = this.scanLimiter
      .run(() => this.runScan(transcriptFile))
      .finally(() => this.scansInFlight.delete(transcriptFile));
    this.scansInFlight.set(transcriptFile, scanRun);
    return scanRun;
  }

  private async runScan(transcriptFile: string): Promise<void> {
    await this.cachesLoaded;
    const previousEntry = this.scanEntries[transcriptFile];
    try {
      const scanEntry = await scanTranscriptLinks(transcriptFile, previousEntry);
      if (scanEntry === undefined || scanEntry === previousEntry) {
        return;
      }
      this.scanEntries[transcriptFile] = scanEntry;
      this.scheduleScanCacheSave();
      this.changeEmitter.fire();
    } catch (error) {
      this.log.appendLine(`Link scan failed for ${transcriptFile}: ${String(error)}`);
    }
  }

  private judge(meta: SessionMeta, force: boolean): Promise<void> {
    const sessionId = meta.sessionId;
    const inFlightJudge = this.judgesInFlight.get(sessionId);
    if (inFlightJudge !== undefined) {
      return inFlightJudge;
    }
    const judgeRun = this.judgeLimiter
      .run(() => this.runJudge(meta, force))
      .finally(() => this.judgesInFlight.delete(sessionId));
    this.judgesInFlight.set(sessionId, judgeRun);
    return judgeRun;
  }

  private async runJudge(meta: SessionMeta, force: boolean): Promise<void> {
    await this.cachesLoaded;
    const scanEntry = this.scanEntries[meta.transcriptFile];
    if (scanEntry === undefined) {
      return;
    }
    const candidates = this.candidatesFor(scanEntry);
    if (candidates.length === 0) {
      return;
    }
    const fingerprint = candidateFingerprint(candidates);
    const { judgeModel } = readLinkSettings();
    if (!force && this.failedJudgeFingerprints.get(meta.sessionId) === fingerprint) {
      return;
    }
    if (!force && !needsJudging(candidates, this.judgeEntries[meta.sessionId], judgeModel)) {
      return;
    }
    // Another window may have judged this session since this one loaded the cache.
    const judgeCacheFile = judgeCacheFilePath(this.storageDir);
    const savedJudgeEntry = (await loadJudgeCache(judgeCacheFile))[meta.sessionId];
    if (!force && savedJudgeEntry !== undefined && !needsJudging(candidates, savedJudgeEntry, judgeModel)) {
      this.judgeEntries[meta.sessionId] = savedJudgeEntry;
      this.changeEmitter.fire();
      return;
    }
    const startedAtMs = Date.now();
    try {
      this.claudeBinary ??= resolveClaudeBinary();
      const runClaude = createClaudeRunner(await this.claudeBinary);
      const judgeEntry = await judgeSessionLinks(judgeContext(meta), candidates, judgeModel, runClaude);
      this.judgeEntries[meta.sessionId] = judgeEntry;
      this.failedJudgeFingerprints.delete(meta.sessionId);
      const latestJudgeEntries = await loadJudgeCache(judgeCacheFile);
      await saveJudgeCache(judgeCacheFile, { ...latestJudgeEntries, [meta.sessionId]: judgeEntry });
      this.log.appendLine(
        `Judged ${candidates.length} links for "${displayTitle(meta)}" in ${Date.now() - startedAtMs}ms`,
      );
    } catch (error) {
      this.claudeBinary = undefined;
      this.failedJudgeFingerprints.set(meta.sessionId, fingerprint);
      this.log.appendLine(`Link judge failed for "${displayTitle(meta)}", showing signal-based roles: ${String(error)}`);
    }
    this.changeEmitter.fire();
  }

  private scheduleIdleRescans(): void {
    const currentLiveStatuses = this.liveMonitor.statuses();
    const idleSessionIds = sessionsThatWentIdle(this.previousLiveStatuses, currentLiveStatuses);
    this.previousLiveStatuses = currentLiveStatuses;
    for (const sessionId of idleSessionIds) {
      clearTimeout(this.idleRescanTimers.get(sessionId));
      const rescanTimer = setTimeout(() => void this.rescanAfterIdle(sessionId), IDLE_RESCAN_DELAY_MS);
      this.idleRescanTimers.set(sessionId, rescanTimer);
    }
  }

  private async rescanAfterIdle(sessionId: string): Promise<void> {
    this.idleRescanTimers.delete(sessionId);
    const meta = this.findSessionMeta(sessionId);
    if (meta === undefined || !this.scannedThisWindow.has(meta.transcriptFile)) {
      return;
    }
    await this.scan(meta);
    if (this.expandedSessionIds.has(sessionId)) {
      await this.judge(meta, false);
    }
  }

  private scheduleScanCacheSave(): void {
    clearTimeout(this.scanCacheSaveTimer);
    this.scanCacheSaveTimer = setTimeout(() => void this.saveScanCache(), SCAN_CACHE_SAVE_DELAY_MS);
  }

  private async saveScanCache(): Promise<void> {
    try {
      await saveLinkCache(linkCacheFilePath(this.storageDir), this.scanEntries);
    } catch (error) {
      this.log.appendLine(`Link cache save failed: ${String(error)}`);
    }
  }

  dispose(): void {
    if (this.scanCacheSaveTimer !== undefined) {
      clearTimeout(this.scanCacheSaveTimer);
      void this.saveScanCache();
    }
    this.idleRescanTimers.forEach((rescanTimer) => clearTimeout(rescanTimer));
    this.subscriptions.forEach((subscription) => subscription.dispose());
    this.changeEmitter.dispose();
  }
}

function judgeContext(meta: SessionMeta): JudgeSessionContext {
  return {
    title: displayTitle(meta),
    gitBranch: meta.gitBranch,
    cwd: meta.resumeCwd ?? meta.startCwd,
    firstPrompt: meta.firstPrompt,
  };
}
