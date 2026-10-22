import * as vscode from "vscode";
import { DeclaredTicket } from "./agentTickets";
import { SessionWork } from "./agentWork";
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
  ResolvedLink,
  resolveLinks,
} from "./linkJudge";
import {
  ConcurrencyLimiter,
  LinkViewSettings,
  MarkedLink,
  markLinks,
  ownedTicketKey,
  visibleLinks,
  withDeclarations,
} from "./linkView";
import { resolveClaudeBinary } from "./liveSessions";
import { LinkMarks } from "./registry";

export interface DeclarationSource {
  declaredTickets(sessionId: string): DeclaredTicket[];
  sessionWork(sessionId: string): SessionWork;
  onDidChange: vscode.Event<void>;
}

const LINKS_CONFIG_SECTION = "overseer.links";
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

// Scans and judges a session's links only when the user runs Find Resources on it.
export class SessionLinkService implements vscode.Disposable {
  private scanEntries: LinkCacheEntries = {};
  private judgeEntries: JudgeCacheEntries = {};
  private readonly cachesLoaded: Promise<void>;
  private readonly scansInFlight = new Map<string, Promise<void>>();
  private readonly judgesInFlight = new Map<string, Promise<void>>();
  private readonly findingSessionIds = new Set<string>();
  private readonly failedJudgeFingerprints = new Map<string, string>();
  private readonly candidatesByScanEntry = new WeakMap<LinkScanCacheEntry, LinkCandidate[]>();
  private readonly scanLimiter = new ConcurrencyLimiter(MAX_CONCURRENT_SCANS);
  private readonly judgeLimiter = new ConcurrencyLimiter(MAX_CONCURRENT_JUDGES);
  private scanCacheSaveTimer: NodeJS.Timeout | undefined;
  private claudeBinary: Promise<string> | undefined;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly subscriptions: vscode.Disposable[];

  constructor(
    private readonly storageDir: string,
    private readonly findSessionMeta: (sessionId: string) => SessionMeta | undefined,
    private readonly readLinkMarks: (sessionId: string) => LinkMarks,
    private readonly readLinkOrder: (sessionId: string) => string[],
    private readonly declarationSource: DeclarationSource,
    private readonly log: vscode.OutputChannel,
  ) {
    this.cachesLoaded = this.loadCaches();
    this.subscriptions = [
      vscode.workspace.onDidChangeConfiguration((change) => {
        if (change.affectsConfiguration(LINKS_CONFIG_SECTION)) {
          this.changeEmitter.fire();
        }
      }),
      declarationSource.onDidChange(() => this.changeEmitter.fire()),
    ];
  }

  // Returns undefined until Find Resources has scanned this transcript or the agent has declared a ticket or PR.
  linksFor(meta: SessionMeta): MarkedLink[] | undefined {
    return this.visibleLinksFor(meta.sessionId, meta);
  }

  // The session panel shows a brand-new session before the index has it, so the transcript metadata is optional.
  visibleLinksFor(sessionId: string, meta: SessionMeta | undefined = this.findSessionMeta(sessionId)): MarkedLink[] | undefined {
    const resolvedLinks = this.resolvedLinksFor(sessionId, meta);
    if (resolvedLinks === undefined) {
      return undefined;
    }
    const markedLinks = markLinks(resolvedLinks, this.readLinkMarks(sessionId));
    return visibleLinks(markedLinks, readLinkSettings(), this.readLinkOrder(sessionId));
  }

  ownedTicketKeys(sessionIds: string[]): Record<string, string> {
    const ticketKeys: Record<string, string> = {};
    for (const sessionId of sessionIds) {
      const resolvedLinks = this.resolvedLinksFor(sessionId, this.findSessionMeta(sessionId));
      if (resolvedLinks === undefined) {
        continue;
      }
      const ticketKey = ownedTicketKey(markLinks(resolvedLinks, this.readLinkMarks(sessionId)));
      if (ticketKey !== undefined) {
        ticketKeys[sessionId] = ticketKey;
      }
    }
    return ticketKeys;
  }

  private resolvedLinksFor(sessionId: string, meta: SessionMeta | undefined): ResolvedLink[] | undefined {
    const scanEntry = meta === undefined ? undefined : this.scanEntries[meta.transcriptFile];
    const declaredTickets = this.declarationSource.declaredTickets(sessionId);
    const { pullRequests: declaredPullRequests, artifacts: declaredArtifacts } = this.declarationSource.sessionWork(sessionId);
    const hasDeclarations = declaredTickets.length > 0 || declaredPullRequests.length > 0 || declaredArtifacts.length > 0;
    if (scanEntry === undefined && !hasDeclarations) {
      return undefined;
    }
    const scannedLinks = scanEntry === undefined ? [] : resolveLinks(this.candidatesFor(scanEntry), this.judgeEntries[sessionId]);
    return withDeclarations(scannedLinks, declaredTickets, declaredPullRequests, declaredArtifacts);
  }

  isFinding(sessionId: string): boolean {
    return this.findingSessionIds.has(sessionId);
  }

  async findResources(meta: SessionMeta): Promise<void> {
    this.findingSessionIds.add(meta.sessionId);
    this.failedJudgeFingerprints.delete(meta.sessionId);
    this.changeEmitter.fire();
    try {
      await this.scan(meta);
      await this.judge(meta, true);
    } finally {
      this.findingSessionIds.delete(meta.sessionId);
      this.changeEmitter.fire();
    }
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
