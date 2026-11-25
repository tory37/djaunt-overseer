import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { LiveSessionMonitor } from "./liveSessions";
import { findSessionTerminal, sendSlashCommand } from "./terminals";
import {
  AskFile,
  askReplyFile,
  asksDir,
  checkTarget,
  followUpPrompt,
  isCompleteReply,
  parseAskFileName,
  unreachableReply,
} from "./whereAreWe";

export interface AskChannelRequest {
  runDir: string;
  coordinatorTerminal: vscode.Terminal;
  liveMonitor: LiveSessionMonitor;
  log: vscode.OutputChannel;
}

interface QueuedAsk extends AskFile {
  question: string;
}

interface SentAsk {
  replyPath: string;
  sentAtMs: number;
}

const LOG_PREFIX = "[whereAreWe]";
const ASK_READ_ATTEMPTS = 5;
const ASK_READ_RETRY_MS = 300;
// A session that never writes its reply would otherwise block every later ask to it.
const SENT_ASK_WAIT_CAP_MS = 5 * 60_000;

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startAskChannel(request: AskChannelRequest): Promise<vscode.Disposable> {
  const { runDir, coordinatorTerminal, liveMonitor, log } = request;
  const askFolder = asksDir(runDir);
  await fs.promises.mkdir(askFolder, { recursive: true });

  const acceptedFileNames = new Set<string>();
  const readingFileNames = new Set<string>();
  const queuedAsks: QueuedAsk[] = [];
  const sentAsksBySessionId = new Map<string, SentAsk>();
  const disposables: vscode.Disposable[] = [];
  let isDisposed = false;
  let isDelivering = false;
  let needsAnotherPass = false;

  const readFileText = async (filePath: string): Promise<string | undefined> => {
    try {
      return await fs.promises.readFile(filePath, "utf8");
    } catch (error) {
      if (errorCode(error) !== "ENOENT") {
        log.appendLine(`${LOG_PREFIX} can't read ${filePath}: ${String(error)}`);
      }
      return undefined;
    }
  };

  // The coordinator may still be writing the question, so an empty file is read again after a pause.
  const readQuestion = async (filePath: string): Promise<string | undefined> => {
    for (let attempt = 1; attempt <= ASK_READ_ATTEMPTS; attempt++) {
      const questionText = await readFileText(filePath);
      if (questionText === undefined) {
        return undefined;
      }
      if (questionText.trim() !== "") {
        return questionText.trim();
      }
      await delay(ASK_READ_RETRY_MS);
    }
    return undefined;
  };

  const isAwaitingReply = async (sessionId: string): Promise<boolean> => {
    const sentAsk = sentAsksBySessionId.get(sessionId);
    if (sentAsk === undefined) {
      return false;
    }
    const replyText = await readFileText(sentAsk.replyPath);
    const isAnswered = replyText !== undefined && isCompleteReply(replyText);
    if (isAnswered || Date.now() - sentAsk.sentAtMs > SENT_ASK_WAIT_CAP_MS) {
      sentAsksBySessionId.delete(sessionId);
      return false;
    }
    return true;
  };

  const answerUnreachable = async (ask: QueuedAsk, reason: string): Promise<void> => {
    try {
      await fs.promises.writeFile(askReplyFile(runDir, ask.sessionId, ask.askNumber), unreachableReply(ask.sessionId, reason), "utf8");
      log.appendLine(`${LOG_PREFIX} ask ${ask.sessionId}-${ask.askNumber} not delivered: ${reason}`);
    } catch (error) {
      log.appendLine(`${LOG_PREFIX} can't write the unreachable reply for ${ask.sessionId}-${ask.askNumber}: ${String(error)}`);
    }
  };

  // Rechecks the status and the terminal right before typing, because input typed while Claude works is lost.
  const deliverOnePass = async (): Promise<void> => {
    queuedAsks.sort((first, second) => first.askNumber - second.askNumber);
    for (const ask of [...queuedAsks]) {
      if (isDisposed) {
        return;
      }
      if (await isAwaitingReply(ask.sessionId)) {
        continue;
      }
      const terminal = findSessionTerminal(ask.sessionId);
      const check = checkTarget(liveMonitor.get(ask.sessionId), terminal !== undefined);
      if (check.action === "skip") {
        queuedAsks.splice(queuedAsks.indexOf(ask), 1);
        await answerUnreachable(ask, check.reason);
        continue;
      }
      if (check.action === "wait" || terminal === undefined) {
        continue;
      }
      queuedAsks.splice(queuedAsks.indexOf(ask), 1);
      const replyPath = askReplyFile(runDir, ask.sessionId, ask.askNumber);
      sentAsksBySessionId.set(ask.sessionId, { replyPath, sentAtMs: Date.now() });
      await sendSlashCommand(terminal, followUpPrompt(ask.question, replyPath));
      log.appendLine(`${LOG_PREFIX} asked ${ask.sessionId} follow-up ${ask.askNumber}`);
    }
  };

  const deliverQueuedAsks = async (): Promise<void> => {
    if (isDisposed) {
      return;
    }
    if (isDelivering) {
      needsAnotherPass = true;
      return;
    }
    isDelivering = true;
    try {
      do {
        needsAnotherPass = false;
        await deliverOnePass();
      } while (needsAnotherPass && !isDisposed);
    } catch (error) {
      log.appendLine(`${LOG_PREFIX} ask delivery failed: ${String(error)}`);
    } finally {
      isDelivering = false;
    }
  };

  const acceptAskFile = async (fileName: string): Promise<void> => {
    const askFile = parseAskFileName(fileName);
    if (askFile === undefined || acceptedFileNames.has(fileName) || readingFileNames.has(fileName)) {
      return;
    }
    readingFileNames.add(fileName);
    try {
      const question = await readQuestion(path.join(askFolder, fileName));
      if (question === undefined || isDisposed) {
        return;
      }
      acceptedFileNames.add(fileName);
      queuedAsks.push({ ...askFile, question });
      log.appendLine(`${LOG_PREFIX} queued ask ${fileName}`);
    } finally {
      readingFileNames.delete(fileName);
    }
  };

  const scanAskFolder = async (): Promise<void> => {
    let fileNames: string[];
    try {
      fileNames = await fs.promises.readdir(askFolder);
    } catch (error) {
      log.appendLine(`${LOG_PREFIX} can't list ${askFolder}: ${String(error)}`);
      return;
    }
    await Promise.all(fileNames.map(acceptAskFile));
  };

  // A reply file landing also triggers a pass, because it frees its session for the next ask.
  const onAskFolderChange = async (changedFileName: string | Buffer | null): Promise<void> => {
    if (changedFileName === null) {
      await scanAskFolder();
    } else {
      await acceptAskFile(changedFileName.toString());
    }
    await deliverQueuedAsks();
  };

  const dispose = (): void => {
    if (isDisposed) {
      return;
    }
    isDisposed = true;
    disposables.forEach((disposable) => disposable.dispose());
    log.appendLine(`${LOG_PREFIX} stopped the ask channel for ${runDir}`);
  };

  try {
    const watcher = fs.watch(askFolder, (_event, changedFileName) => void onAskFolderChange(changedFileName));
    watcher.on("error", (error) => log.appendLine(`${LOG_PREFIX} watcher error on ${askFolder}: ${String(error)}`));
    disposables.push({ dispose: () => watcher.close() });
  } catch (error) {
    log.appendLine(`${LOG_PREFIX} can't watch ${askFolder}: ${String(error)}`);
    throw error;
  }
  disposables.push(
    liveMonitor.onDidChange(() => void deliverQueuedAsks()),
    vscode.window.onDidCloseTerminal((closedTerminal) => {
      if (closedTerminal === coordinatorTerminal) {
        dispose();
      } else {
        void deliverQueuedAsks();
      }
    }),
  );
  log.appendLine(`${LOG_PREFIX} watching ${askFolder} for asks`);
  return { dispose };
}
