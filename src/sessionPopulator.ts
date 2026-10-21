import * as vscode from "vscode";
import {
  AGENT_TICKETS_SCHEMA_VERSION,
  declaredTicketsFile,
  DeclaredTicket,
  isSafeSessionId,
  readDeclaredTickets,
  userTicketMarksFromLinkMarks,
  withDeclaredTicket,
} from "./agentTickets";
import {
  AGENT_WORK_SCHEMA_VERSION,
  declaredWorkFile,
  readSessionWork,
  SessionWork,
  withDeclaredCommit,
  withDeclaredPullRequest,
} from "./agentWork";
import { DeclarationMonitor } from "./declarationMonitor";
import { displayTitle, SessionMeta } from "./indexer";
import { loadVersionedCache, saveVersionedCache } from "./linkCache";
import { createClaudeRunner } from "./linkJudge";
import { ConcurrencyLimiter } from "./linkView";
import { resolveClaudeBinary } from "./liveSessions";
import { buildPopulateDigest, PopulatedItem, populateArgs, parsePopulateOutput, PopulateResult } from "./populateDigest";
import { Registry } from "./registry";
import { readTranscriptTail } from "./sessionSummary";

const POPULATE_MODEL = "haiku";
const MAX_CONCURRENT_POPULATES = 2;

// Reads a digest of a session's transcript with Haiku and declares what it worked on, for sessions that never tracked it.
export class SessionPopulator implements vscode.Disposable {
  private readonly populatesInFlight = new Map<string, Promise<void>>();
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

  populate(meta: SessionMeta): Promise<void> {
    const inFlightPopulate = this.populatesInFlight.get(meta.sessionId);
    if (inFlightPopulate !== undefined) {
      return inFlightPopulate;
    }
    const populateRun = this.limiter
      .run(() => this.runPopulate(meta))
      .finally(() => {
        this.populatesInFlight.delete(meta.sessionId);
        this.changeEmitter.fire();
      });
    this.populatesInFlight.set(meta.sessionId, populateRun);
    this.changeEmitter.fire();
    return populateRun;
  }

  private async runPopulate(meta: SessionMeta): Promise<void> {
    if (!isSafeSessionId(meta.sessionId)) {
      return;
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
      );
      this.claudeBinary ??= resolveClaudeBinary();
      const runClaude = createClaudeRunner(await this.claudeBinary);
      const populateResult = parsePopulateOutput(await runClaude(populateArgs(POPULATE_MODEL), digestText));
      await this.saveTickets(meta.sessionId, populateResult.tickets.filter((ticket) => !removedTicketKeys.includes(ticket.id)));
      await this.saveWork(meta.sessionId, populateResult);
      this.declarationMonitor.rescan();
      this.log.appendLine(`Populated "${displayTitle(meta)}" in ${Date.now() - startedAtMs}ms`);
    } catch (error) {
      this.claudeBinary = undefined;
      this.log.appendLine(`Populate failed for "${displayTitle(meta)}": ${String(error)}`);
      void vscode.window.showWarningMessage(`Overseer couldn't populate "${displayTitle(meta)}". See the Overseer output.`);
    }
  }

  // Entries the agent already declared keep their own notes.
  private async saveTickets(sessionId: string, tickets: PopulatedItem[]): Promise<void> {
    const ticketsFile = declaredTicketsFile(this.claudeHome, sessionId);
    const savedTickets = readDeclaredTickets(await loadVersionedCache<unknown>(ticketsFile, AGENT_TICKETS_SCHEMA_VERSION));
    const now = Date.now();
    let updatedTickets: DeclaredTicket[] = savedTickets;
    for (const ticket of tickets) {
      if (!updatedTickets.some(({ key }) => key === ticket.id)) {
        updatedTickets = withDeclaredTicket(updatedTickets, ticket.id, ticket.note, now);
      }
    }
    await saveVersionedCache(ticketsFile, updatedTickets, AGENT_TICKETS_SCHEMA_VERSION);
  }

  private async saveWork(sessionId: string, populateResult: PopulateResult): Promise<void> {
    const workFile = declaredWorkFile(this.claudeHome, sessionId);
    const savedWork = readSessionWork(await loadVersionedCache<unknown>(workFile, AGENT_WORK_SCHEMA_VERSION));
    const now = Date.now();
    let updatedWork: SessionWork = { ...savedWork, populatedAt: now };
    for (const commit of populateResult.commits) {
      if (!updatedWork.commits.some(({ hash }) => hash === commit.id)) {
        updatedWork = withDeclaredCommit(updatedWork, commit.id, commit.note, now);
      }
    }
    for (const pullRequest of populateResult.pullRequests) {
      if (!updatedWork.pullRequests.some(({ url }) => url === pullRequest.id)) {
        updatedWork = withDeclaredPullRequest(updatedWork, pullRequest.id, pullRequest.note, now);
      }
    }
    await saveVersionedCache(workFile, updatedWork, AGENT_WORK_SCHEMA_VERSION);
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}
