import * as vscode from "vscode";
import { AGENT_TICKETS_SCHEMA_VERSION, declaredTicketsFile, isSafeSessionId, readDeclaredTickets, userTicketMarksFromLinkMarks } from "./agentTickets";
import { AGENT_WORK_SCHEMA_VERSION, declaredWorkFile, readSessionWork } from "./agentWork";
import { DeclarationMonitor } from "./declarationMonitor";
import { displayTitle, SessionMeta } from "./indexer";
import { loadVersionedCache, saveVersionedCache } from "./linkCache";
import { createClaudeRunner } from "./linkJudge";
import { ConcurrencyLimiter } from "./linkView";
import { resolveClaudeBinary } from "./liveSessions";
import { buildPopulateDigest, populateArgs, populateFailureReason, parsePopulateOutput, PopulateResult, RECHECK_DIGEST_BYTES } from "./populateDigest";
import { EMPTY_POPULATE_SUMMARY, mergePopulateResult, PopulateSummary } from "./populateMerge";
import { Registry } from "./registry";
import { readTranscriptTail } from "./sessionSummary";

const POPULATE_MODEL = "haiku";
const MAX_CONCURRENT_POPULATES = 2;

// Reads a digest of a session's transcript with Haiku and declares what it worked on, for sessions that never tracked it.
export class SessionPopulator implements vscode.Disposable {
  private readonly populatesInFlight = new Map<string, Promise<PopulateSummary>>();
  private readonly limiter = new ConcurrencyLimiter(MAX_CONCURRENT_POPULATES);
  private claudeBinary: Promise<string> | undefined;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  constructor(
    private readonly claudeHome: string,
    private readonly registry: Registry,
    private readonly declarationMonitor: DeclarationMonitor,
    private readonly log: vscode.OutputChannel,
  ) {}

  isPopulating(sessionId: string): boolean {
    return this.populatesInFlight.has(sessionId);
  }

  // A first populate reports failures in a toast and resolves empty. A recheck rejects with a short reason for the sidebar.
  populate(meta: SessionMeta, options: { isRecheck?: boolean } = {}): Promise<PopulateSummary> {
    const isRecheck = options.isRecheck === true;
    const populateRun = this.populatesInFlight.get(meta.sessionId) ?? this.startPopulate(meta, isRecheck);
    if (isRecheck) {
      return populateRun;
    }
    return populateRun.catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      void vscode.window.showWarningMessage(`Overseer couldn't populate "${displayTitle(meta)}". ${reason}`);
      return EMPTY_POPULATE_SUMMARY;
    });
  }

  private startPopulate(meta: SessionMeta, isRecheck: boolean): Promise<PopulateSummary> {
    const populateRun = this.limiter
      .run(() => this.runPopulate(meta, isRecheck))
      .finally(() => {
        this.populatesInFlight.delete(meta.sessionId);
        this.changeEmitter.fire();
      });
    this.populatesInFlight.set(meta.sessionId, populateRun);
    this.changeEmitter.fire();
    return populateRun;
  }

  private async runPopulate(meta: SessionMeta, isRecheck: boolean): Promise<PopulateSummary> {
    if (!isSafeSessionId(meta.sessionId)) {
      return EMPTY_POPULATE_SUMMARY;
    }
    const startedAtMs = Date.now();
    try {
      const removedTicketKeys = userTicketMarksFromLinkMarks(this.registry.linkMarks(meta.sessionId)).removed;
      const digestText = buildPopulateDigest(
        {
          title: this.registry.labels()[meta.sessionId] ?? displayTitle(meta),
          gitBranch: meta.gitBranch,
          cwd: meta.resumeCwd ?? meta.startCwd,
          removedTicketKeys,
        },
        await readTranscriptTail(meta.transcriptFile, meta.sizeBytes),
        isRecheck ? RECHECK_DIGEST_BYTES : undefined,
      );
      this.claudeBinary ??= resolveClaudeBinary();
      const runClaude = createClaudeRunner(await this.claudeBinary);
      const populateResult = parsePopulateOutput(await runClaude(populateArgs(POPULATE_MODEL), digestText));
      const summary = await this.saveDeclarations(meta.sessionId, populateResult, removedTicketKeys, isRecheck);
      this.declarationMonitor.rescan();
      this.log.appendLine(`${isRecheck ? "Rechecked" : "Populated"} "${displayTitle(meta)}" in ${Date.now() - startedAtMs}ms`);
      return summary;
    } catch (error) {
      this.claudeBinary = undefined;
      this.log.appendLine(`${isRecheck ? "Recheck" : "Populate"} failed for "${displayTitle(meta)}": ${String(error)}`);
      throw new Error(populateFailureReason(error));
    }
  }

  private async saveDeclarations(
    sessionId: string,
    populateResult: PopulateResult,
    removedTicketKeys: string[],
    isRecheck: boolean,
  ): Promise<PopulateSummary> {
    const ticketsFile = declaredTicketsFile(this.claudeHome, sessionId);
    const workFile = declaredWorkFile(this.claudeHome, sessionId);
    const merge = mergePopulateResult({
      savedTickets: readDeclaredTickets(await loadVersionedCache<unknown>(ticketsFile, AGENT_TICKETS_SCHEMA_VERSION)),
      savedWork: readSessionWork(await loadVersionedCache<unknown>(workFile, AGENT_WORK_SCHEMA_VERSION)),
      populateResult,
      removedTicketKeys,
      isRecheck,
      now: Date.now(),
    });
    await saveVersionedCache(ticketsFile, merge.tickets, AGENT_TICKETS_SCHEMA_VERSION);
    await saveVersionedCache(workFile, merge.work, AGENT_WORK_SCHEMA_VERSION);
    return merge.summary;
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}
