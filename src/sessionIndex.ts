import * as vscode from "vscode";
import { cacheFilePath, loadIndexCache, saveIndexCache } from "./indexCache";
import { IndexCacheEntries, indexSessions, SessionMeta } from "./indexer";
import { projectsDir } from "./paths";

export class SessionIndex implements vscode.Disposable {
  private sessions: SessionMeta[] = [];
  private cacheEntries: IndexCacheEntries | undefined;
  private refreshInFlight: Promise<SessionMeta[]> | undefined;
  private readonly changeEmitter = new vscode.EventEmitter<SessionMeta[]>();
  readonly onDidChange = this.changeEmitter.event;

  constructor(
    private readonly claudeHome: string,
    private readonly storageDir: string,
    private readonly log: vscode.OutputChannel,
  ) {}

  get currentSessions(): SessionMeta[] {
    return this.sessions;
  }

  get isRefreshing(): boolean {
    return this.refreshInFlight !== undefined;
  }

  refresh(): Promise<SessionMeta[]> {
    this.refreshInFlight ??= this.runRefresh().finally(() => {
      this.refreshInFlight = undefined;
    });
    return this.refreshInFlight;
  }

  private async runRefresh(): Promise<SessionMeta[]> {
    const cacheFile = cacheFilePath(this.storageDir);
    this.cacheEntries ??= await loadIndexCache(cacheFile);
    const startedAtMs = Date.now();
    try {
      const indexResult = await indexSessions(projectsDir(this.claudeHome), this.cacheEntries);
      this.cacheEntries = indexResult.cacheEntries;
      this.sessions = indexResult.sessions;
      if (indexResult.scannedFileCount > 0) {
        await saveIndexCache(cacheFile, indexResult.cacheEntries);
      }
      this.log.appendLine(
        `Indexed ${this.sessions.length} sessions (${indexResult.scannedFileCount} rescanned) in ${Date.now() - startedAtMs}ms`,
      );
      this.changeEmitter.fire(this.sessions);
    } catch (error) {
      this.log.appendLine(`Index refresh failed: ${String(error)}`);
    }
    return this.sessions;
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}
