import * as fs from "fs";
import * as path from "path";
import { projectsDir } from "./paths";

export interface SessionFiles {
  sessionId: string;
  paths: string[];
  sizeBytes: number;
}

export interface DeletionResult {
  deletedIds: string[];
  failures: Array<{ sessionId: string; error: string }>;
  removedHistoryLineCount: number;
}

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PER_SESSION_DIRECTORIES = ["file-history", "session-env"];
const PROMPT_HISTORY_FILE = "history.jsonl";
const MAX_HISTORY_REWRITE_ATTEMPTS = 3;

export function isSessionId(candidate: string): boolean {
  return SESSION_ID_PATTERN.test(candidate);
}

function isInside(parentDir: string, candidatePath: string): boolean {
  const relativePath = path.relative(parentDir, candidatePath);
  return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

async function pathSize(targetPath: string): Promise<number> {
  const stats = await fs.promises.lstat(targetPath).catch(() => undefined);
  if (stats === undefined) {
    return 0;
  }
  if (!stats.isDirectory()) {
    return stats.size;
  }
  const entries = await fs.promises.readdir(targetPath).catch(() => []);
  const entrySizes = await Promise.all(entries.map((entry) => pathSize(path.join(targetPath, entry))));
  return entrySizes.reduce((total, entrySize) => total + entrySize, 0);
}

// Only paths named by the session id, inside the Claude home, are ever returned.
export async function findSessionFiles(claudeHome: string, sessionId: string, transcriptFile: string): Promise<SessionFiles> {
  if (!isSessionId(sessionId) || !isInside(projectsDir(claudeHome), transcriptFile)) {
    return { sessionId, paths: [], sizeBytes: 0 };
  }
  const candidatePaths = [
    transcriptFile,
    path.join(path.dirname(transcriptFile), sessionId),
    ...PER_SESSION_DIRECTORIES.map((directory) => path.join(claudeHome, directory, sessionId)),
  ];
  const existingPaths: string[] = [];
  let sizeBytes = 0;
  for (const candidatePath of candidatePaths) {
    if (fs.existsSync(candidatePath)) {
      existingPaths.push(candidatePath);
      sizeBytes += await pathSize(candidatePath);
    }
  }
  return { sessionId, paths: existingPaths, sizeBytes };
}

export function withoutSessionLines(historyText: string, sessionIds: Set<string>): { text: string; removedLineCount: number } {
  const keptLines: string[] = [];
  let removedLineCount = 0;
  for (const line of historyText.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    let lineSessionId: unknown;
    try {
      lineSessionId = (JSON.parse(line) as { sessionId?: unknown }).sessionId;
    } catch {
      lineSessionId = undefined;
    }
    if (typeof lineSessionId === "string" && sessionIds.has(lineSessionId)) {
      removedLineCount++;
      continue;
    }
    keptLines.push(line);
  }
  return { text: keptLines.length === 0 ? "" : `${keptLines.join("\n")}\n`, removedLineCount };
}

// Running Claude processes append to this file, so the rewrite retries when the file grows between read and swap.
async function removePromptHistory(claudeHome: string, sessionIds: Set<string>): Promise<number> {
  const historyFile = path.join(claudeHome, PROMPT_HISTORY_FILE);
  for (let attempt = 0; attempt < MAX_HISTORY_REWRITE_ATTEMPTS; attempt++) {
    const originalText = await fs.promises.readFile(historyFile, "utf8").catch(() => undefined);
    if (originalText === undefined) {
      return 0;
    }
    const filtered = withoutSessionLines(originalText, sessionIds);
    if (filtered.removedLineCount === 0) {
      return 0;
    }
    const temporaryFile = `${historyFile}.overseer-${process.pid}.tmp`;
    await fs.promises.writeFile(temporaryFile, filtered.text, "utf8");
    const currentSize = (await fs.promises.stat(historyFile)).size;
    if (currentSize !== Buffer.byteLength(originalText, "utf8")) {
      await fs.promises.rm(temporaryFile, { force: true });
      continue;
    }
    await fs.promises.rename(temporaryFile, historyFile);
    return filtered.removedLineCount;
  }
  return 0;
}

export async function deleteSessionFiles(claudeHome: string, sessionFiles: SessionFiles[]): Promise<DeletionResult> {
  const deletedIds: string[] = [];
  const failures: DeletionResult["failures"] = [];
  for (const files of sessionFiles) {
    try {
      for (const sessionPath of files.paths) {
        await fs.promises.rm(sessionPath, { recursive: true, force: true });
      }
      deletedIds.push(files.sessionId);
    } catch (error) {
      failures.push({ sessionId: files.sessionId, error: String(error) });
    }
  }
  const removedHistoryLineCount = await removePromptHistory(claudeHome, new Set(deletedIds)).catch(() => 0);
  return { deletedIds, failures, removedHistoryLineCount };
}
