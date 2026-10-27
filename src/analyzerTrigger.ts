import * as vscode from "vscode";
import { SessionMeta } from "./indexer";
import { LiveStatus } from "./liveParse";
import { LiveSessionMonitor } from "./liveSessions";
import { liveTransitions } from "./liveTransitions";
import { readAnalyzerGateSettings, SessionAnalyzer } from "./sessionAnalyzer";

const MS_PER_SECOND = 1000;

interface AnalyzerTriggerDependencies {
  liveMonitor: LiveSessionMonitor;
  analyzer: SessionAnalyzer;
  findSessionMeta: (sessionId: string) => SessionMeta | undefined;
  log: vscode.OutputChannel;
}

// Starts an auto pass once a session has sat idle for idleSeconds after a busy turn.
export class AnalyzerTrigger implements vscode.Disposable {
  private previousStatuses: Map<string, LiveStatus>;
  private readonly idleTimers = new Map<string, NodeJS.Timeout>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly dependencies: AnalyzerTriggerDependencies) {
    this.previousStatuses = dependencies.liveMonitor.statuses();
    this.disposables.push(
      dependencies.liveMonitor.onDidChange(() => this.applyLiveChange()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("overseer.analyzer.auto") && !readAnalyzerGateSettings().isAutoEnabled) {
          this.cancelAllTimers();
        }
      }),
    );
  }

  private applyLiveChange(): void {
    const currentStatuses = this.dependencies.liveMonitor.statuses();
    const { becameIdle, leftIdle } = liveTransitions(this.previousStatuses, currentStatuses);
    this.previousStatuses = currentStatuses;
    leftIdle.forEach((sessionId) => this.cancelTimer(sessionId));
    const settings = readAnalyzerGateSettings();
    if (!settings.isAutoEnabled) {
      return;
    }
    for (const sessionId of becameIdle) {
      if (this.dependencies.findSessionMeta(sessionId) === undefined) {
        continue;
      }
      this.cancelTimer(sessionId);
      this.idleTimers.set(
        sessionId,
        setTimeout(() => this.fire(sessionId), settings.idleSeconds * MS_PER_SECOND),
      );
    }
  }

  private fire(sessionId: string): void {
    this.idleTimers.delete(sessionId);
    this.dependencies.analyzer
      .autoAnalyze(sessionId)
      .catch((error: unknown) => this.dependencies.log.appendLine(`[analyzer] auto pass for ${sessionId} failed: ${String(error)}`));
  }

  private cancelTimer(sessionId: string): void {
    clearTimeout(this.idleTimers.get(sessionId));
    this.idleTimers.delete(sessionId);
  }

  private cancelAllTimers(): void {
    [...this.idleTimers.keys()].forEach((sessionId) => this.cancelTimer(sessionId));
  }

  dispose(): void {
    this.cancelAllTimers();
    vscode.Disposable.from(...this.disposables).dispose();
  }
}
