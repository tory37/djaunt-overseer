import { randomUUID } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { SessionMeta } from "./indexer";
import { createClaudeRunner } from "./claudeRunner";
import { LiveSessionMonitor, resolveClaudeBinary } from "./liveSessions";
import { tildePath } from "./paths";
import { Registry, UserGroup, userGroupRef } from "./registry";
import { findSessionTerminal, sendSlashCommand, startNewSession } from "./terminals";
import { startAskChannel } from "./whereAreWeAsks";
import {
  COORDINATOR_GROUP_NAME,
  COORDINATOR_SYSTEM_PROMPT,
  DEFAULT_MERGE_MODEL,
  MERGE_TIMEOUT_MS,
  MergeOutcome,
  RunEndReason,
  SkippedSession,
  WhereAreWeReply,
  WhereAreWeTargets,
  briefFile,
  briefReadyMessage,
  briefRunDir,
  briefsDir,
  buildBrief,
  buildMergeInput,
  checkTarget,
  combineInstructions,
  coordinatorPrompt,
  discussPrompt,
  discussSessionName,
  isCompleteReply,
  latestBriefRunId,
  mergeArgs,
  noRepliesMessage,
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
  registry: Registry;
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
const DISCUSS_ACTION = "Discuss";
const MERGE_PROGRESS_TITLE = "Where are we: writing the brief…";
const RUN_PROMPT_TEXT = "Anything to add for every session? Optional.";
const RUN_PROMPT_PLACEHOLDER = "anything waiting on Rodrigo to review?";

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
  const askOrWait = async (sessionId: string): Promise<void> => {
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
    await sendSlashCommand(terminal, whereAreWePrompt(replyFile(claudeHome, runId, sessionId), extraInstructions));
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
          void askOrWait(sessionId);
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
    void askOrWait(sessionId);
  }
  // A reply written before the watcher saw it would otherwise wait for the next status change.
  readAskedReplies();
  return { done, end };
}

export function registerWhereAreWeCommands(dependencies: WhereAreWeDependencies): vscode.Disposable[] {
  const { claudeHome, registry, liveMonitor, sessionTitle, log } = dependencies;
  let isRunning = false;
  let endActiveRun: ((reason: RunEndReason) => void) | undefined;
  const askChannels = new Set<vscode.Disposable>();

  const setRunningContext = (running: boolean): void => {
    void vscode.commands.executeCommand("setContext", RUNNING_CONTEXT_KEY, running);
  };

  const pickRunTargets = async (): Promise<{ targets: WhereAreWeTargets; skipped: SkippedSession[] }> => {
    const liveSessions = [...(await liveMonitor.refresh()).values()];
    const targets = pickTargets(liveSessions, (sessionId) => findSessionTerminal(sessionId) !== undefined);
    const skipped = targets.skipped.map((session) => ({ ...session, title: sessionTitle(session.sessionId) }));
    return { targets, skipped };
  };

  const runMerge = async (collected: CollectedReplies, model: string): Promise<MergeOutcome> => {
    try {
      const runClaude = createClaudeRunner(await resolveClaudeBinary(), { timeoutMs: MERGE_TIMEOUT_MS });
      return { stdout: await runClaude(mergeArgs(model), buildMergeInput(collected.replies, collected.skipped)) };
    } catch (error) {
      return { error: String(error) };
    }
  };

  const mergeAndShowBrief = async (collected: CollectedReplies, model: string): Promise<void> => {
    if (collected.replies.length === 0) {
      void vscode.window.showInformationMessage(`Overseer: ${noRepliesMessage(collected.skipped)}`);
      return;
    }
    const startedAtMs = Date.now();
    const mergeOutcome = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: MERGE_PROGRESS_TITLE },
      () => runMerge(collected, model),
    );
    const brief = buildBrief(mergeOutcome, collected.replies, collected.skipped, collected.runId);
    const briefPath = briefFile(claudeHome, collected.runId);
    await fs.promises.writeFile(briefPath, brief.text, "utf8");
    if (brief.mergeError === undefined) {
      log.appendLine(`${LOG_PREFIX} merged run ${collected.runId} with ${model} in ${Date.now() - startedAtMs}ms`);
    } else {
      log.appendLine(`${LOG_PREFIX} merge failed for run ${collected.runId}: ${brief.mergeError}`);
      void vscode.window.showWarningMessage(`Overseer: the Where Are We merge failed, so the brief holds the raw replies. ${brief.mergeError}`);
    }
    await vscode.window.showTextDocument(vscode.Uri.file(briefPath), { preview: false });
    void offerDiscuss(collected);
  };

  // Not awaited by the run, so an unanswered notification doesn't keep the run marked as running.
  const offerDiscuss = async (collected: CollectedReplies): Promise<void> => {
    const pickedAction = await vscode.window.showInformationMessage(
      briefReadyMessage(collected.replies.length, collected.skipped.length),
      DISCUSS_ACTION,
    );
    if (pickedAction === DISCUSS_ACTION) {
      await discussBrief(collected.runId);
    }
  };

  // No repo applies to a brief across sessions, so the session starts in the home folder.
  const discussBrief = async (runId: string): Promise<void> => {
    const sessionId = randomUUID();
    const cwd = os.homedir();
    const sessionName = discussSessionName(runId);
    await registry.addPendingSession(sessionId, { cwd, createdAtMs: Date.now() });
    await registry.setLabel(sessionId, sessionName);
    await registry.pin(sessionId);
    startNewSession(sessionId, sessionName, cwd, log, discussPrompt(briefFile(claudeHome, runId), briefRunDir(claudeHome, runId)));
  };

  const coordinatorGroup = async (): Promise<UserGroup> =>
    registry.userGroupsInActiveWorkspace().find((group) => group.name === COORDINATOR_GROUP_NAME) ??
    (await registry.createGroup(COORDINATOR_GROUP_NAME, randomUUID()));

  // The ask channel is optional: without it the coordinator still reads the replies, so its failure is only logged.
  const openAskChannel = async (runDir: string, coordinatorTerminal: vscode.Terminal): Promise<void> => {
    try {
      askChannels.add(await startAskChannel({ runDir, coordinatorTerminal, liveMonitor, log }));
    } catch (error) {
      log.appendLine(`${LOG_PREFIX} can't open the ask channel for ${runDir}: ${String(error)}`);
    }
  };

  // Resolves to whether the coordinator started, so a failed launch falls back to the headless merge.
  // No repo applies to a run across sessions, so the coordinator starts in the home folder.
  const launchCoordinator = async (
    runId: string,
    runDir: string,
    runPrompt: string,
    targets: WhereAreWeTargets,
    skipped: SkippedSession[],
  ): Promise<boolean> => {
    let coordinatorTerminal: vscode.Terminal;
    try {
      const sessionId = randomUUID();
      const cwd = os.homedir();
      const sessionName = discussSessionName(runId);
      const roster = [...targets.sendNow, ...targets.sendWhenIdle].map((session) => ({
        sessionId: session.sessionId,
        title: sessionTitle(session.sessionId),
        replyPath: replyFile(claudeHome, runId, session.sessionId),
      }));
      await registry.addPendingSession(sessionId, { cwd, createdAtMs: Date.now() });
      await registry.setLabel(sessionId, sessionName);
      await registry.pin(sessionId);
      await registry.assign([sessionId], userGroupRef((await coordinatorGroup()).id));
      const firstPrompt = coordinatorPrompt(runPrompt, runDir, roster, skipped);
      coordinatorTerminal = startNewSession(sessionId, sessionName, cwd, log, firstPrompt, COORDINATOR_SYSTEM_PROMPT);
      log.appendLine(`${LOG_PREFIX} run ${runId}: coordinator ${sessionId} started`);
    } catch (error) {
      log.appendLine(`${LOG_PREFIX} can't start the coordinator for run ${runId}: ${String(error)}`);
      return false;
    }
    await openAskChannel(runDir, coordinatorTerminal);
    return true;
  };

  const discussLatestBrief = async (): Promise<void> => {
    let briefFileNames: string[];
    try {
      briefFileNames = await fs.promises.readdir(briefsDir(claudeHome));
    } catch (error) {
      if (errorCode(error) !== "ENOENT") {
        log.appendLine(`${LOG_PREFIX} can't list ${briefsDir(claudeHome)}: ${String(error)}`);
      }
      briefFileNames = [];
    }
    const runId = latestBriefRunId(briefFileNames);
    if (runId === undefined) {
      void vscode.window.showInformationMessage("Overseer: no Where Are We brief yet. Run Where Are We first.");
      return;
    }
    await discussBrief(runId);
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
      const runPrompt = await vscode.window.showInputBox({
        prompt: RUN_PROMPT_TEXT,
        placeHolder: RUN_PROMPT_PLACEHOLDER,
        ignoreFocusOut: true,
      });
      if (runPrompt === undefined) {
        return;
      }
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
      const isCoordinatorRunning = await launchCoordinator(runId, runDir, runPrompt, targets, skipped);
      setRunningContext(true);
      log.appendLine(`${LOG_PREFIX} run ${runId}: ${targets.sendNow.length} idle, ${targets.sendWhenIdle.length} busy, ${skipped.length} skipped`);
      const collected = await runWithProgress({
        runId,
        runDir,
        targets,
        skipped,
        extraInstructions: combineInstructions(settings.get<string>("instructions") ?? "", runPrompt),
        timeoutMs: whereAreWeTimeoutMs(settings.get<unknown>("timeoutMinutes")),
      });
      if (collected.endReason !== "cancelled" && !isCoordinatorRunning) {
        await mergeAndShowBrief(collected, settings.get<string>("model", DEFAULT_MERGE_MODEL) || DEFAULT_MERGE_MODEL);
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
    vscode.commands.registerCommand("overseer.whereAreWe.discuss", discussLatestBrief),
    { dispose: () => endActiveRun?.("cancelled") },
    { dispose: () => askChannels.forEach((askChannel) => askChannel.dispose()) },
  ];
}
