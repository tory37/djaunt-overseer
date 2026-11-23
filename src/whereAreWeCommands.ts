import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { SessionMeta } from "./indexer";
import { LiveSessionMonitor } from "./liveSessions";
import { tildePath } from "./paths";
import { findSessionTerminal, sendSlashCommand } from "./terminals";
import {
  RunEndReason,
  SkippedSession,
  WhereAreWeReply,
  WhereAreWeTargets,
  briefRunDir,
  checkTarget,
  isCompleteReply,
  noTargetsMessage,
  pickTargets,
  progressMessage,
  replyBody,
  replyFile,
  unansweredReason,
  whereAreWePrompt,
  whereAreWeRunId,
  whereAreWeTimeoutMs,
} from "./whereAreWe";

export interface WhereAreWeDependencies {
  claudeHome: string;
  liveMonitor: LiveSessionMonitor;
  findSessionMeta: (sessionId: string) => SessionMeta | undefined;
  sessionTitle: (sessionId: string) => string;
  log: vscode.OutputChannel;
}

export interface CollectedReplies {
  runId: string;
  runDir: string;
  endReason: RunEndReason;
  replies: WhereAreWeReply[];
  skipped: SkippedSession[];
}

interface CollectRequest {
  runId: string;
  runDir: string;
  targets: WhereAreWeTargets;
  skipped: SkippedSession[];
  extraInstructions: string;
  timeoutMs: number;
  reportProgress: (message: string) => void;
}

interface ReplyCollection {
  done: Promise<CollectedReplies>;
  end: (reason: RunEndReason) => void;
}

interface PendingTarget {
  wasAsked: boolean;
}

const RUNNING_CONTEXT_KEY = "overseer.whereAreWeRunning";
const LOG_PREFIX = "[whereAreWe]";
const PROGRESS_TITLE = "Where are we";
const OPEN_FOLDER_ACTION = "Open Folder";

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function collectReplies(dependencies: WhereAreWeDependencies, request: CollectRequest): ReplyCollection {
  const { claudeHome, liveMonitor, findSessionMeta, sessionTitle, log } = dependencies;
  const { runId, runDir, targets, extraInstructions, timeoutMs, reportProgress } = request;
  const pendingTargets = new Map<string, PendingTarget>();
  const replies: WhereAreWeReply[] = [];
  const skipped = [...request.skipped];
  const disposables: vscode.Disposable[] = [];
  let hasEnded = false;
  let resolveDone: (collected: CollectedReplies) => void = () => undefined;
  const done = new Promise<CollectedReplies>((resolve) => {
    resolveDone = resolve;
  });

  const showProgress = (): void => reportProgress(progressMessage(replies.length, replies.length + pendingTargets.size));

  const end = (reason: RunEndReason): void => {
    if (hasEnded) {
      return;
    }
    hasEnded = true;
    disposables.forEach((disposable) => disposable.dispose());
    for (const [sessionId, pendingTarget] of pendingTargets) {
      skipped.push({ sessionId, title: sessionTitle(sessionId), reason: unansweredReason(pendingTarget.wasAsked, reason) });
    }
    pendingTargets.clear();
    log.appendLine(`${LOG_PREFIX} run ${runId} ended (${reason}): ${replies.length} replies, ${skipped.length} skipped`);
    resolveDone({ runId, runDir, endReason: reason, replies, skipped });
  };

  const endIfAllSettled = (): void => {
    if (pendingTargets.size === 0) {
      end("allAnswered");
    }
  };

  const skipTarget = (sessionId: string, reason: string): void => {
    if (hasEnded || !pendingTargets.delete(sessionId)) {
      return;
    }
    skipped.push({ sessionId, title: sessionTitle(sessionId), reason });
    log.appendLine(`${LOG_PREFIX} skipped ${sessionId}: ${reason}`);
    showProgress();
    endIfAllSettled();
  };

  const replyLocation = (sessionId: string): Pick<WhereAreWeReply, "repo" | "branch"> => {
    const meta = findSessionMeta(sessionId);
    const directory = meta?.homeRepo ?? meta?.resumeCwd ?? meta?.startCwd ?? liveMonitor.get(sessionId)?.cwd;
    return { repo: directory === undefined ? undefined : path.basename(directory), branch: meta?.gitBranch };
  };

  // Resolves to whether a complete reply was counted, so a lost target can be skipped only when it never answered.
  const readReply = async (sessionId: string): Promise<boolean> => {
    let replyText: string;
    try {
      replyText = await fs.promises.readFile(replyFile(claudeHome, runId, sessionId), "utf8");
    } catch (error) {
      if (errorCode(error) !== "ENOENT") {
        log.appendLine(`${LOG_PREFIX} can't read the reply of ${sessionId}: ${String(error)}`);
      }
      return false;
    }
    if (!isCompleteReply(replyText) || hasEnded || !pendingTargets.delete(sessionId)) {
      return false;
    }
    replies.push({ sessionId, title: sessionTitle(sessionId), ...replyLocation(sessionId), body: replyBody(replyText) });
    log.appendLine(`${LOG_PREFIX} ${sessionId} answered`);
    showProgress();
    endIfAllSettled();
    return true;
  };

  const skipUnlessAnswered = async (sessionId: string, reason: string): Promise<void> => {
    if (!(await readReply(sessionId))) {
      skipTarget(sessionId, reason);
    }
  };

  // Rechecks the status and the terminal right before typing, because input typed while Claude works is lost.
  const askOrWait = (sessionId: string): void => {
    if (hasEnded || !pendingTargets.has(sessionId)) {
      return;
    }
    const terminal = findSessionTerminal(sessionId);
    const check = checkTarget(liveMonitor.get(sessionId), terminal !== undefined);
    if (check.action === "skip") {
      skipTarget(sessionId, check.reason);
      return;
    }
    if (check.action === "wait" || terminal === undefined) {
      return;
    }
    pendingTargets.set(sessionId, { wasAsked: true });
    sendSlashCommand(terminal, whereAreWePrompt(replyFile(claudeHome, runId, sessionId), extraInstructions));
    log.appendLine(`${LOG_PREFIX} asked ${sessionId}`);
  };

  // An asked session goes busy to answer, so only its leaving counts; its reply is read again in case the watcher missed it.
  const recheckPendingTargets = (): void => {
    if (hasEnded) {
      return;
    }
    try {
      for (const [sessionId, pendingTarget] of [...pendingTargets]) {
        if (!pendingTarget.wasAsked) {
          askOrWait(sessionId);
          continue;
        }
        const check = checkTarget(liveMonitor.get(sessionId), findSessionTerminal(sessionId) !== undefined);
        if (check.action === "skip") {
          void skipUnlessAnswered(sessionId, check.reason);
        } else if (check.action === "send") {
          void readReply(sessionId);
        }
      }
    } catch (error) {
      log.appendLine(`${LOG_PREFIX} recheck failed: ${String(error)}`);
    }
  };

  const readAskedReplies = (): void => {
    for (const [sessionId, pendingTarget] of pendingTargets) {
      if (pendingTarget.wasAsked) {
        void readReply(sessionId);
      }
    }
  };

  const onRunDirChange = (changedFileName: string | Buffer | null): void => {
    if (changedFileName === null) {
      readAskedReplies();
      return;
    }
    const sessionId = path.parse(changedFileName.toString()).name;
    if (pendingTargets.get(sessionId)?.wasAsked) {
      void readReply(sessionId);
    }
  };

  // Without the watcher, replies are still read when a session goes idle, so the run goes on.
  const watchRunDir = (): void => {
    try {
      const watcher = fs.watch(runDir, (_event, changedFileName) => onRunDirChange(changedFileName));
      watcher.on("error", (error) => log.appendLine(`${LOG_PREFIX} watcher error on ${runDir}: ${String(error)}`));
      disposables.push({ dispose: () => watcher.close() });
    } catch (error) {
      log.appendLine(`${LOG_PREFIX} can't watch ${runDir}: ${String(error)}`);
    }
  };

  watchRunDir();
  const timeoutHandle = setTimeout(() => end("timeout"), timeoutMs);
  disposables.push(
    { dispose: () => clearTimeout(timeoutHandle) },
    liveMonitor.onDidChange(recheckPendingTargets),
    vscode.window.onDidCloseTerminal(recheckPendingTargets),
  );
  for (const session of [...targets.sendNow, ...targets.sendWhenIdle]) {
    pendingTargets.set(session.sessionId, { wasAsked: false });
  }
  showProgress();
  for (const sessionId of [...pendingTargets.keys()]) {
    askOrWait(sessionId);
  }
  // A reply written before the watcher saw it would otherwise wait for the next status change.
  readAskedReplies();
  return { done, end };
}

export function registerWhereAreWeCommands(dependencies: WhereAreWeDependencies): vscode.Disposable[] {
  const { claudeHome, liveMonitor, sessionTitle, log } = dependencies;
  let isRunning = false;
  let endActiveRun: ((reason: RunEndReason) => void) | undefined;

  const setRunningContext = (running: boolean): void => {
    void vscode.commands.executeCommand("setContext", RUNNING_CONTEXT_KEY, running);
  };

  const pickRunTargets = async (): Promise<{ targets: WhereAreWeTargets; skipped: SkippedSession[] }> => {
    const liveSessions = [...(await liveMonitor.refresh()).values()];
    const targets = pickTargets(liveSessions, (sessionId) => findSessionTerminal(sessionId) !== undefined);
    const skipped = targets.skipped.map((session) => ({ ...session, title: sessionTitle(session.sessionId) }));
    return { targets, skipped };
  };

  // Phase 3 replaces this with the merge.
  const showCollectedReplies = async (collected: CollectedReplies): Promise<void> => {
    const firstReply = collected.replies[0];
    if (firstReply !== undefined) {
      await vscode.window.showTextDocument(vscode.Uri.file(replyFile(claudeHome, collected.runId, firstReply.sessionId)), { preview: false });
    }
    const pickedAction = await vscode.window.showInformationMessage(
      `Where are we: ${collected.replies.length} replied, ${collected.skipped.length} skipped. Replies are in ${tildePath(collected.runDir)}.`,
      OPEN_FOLDER_ACTION,
    );
    if (pickedAction === OPEN_FOLDER_ACTION) {
      await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(collected.runDir));
    }
  };

  const runWithProgress = (request: Omit<CollectRequest, "reportProgress">): Thenable<CollectedReplies> =>
    vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: PROGRESS_TITLE, cancellable: true },
      (progress, cancellation) => {
        const collection = collectReplies(dependencies, { ...request, reportProgress: (message) => progress.report({ message }) });
        endActiveRun = collection.end;
        const cancelListener = cancellation.onCancellationRequested(() => collection.end("cancelled"));
        return collection.done.finally(() => cancelListener.dispose());
      },
    );

  const runWhereAreWe = async (): Promise<void> => {
    if (isRunning) {
      void vscode.window.showInformationMessage("Overseer: Where Are We is already running. Use Merge Now or Cancel on its notification.");
      return;
    }
    isRunning = true;
    try {
      const { targets, skipped } = await pickRunTargets();
      if (targets.sendNow.length + targets.sendWhenIdle.length === 0) {
        void vscode.window.showInformationMessage(`Overseer: ${noTargetsMessage(skipped)}`);
        return;
      }
      const runId = whereAreWeRunId(new Date());
      const runDir = briefRunDir(claudeHome, runId);
      try {
        await fs.promises.mkdir(runDir, { recursive: true });
      } catch (error) {
        log.appendLine(`${LOG_PREFIX} can't create ${runDir}: ${String(error)}`);
        void vscode.window.showErrorMessage(`Overseer: can't create ${tildePath(runDir)}. See the Overseer output.`);
        return;
      }
      const settings = vscode.workspace.getConfiguration("overseer.whereAreWe");
      setRunningContext(true);
      log.appendLine(`${LOG_PREFIX} run ${runId}: ${targets.sendNow.length} idle, ${targets.sendWhenIdle.length} busy, ${skipped.length} skipped`);
      const collected = await runWithProgress({
        runId,
        runDir,
        targets,
        skipped,
        extraInstructions: settings.get<string>("instructions") ?? "",
        timeoutMs: whereAreWeTimeoutMs(settings.get<unknown>("timeoutMinutes")),
      });
      if (collected.endReason !== "cancelled") {
        await showCollectedReplies(collected);
      }
    } catch (error) {
      log.appendLine(`${LOG_PREFIX} run failed: ${String(error)}`);
      void vscode.window.showErrorMessage("Overseer: Where Are We failed. See the Overseer output.");
    } finally {
      isRunning = false;
      endActiveRun = undefined;
      setRunningContext(false);
    }
  };

  const mergeNow = (): void => {
    if (endActiveRun === undefined) {
      void vscode.window.showInformationMessage("Overseer: no Where Are We run is waiting.");
      return;
    }
    endActiveRun("mergeNow");
  };

  return [
    vscode.commands.registerCommand("overseer.whereAreWe", runWhereAreWe),
    vscode.commands.registerCommand("overseer.whereAreWe.mergeNow", mergeNow),
    { dispose: () => endActiveRun?.("cancelled") },
  ];
}
