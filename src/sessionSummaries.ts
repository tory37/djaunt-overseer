import * as path from "path";
import * as vscode from "vscode";
import { displayTitle, SessionMeta } from "./indexer";
import { loadVersionedCache, saveVersionedCache } from "./linkCache";
import { createClaudeRunner } from "./linkJudge";
import { ConcurrencyLimiter } from "./linkView";
import { resolveClaudeBinary } from "./liveSessions";
import { buildSummaryDigest, parseSummaryOutput, readTranscriptTail, SummaryCacheEntry, summaryArgs } from "./sessionSummary";

const SUMMARY_CACHE_FILE_NAME = "session-summaries.json";
const SUMMARY_CACHE_SCHEMA_VERSION = 1;
const MAX_CONCURRENT_SUMMARIES = 2;
const DEFAULT_SUMMARY_MODEL = "haiku";

type SummaryCacheEntries = Record<string, SummaryCacheEntry>;

// Summarizes a session with a headless claude -p run, only when the user asks.
export class SessionSummaryService implements vscode.Disposable {
  private summaryEntries: SummaryCacheEntries = {};
  private readonly cacheLoaded: Promise<void>;
  private readonly summariesInFlight = new Map<string, Promise<void>>();
  private readonly limiter = new ConcurrencyLimiter(MAX_CONCURRENT_SUMMARIES);
  private claudeBinary: Promise<string> | undefined;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  constructor(
    private readonly storageDir: string,
    private readonly log: vscode.OutputChannel,
  ) {
    this.cacheLoaded = this.loadCache();
  }

  summaryFor(sessionId: string): SummaryCacheEntry | undefined {
    return this.summaryEntries[sessionId];
  }

  isSummarizing(sessionId: string): boolean {
    return this.summariesInFlight.has(sessionId);
  }

  summarize(meta: SessionMeta): Promise<void> {
    const inFlightSummary = this.summariesInFlight.get(meta.sessionId);
    if (inFlightSummary !== undefined) {
      return inFlightSummary;
    }
    const summaryRun = this.limiter
      .run(() => this.runSummary(meta))
      .finally(() => {
        this.summariesInFlight.delete(meta.sessionId);
        this.changeEmitter.fire();
      });
    this.summariesInFlight.set(meta.sessionId, summaryRun);
    this.changeEmitter.fire();
    return summaryRun;
  }

  private cacheFile(): string {
    return path.join(this.storageDir, SUMMARY_CACHE_FILE_NAME);
  }

  private async loadCache(): Promise<void> {
    const savedEntries = await loadVersionedCache<SummaryCacheEntries>(this.cacheFile(), SUMMARY_CACHE_SCHEMA_VERSION);
    this.summaryEntries = { ...savedEntries, ...this.summaryEntries };
    this.changeEmitter.fire();
  }

  private async runSummary(meta: SessionMeta): Promise<void> {
    await this.cacheLoaded;
    const model =
      vscode.workspace.getConfiguration("overseer.summary").get<string>("model", DEFAULT_SUMMARY_MODEL) ||
      DEFAULT_SUMMARY_MODEL;
    const startedAtMs = Date.now();
    try {
      const transcriptLines = await readTranscriptTail(meta.transcriptFile);
      const transcriptSizeBytes = (await vscode.workspace.fs.stat(vscode.Uri.file(meta.transcriptFile))).size;
      const digestText = buildSummaryDigest(
        {
          title: displayTitle(meta),
          gitBranch: meta.gitBranch,
          cwd: meta.resumeCwd ?? meta.startCwd,
          firstPrompt: meta.firstPrompt,
        },
        transcriptLines,
      );
      this.claudeBinary ??= resolveClaudeBinary();
      const runClaude = createClaudeRunner(await this.claudeBinary);
      const summaryText = parseSummaryOutput(await runClaude(summaryArgs(model), digestText));
      const summaryEntry: SummaryCacheEntry = {
        text: summaryText,
        model,
        summarizedAtMs: Date.now(),
        transcriptSizeBytes,
      };
      this.summaryEntries[meta.sessionId] = summaryEntry;
      // Other windows save summaries to the same file.
      const latestEntries = await loadVersionedCache<SummaryCacheEntries>(this.cacheFile(), SUMMARY_CACHE_SCHEMA_VERSION);
      await saveVersionedCache(
        this.cacheFile(),
        { ...latestEntries, [meta.sessionId]: summaryEntry },
        SUMMARY_CACHE_SCHEMA_VERSION,
      );
      this.log.appendLine(`Summarized "${displayTitle(meta)}" in ${Date.now() - startedAtMs}ms`);
    } catch (error) {
      this.claudeBinary = undefined;
      this.log.appendLine(`Summary failed for "${displayTitle(meta)}": ${String(error)}`);
      void vscode.window.showWarningMessage(`Overseer couldn't summarize "${displayTitle(meta)}". See the Overseer output.`);
    }
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}
