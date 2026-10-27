import * as fs from "fs";
import * as vscode from "vscode";
import { isSafeSessionId } from "./agentTickets";
import { analysisLockFile, tryAcquireAnalysisLock } from "./analysisLock";
import { seedAnalysis } from "./analysisSeed";
import { SessionAnalysis } from "./analysisState";
import { analysisFile, loadAnalysis, loadLegacySessionData, saveAnalysis } from "./analysisStore";
import { AnalyzerMode, DigestEventCollector } from "./analyzerDigest";
import { AnalyzerGateDecision, AnalyzerGateSettings, analyzerGateSettingsFrom, hasCandidateSince, shouldAutoAnalyze } from "./analyzerGates";
import { AnalyzerModels, planAnalyzerPass, runAnalyzerPass } from "./analyzerPass";
import { enrichCandidates } from "./candidateEnrichment";
import { createClaudeRunner } from "./claudeRunner";
import { SessionMeta } from "./indexer";
import { LinkScanState, scanStatsSince, summarizeAllCandidates, userPromptTextOf } from "./linkCandidates";
import { LinkStatusService } from "./linkStatusService";
import { ConcurrencyLimiter } from "./linkView";
import { resolveClaudeBinary } from "./liveSessions";
import { Registry } from "./registry";
import { SessionLinkService } from "./sessionLinks";
import { configuredStatusOptions } from "./sessionStatusView";
import { readCompleteLines, readLineEndingAt } from "./transcriptLines";
import { applyUserEdits, withSeedRemovals } from "./workstreamEdits";

const ANALYZER_CONFIG_SECTION = "overseer.analyzer";
const DEFAULT_MODEL = "haiku";
const DEFAULT_RECHECK_MODEL = "sonnet";
const MAX_CONCURRENT_PASSES = 2;
const MAX_OVERLAP_PROMPT_LINE_BYTES = 256 * 1024;
const LOG_PREFIX = "[analyzer]";

export interface AnalyzerPassOutcome {
  kind: "updated" | "skipped" | "failed";
  detail: string;
}

interface AnalyzerDependencies {
  claudeHome: string;
  registry: Registry;
  linkService: SessionLinkService;
  linkStatusService: LinkStatusService;
  findSessionMeta: (sessionId: string) => SessionMeta | undefined;
  sessionTitle: (sessionId: string) => string;
  log: vscode.OutputChannel;
}

export function readAnalyzerGateSettings(): AnalyzerGateSettings {
  const analyzerConfig = vscode.workspace.getConfiguration(ANALYZER_CONFIG_SECTION);
  return analyzerGateSettingsFrom((configKey) => analyzerConfig.get<unknown>(configKey));
}

export function readAnalyzerModels(): AnalyzerModels {
  const analyzerConfig = vscode.workspace.getConfiguration(ANALYZER_CONFIG_SECTION);
  return {
    model: analyzerConfig.get<string>("model", DEFAULT_MODEL) || DEFAULT_MODEL,
    recheckModel: analyzerConfig.get<string>("recheckModel", DEFAULT_RECHECK_MODEL) || DEFAULT_RECHECK_MODEL,
  };
}

// Runs model passes that group one session's work into workstreams and saves them to ~/.claude/overseer/analysis/.
export class SessionAnalyzer implements vscode.Disposable {
  private readonly passesInFlight = new Map<string, Promise<AnalyzerPassOutcome>>();
  private readonly limiter = new ConcurrencyLimiter(MAX_CONCURRENT_PASSES);
  private claudeBinary: Promise<string> | undefined;
  private readonly changeEmitter = new vscode.EventEmitter<string>();
  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly dependencies: AnalyzerDependencies) {}

  isAnalyzing(sessionId: string): boolean {
    return this.passesInFlight.has(sessionId);
  }

  // The saved state with the user's current edits on top, since edits can change between passes.
  async analysisFor(sessionId: string): Promise<SessionAnalysis | undefined> {
    const storedAnalysis = await this.storedAnalysis(sessionId);
    if (storedAnalysis === undefined) {
      return undefined;
    }
    return applyUserEdits(storedAnalysis, withSeedRemovals(this.dependencies.registry.workstreamEdits(sessionId), storedAnalysis.seedFacts));
  }

  // A second request for a session joins the pass already running for it.
  analyze(sessionId: string, mode: AnalyzerMode): Promise<AnalyzerPassOutcome> {
    return this.startPass(sessionId, mode, () => this.runPass(sessionId, mode));
  }

  // Checks the gates once to skip cheaply, then again under the lock, since another window's pass may have just moved lastPassAt.
  async autoAnalyze(sessionId: string): Promise<void> {
    const firstDecision = await this.gateDecision(sessionId, this.isAnalyzing(sessionId));
    if (!firstDecision.run) {
      this.logGateDecision(sessionId, firstDecision);
      return;
    }
    await this.startPass(sessionId, "auto", async () => {
      const lockedDecision = await this.gateDecision(sessionId, false);
      this.logGateDecision(sessionId, lockedDecision);
      return lockedDecision.run ? this.runPass(sessionId, "diff") : { kind: "skipped", detail: lockedDecision.reason };
    });
  }

  private startPass(sessionId: string, passLabel: string, passBody: () => Promise<AnalyzerPassOutcome>): Promise<AnalyzerPassOutcome> {
    const passInFlight = this.passesInFlight.get(sessionId);
    if (passInFlight !== undefined) {
      return passInFlight;
    }
    const passRun = this.limiter
      .run(() => this.underLock(sessionId, passBody))
      .catch((error: unknown): AnalyzerPassOutcome => ({ kind: "failed", detail: errorDetail(error) }))
      .then((outcome) => {
        this.dependencies.log.appendLine(`${LOG_PREFIX} ${passLabel} "${this.dependencies.sessionTitle(sessionId)}": ${outcome.kind}, ${outcome.detail}`);
        return outcome;
      })
      .finally(() => {
        this.passesInFlight.delete(sessionId);
        this.changeEmitter.fire(sessionId);
      });
    this.passesInFlight.set(sessionId, passRun);
    this.changeEmitter.fire(sessionId);
    return passRun;
  }

  // Two windows watch the same sessions; the lock file keeps them from running a pass on one session at once.
  private async underLock(sessionId: string, passBody: () => Promise<AnalyzerPassOutcome>): Promise<AnalyzerPassOutcome> {
    if (!isSafeSessionId(sessionId)) {
      return { kind: "skipped", detail: "not a session ID" };
    }
    const releaseLock = await tryAcquireAnalysisLock(analysisLockFile(analysisFile(this.dependencies.claudeHome, sessionId)));
    if (releaseLock === undefined) {
      return { kind: "skipped", detail: "another window is analyzing this session" };
    }
    try {
      return await passBody();
    } finally {
      await releaseLock();
    }
  }

  private async gateDecision(sessionId: string, inFlight: boolean): Promise<AnalyzerGateDecision> {
    const meta = this.dependencies.findSessionMeta(sessionId);
    if (meta === undefined) {
      return { run: false, reason: "no transcript in the index" };
    }
    const scanState = await this.dependencies.linkService.scanStateFor(meta);
    const storedAnalysis = await this.storedAnalysis(sessionId);
    if (scanState === undefined || storedAnalysis === undefined) {
      return { run: false, reason: "transcript can't be read" };
    }
    const watermarkBytes = await currentWatermarkBytes(meta.transcriptFile, storedAnalysis);
    return shouldAutoAnalyze({
      settings: readAnalyzerGateSettings(),
      stats: scanStatsSince(scanState, watermarkBytes),
      hasNewCandidate: hasCandidateSince(Object.values(scanState.candidates), watermarkBytes),
      lastPassAt: storedAnalysis.lastPassAt,
      now: Date.now(),
      inFlight,
    });
  }

  private logGateDecision(sessionId: string, decision: AnalyzerGateDecision): void {
    const verdict = decision.run ? "run" : "skip";
    this.dependencies.log.appendLine(`${LOG_PREFIX} gate "${this.dependencies.sessionTitle(sessionId)}": ${verdict}, ${decision.reason}`);
  }

  // The new session has its own transcript, so the copy starts reading it from the top.
  async copySession(fromSessionId: string, toSessionId: string): Promise<void> {
    if (!isSafeSessionId(fromSessionId) || !isSafeSessionId(toSessionId)) {
      return;
    }
    const { claudeHome, registry } = this.dependencies;
    const fromAnalysis = await loadAnalysis(analysisFile(claudeHome, fromSessionId));
    const toFile = analysisFile(claudeHome, toSessionId);
    if (fromAnalysis === undefined || (await loadAnalysis(toFile)) !== undefined) {
      return;
    }
    await saveAnalysis(toFile, { ...fromAnalysis, watermarkBytes: 0 });
    await registry.copyWorkstreamEdits(fromSessionId, toSessionId);
    this.changeEmitter.fire(toSessionId);
  }

  private async runPass(sessionId: string, mode: AnalyzerMode): Promise<AnalyzerPassOutcome> {
    const { claudeHome, linkService, linkStatusService, registry, findSessionMeta, sessionTitle } = this.dependencies;
    const meta = findSessionMeta(sessionId);
    if (meta === undefined) {
      return { kind: "skipped", detail: "no transcript in the index" };
    }
    const startedAtMs = Date.now();
    try {
      const scanState = await linkService.scanStateFor(meta);
      const storedAnalysis = await this.storedAnalysis(sessionId);
      if (scanState === undefined || storedAnalysis === undefined) {
        return { kind: "skipped", detail: "transcript can't be read" };
      }
      const watermarkBytes = await currentWatermarkBytes(meta.transcriptFile, storedAnalysis);
      if (mode === "diff" && scanStatsSince(scanState, watermarkBytes).newBytes === 0) {
        return { kind: "skipped", detail: "nothing new since the last pass" };
      }
      const currentAnalysis = { ...storedAnalysis, watermarkBytes };
      const plan = planAnalyzerPass(mode, currentAnalysis, readAnalyzerModels());
      const startOffsetBytes = plan.digestMode === "recheck" ? 0 : watermarkBytes;
      const eventCollector = new DigestEventCollector();
      let transcriptEndBytes = startOffsetBytes;
      for await (const { line, endOffsetBytes } of readCompleteLines(meta.transcriptFile, startOffsetBytes)) {
        eventCollector.addLine(line);
        transcriptEndBytes = endOffsetBytes;
      }
      const candidates = enrichCandidates(
        summarizeAllCandidates(scanState),
        linkStatusService.cachedStatuses("pr"),
        linkStatusService.cachedStatuses("ticket"),
      );
      this.claudeBinary ??= resolveClaudeBinary();
      const runClaude = createClaudeRunner(await this.claudeBinary);
      const passResult = await runAnalyzerPass(
        {
          plan,
          session: { title: sessionTitle(sessionId), gitBranch: meta.gitBranch, cwd: meta.resumeCwd ?? meta.startCwd },
          analysis: currentAnalysis,
          edits: registry.workstreamEdits(sessionId),
          candidates,
          events: eventCollector.events,
          overlapPrompt: plan.digestMode === "diff" ? await this.overlapPrompt(meta.transcriptFile, scanState, startOffsetBytes) : undefined,
          statusOptions: configuredStatusOptions(),
          transcriptEndBytes,
          now: Date.now(),
        },
        runClaude,
      );
      await saveAnalysis(analysisFile(claudeHome, sessionId), passResult.analysis);
      return { kind: "updated", detail: `${passResult.model} on a ${plan.digestMode} digest in ${Date.now() - startedAtMs}ms` };
    } catch (error) {
      this.claudeBinary = undefined;
      return { kind: "failed", detail: errorDetail(error) };
    }
  }

  // The last prompt before the diff, so a reply like "yeah do that" keeps its antecedent.
  private async overlapPrompt(transcriptFile: string, scanState: LinkScanState, startOffsetBytes: number): Promise<string | undefined> {
    const promptEndOffset = [...scanState.userPromptEndOffsets].reverse().find((endOffset) => endOffset <= startOffsetBytes);
    if (promptEndOffset === undefined) {
      return undefined;
    }
    const promptLine = await readLineEndingAt(transcriptFile, promptEndOffset, MAX_OVERLAP_PROMPT_LINE_BYTES);
    return promptLine === undefined ? undefined : userPromptTextOf(promptLine);
  }

  // The first read of a session with no current analysis file imports the old declared data; the old files stay as they are.
  private async storedAnalysis(sessionId: string): Promise<SessionAnalysis | undefined> {
    if (!isSafeSessionId(sessionId)) {
      return undefined;
    }
    const { claudeHome, registry } = this.dependencies;
    const file = analysisFile(claudeHome, sessionId);
    const savedAnalysis = await loadAnalysis(file);
    if (savedAnalysis !== undefined) {
      return savedAnalysis;
    }
    const seededAnalysis = seedAnalysis(await loadLegacySessionData(claudeHome, sessionId, registry.linkMarks(sessionId)));
    await saveAnalysis(file, seededAnalysis);
    return seededAnalysis;
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}

// A transcript shorter than the watermark was rewritten, so it is read again from the top.
async function currentWatermarkBytes(transcriptFile: string, storedAnalysis: SessionAnalysis): Promise<number> {
  const transcriptSizeBytes = (await fs.promises.stat(transcriptFile)).size;
  return storedAnalysis.watermarkBytes > transcriptSizeBytes ? 0 : storedAnalysis.watermarkBytes;
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
