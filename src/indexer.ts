import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { encodeProjectDir } from "./paths";

export interface SessionMeta {
  sessionId: string;
  transcriptFile: string;
  startCwd: string;
  resumeCwd: string | undefined;
  gitBranch: string | undefined;
  firstPrompt: string | undefined;
  customTitle: string | undefined;
  agentName: string | undefined;
  aiTitle: string | undefined;
  prUrl: string | undefined;
  lastActivityMs: number;
  sizeBytes: number;
}

export interface IndexCacheEntry {
  mtimeMs: number;
  sizeBytes: number;
  meta: SessionMeta | null;
}

export type IndexCacheEntries = Record<string, IndexCacheEntry>;

export interface IndexResult {
  sessions: SessionMeta[];
  cacheEntries: IndexCacheEntries;
  scannedFileCount: number;
}

const MAX_PROMPT_LENGTH = 200;
const DEFAULT_SCAN_CONCURRENCY = 8;
const TRANSCRIPT_EXTENSION = ".jsonl";

export function displayTitle(meta: SessionMeta): string {
  return meta.customTitle ?? meta.agentName ?? meta.aiTitle ?? meta.firstPrompt ?? meta.sessionId;
}

export async function indexSessions(
  projectsRoot: string,
  previousEntries: IndexCacheEntries,
  scanConcurrency = DEFAULT_SCAN_CONCURRENCY,
): Promise<IndexResult> {
  const transcriptFiles = await listTranscriptFiles(projectsRoot);
  const cacheEntries: IndexCacheEntries = {};
  let scannedFileCount = 0;

  await forEachWithConcurrency(transcriptFiles, scanConcurrency, async (transcriptFile) => {
    const stats = await fs.promises.stat(transcriptFile).catch(() => undefined);
    if (!stats) {
      return;
    }
    const cachedEntry = previousEntries[transcriptFile];
    const isCacheFresh =
      cachedEntry !== undefined && cachedEntry.mtimeMs === stats.mtimeMs && cachedEntry.sizeBytes === stats.size;
    if (isCacheFresh) {
      cacheEntries[transcriptFile] = cachedEntry;
      return;
    }
    scannedFileCount++;
    const meta = await scanTranscript(transcriptFile, stats);
    cacheEntries[transcriptFile] = { mtimeMs: stats.mtimeMs, sizeBytes: stats.size, meta };
  });

  const sessions = Object.values(cacheEntries)
    .map((entry) => entry.meta)
    .filter((meta): meta is SessionMeta => meta !== null)
    .sort((left, right) => right.lastActivityMs - left.lastActivityMs);

  return { sessions, cacheEntries, scannedFileCount };
}

async function listTranscriptFiles(projectsRoot: string): Promise<string[]> {
  const projectDirents = await fs.promises.readdir(projectsRoot, { withFileTypes: true }).catch(() => []);
  const transcriptFiles: string[] = [];
  for (const projectDirent of projectDirents) {
    if (!projectDirent.isDirectory()) {
      continue;
    }
    const projectPath = path.join(projectsRoot, projectDirent.name);
    const fileDirents = await fs.promises.readdir(projectPath, { withFileTypes: true }).catch(() => []);
    for (const fileDirent of fileDirents) {
      if (fileDirent.isFile() && fileDirent.name.endsWith(TRANSCRIPT_EXTENSION)) {
        transcriptFiles.push(path.join(projectPath, fileDirent.name));
      }
    }
  }
  return transcriptFiles;
}

// One streaming pass per changed file; only lines carrying a field we need get JSON-parsed.
export async function scanTranscript(transcriptFile: string, stats: fs.Stats): Promise<SessionMeta | null> {
  const projectDirName = path.basename(path.dirname(transcriptFile));
  const sessionId = path.basename(transcriptFile, TRANSCRIPT_EXTENSION);
  let startCwd: string | undefined;
  let resumeCwd: string | undefined;
  let gitBranch: string | undefined;
  let firstPrompt: string | undefined;
  let customTitle: string | undefined;
  let agentName: string | undefined;
  let aiTitle: string | undefined;
  let prUrl: string | undefined;

  const lineReader = readline.createInterface({
    input: fs.createReadStream(transcriptFile, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of lineReader) {
    if (resumeCwd === undefined) {
      const lineCwd = readStringField(line, "cwd");
      if (lineCwd !== undefined) {
        startCwd ??= lineCwd;
        if (encodeProjectDir(lineCwd) === projectDirName) {
          resumeCwd = lineCwd;
        }
      }
    }
    gitBranch = readStringField(line, "gitBranch") ?? gitBranch;

    if (firstPrompt === undefined && line.includes('"type":"user"')) {
      firstPrompt = readFirstPrompt(line);
    } else if (line.includes('"type":"custom-title"')) {
      customTitle = parseRecord(line)?.customTitle ?? customTitle;
    } else if (line.includes('"type":"agent-name"')) {
      agentName = parseRecord(line)?.agentName ?? agentName;
    } else if (line.includes('"type":"ai-title"')) {
      aiTitle = parseRecord(line)?.aiTitle ?? aiTitle;
    } else if (line.includes('"type":"pr-link"')) {
      prUrl = parseRecord(line)?.prUrl ?? prUrl;
    }
  }

  if (startCwd === undefined) {
    return null;
  }
  return {
    sessionId,
    transcriptFile,
    startCwd,
    resumeCwd,
    gitBranch,
    firstPrompt,
    customTitle,
    agentName,
    aiTitle,
    prUrl,
    lastActivityMs: stats.mtimeMs,
    sizeBytes: stats.size,
  };
}

interface TranscriptRecord {
  type?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  message?: { content?: unknown };
  customTitle?: string;
  agentName?: string;
  aiTitle?: string;
  prUrl?: string;
}

function parseRecord(line: string): TranscriptRecord | undefined {
  try {
    return JSON.parse(line) as TranscriptRecord;
  } catch {
    return undefined;
  }
}

// Top-level string fields are unescaped quotes; the same key inside message text is always backslash-escaped.
function readStringField(line: string, fieldName: string): string | undefined {
  const fieldMarker = `"${fieldName}":"`;
  const valueStart = line.lastIndexOf(fieldMarker);
  if (valueStart === -1) {
    return undefined;
  }
  const contentStart = valueStart + fieldMarker.length;
  let contentEnd = contentStart;
  while (contentEnd < line.length && line[contentEnd] !== '"') {
    contentEnd += line[contentEnd] === "\\" ? 2 : 1;
  }
  try {
    return JSON.parse(line.slice(contentStart - 1, contentEnd + 1)) as string;
  } catch {
    return undefined;
  }
}

function readFirstPrompt(line: string): string | undefined {
  const record = parseRecord(line);
  if (!record || record.type !== "user" || record.isMeta || record.isSidechain) {
    return undefined;
  }
  const promptText = extractPromptText(record.message?.content);
  return promptText === undefined ? undefined : cleanPrompt(promptText);
}

function extractPromptText(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  const textBlock = content.find(
    (block): block is { type: "text"; text: string } => block?.type === "text" && typeof block.text === "string",
  );
  return textBlock?.text;
}

export function cleanPrompt(rawPrompt: string): string | undefined {
  if (rawPrompt.startsWith("<local-command")) {
    return undefined;
  }
  let promptText = rawPrompt;
  const commandName = /<command-name>([\s\S]*?)<\/command-name>/.exec(rawPrompt)?.[1];
  if (commandName !== undefined) {
    const commandArgs = /<command-args>([\s\S]*?)<\/command-args>/.exec(rawPrompt)?.[1] ?? "";
    promptText = `${commandName} ${commandArgs}`;
  }
  const withoutMarkup = promptText
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, " ")
    .replace(/<[^>]+>/g, " ");
  const collapsedPrompt = withoutMarkup.replace(/\s+/g, " ").trim();
  if (collapsedPrompt === "") {
    return undefined;
  }
  return collapsedPrompt.length > MAX_PROMPT_LENGTH
    ? collapsedPrompt.slice(0, MAX_PROMPT_LENGTH - 1) + "…"
    : collapsedPrompt;
}

async function forEachWithConcurrency<Item>(
  items: Item[],
  concurrency: number,
  worker: (item: Item) => Promise<void>,
): Promise<void> {
  let nextItemIndex = 0;
  const runWorker = async (): Promise<void> => {
    while (nextItemIndex < items.length) {
      const item = items[nextItemIndex++];
      await worker(item);
    }
  };
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, runWorker));
}
