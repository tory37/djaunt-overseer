import * as vscode from "vscode";
import { SessionMeta } from "./indexer";
import { LinkCacheEntries, linkCacheFilePath, loadLinkCache, saveLinkCache } from "./linkCache";
import { LinkKind, LinkScanState, scanTranscriptLinks } from "./linkCandidates";
import { ConcurrencyLimiter, LinkViewSettings } from "./linkView";

const LINKS_CONFIG_SECTION = "overseer.links";
const SCAN_CACHE_SAVE_DELAY_MS = 5_000;
const MAX_CONCURRENT_SCANS = 2;

export function readLinkSettings(): LinkViewSettings {
  const linksConfig = vscode.workspace.getConfiguration(LINKS_CONFIG_SECTION);
  const enabledKinds = new Set<LinkKind>();
  if (linksConfig.get<boolean>("commits.enabled", false)) {
    enabledKinds.add("commit");
  }
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
    jiraBaseUrl: linksConfig.get<string>("jira.baseUrl", ""),
    showsOnlyOpenPrs: linksConfig.get<boolean>("prs.openOnly", true),
  };
}

// Scans a session's transcript for links when the analyzer, the Session sidebar, or the preview asks, resuming from the saved offset.
export class SessionLinkService implements vscode.Disposable {
  private scanEntries: LinkCacheEntries = {};
  private readonly cacheLoaded: Promise<void>;
  private readonly scansInFlight = new Map<string, Promise<void>>();
  private readonly scanLimiter = new ConcurrencyLimiter(MAX_CONCURRENT_SCANS);
  private scanCacheSaveTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly storageDir: string,
    private readonly log: vscode.OutputChannel,
  ) {
    this.cacheLoaded = this.loadCache();
  }

  // Brings the scan up to date first, so the caller sees every complete line written so far.
  async scanStateFor(meta: SessionMeta): Promise<LinkScanState | undefined> {
    await this.scan(meta);
    return this.scanEntries[meta.transcriptFile]?.state;
  }

  private async loadCache(): Promise<void> {
    const scanEntries = await loadLinkCache(linkCacheFilePath(this.storageDir));
    this.scanEntries = { ...scanEntries, ...this.scanEntries };
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
    await this.cacheLoaded;
    const previousEntry = this.scanEntries[transcriptFile];
    try {
      const scanEntry = await scanTranscriptLinks(transcriptFile, previousEntry);
      if (scanEntry === undefined || scanEntry === previousEntry) {
        return;
      }
      this.scanEntries[transcriptFile] = scanEntry;
      this.scheduleScanCacheSave();
    } catch (error) {
      this.log.appendLine(`Link scan failed for ${transcriptFile}: ${String(error)}`);
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
  }
}
