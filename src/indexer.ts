import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { createGitRootResolver, GitRootResolver } from "./gitRoots";
import { commitHashesIn } from "./gitStatus";
import { encodeProjectDir, isTemporaryPath } from "./paths";

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
  lastPrompt: string | undefined;
  recap: SessionRecap | undefined;
  homeRepo: string | undefined;
  otherReposTouched: string[];
  commitHashes: string[];
  lastActivityMs: number;
  sizeBytes: number;
}

// Claude Code writes a short recap when the user returns to an idle session.
export interface SessionRecap {
  text: string;
  writtenAtMs: number;
  isStale: boolean;
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
const FILE_EDIT_TOOL_PATTERN = /"name":"(?:Write|Edit|MultiEdit|NotebookEdit)"/;
const FILE_EDIT_TOOL_NAMES = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const RECAP_SETTINGS_HINT_PATTERN = /\s*\(disable recaps in \/config\)\s*$/;

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
  const resolveGitRoot = createGitRootResolver();
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
    const meta = await scanTranscript(transcriptFile, stats, resolveGitRoot);
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
export async function scanTranscript(
  transcriptFile: string,
  stats: fs.Stats,
  resolveGitRoot: GitRootResolver,
): Promise<SessionMeta | null> {
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
  let lastPromptText: string | undefined;
  let recap: Omit<SessionRecap, "isStale"> | undefined;
  let promptAtRecap: string | undefined;
  const touchedDirectories = new Set<string>();
  const commitHashes = new Set<string>();

  const lineReader = readline.createInterface({
    input: fs.createReadStream(transcriptFile, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of lineReader) {
    const lineCwd = readStringField(line, "cwd");
    if (lineCwd !== undefined) {
      touchedDirectories.add(lineCwd);
      startCwd ??= lineCwd;
      if (resumeCwd === undefined && encodeProjectDir(lineCwd) === projectDirName) {
        resumeCwd = lineCwd;
      }
    }
    if (FILE_EDIT_TOOL_PATTERN.test(line)) {
      for (const editedFile of readEditedFiles(line)) {
        touchedDirectories.add(path.dirname(editedFile));
      }
    }
    gitBranch = readStringField(line, "gitBranch") ?? gitBranch;
    if (line.includes("tool_result")) {
      for (const commitHash of commitHashesIn(line)) {
        commitHashes.add(commitHash);
      }
    }

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
    } else if (line.includes('"type":"last-prompt"')) {
      lastPromptText = parseRecord(line)?.lastPrompt ?? lastPromptText;
    } else if (line.includes('"subtype":"away_summary"')) {
      recap = readRecap(line) ?? recap;
      promptAtRecap = lastPromptText;
    }
  }

  if (startCwd === undefined) {
    return null;
  }
  const sessionCwd = resumeCwd ?? startCwd;
  const homeRepo = await resolveGitRoot(sessionCwd);
  // Scratch clones in temp dirs are throwaway reference copies, not repos the session worked in.
  const keepsTemporaryRepos = isTemporaryPath(sessionCwd);
  const touchedRepos = await Promise.all([...touchedDirectories].map(resolveGitRoot));
  const otherReposTouched = [...new Set(touchedRepos)]
    .filter((repo): repo is string => repo !== undefined && repo !== homeRepo)
    .filter((repo) => keepsTemporaryRepos || !isTemporaryPath(repo))
    .sort();
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
    lastPrompt: lastPromptText === undefined ? undefined : cleanPrompt(lastPromptText),
    // last-prompt records carry no timestamp, so a new prompt text is the only sign of work after the recap.
    recap: recap === undefined ? undefined : { ...recap, isStale: lastPromptText !== promptAtRecap },
    homeRepo,
    otherReposTouched,
    commitHashes: [...commitHashes],
    lastActivityMs: stats.mtimeMs,
    sizeBytes: stats.size,
  };
}

interface TranscriptRecord {
  type?: string;
  subtype?: string;
  content?: unknown;
  timestamp?: string;
  lastPrompt?: string;
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
export function readStringField(line: string, fieldName: string): string | undefined {
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

function readRecap(line: string): Omit<SessionRecap, "isStale"> | undefined {
  const record = parseRecord(line);
  if (record?.type !== "system" || record.subtype !== "away_summary" || typeof record.content !== "string") {
    return undefined;
  }
  const recapText = record.content.replace(RECAP_SETTINGS_HINT_PATTERN, "").trim();
  const writtenAtMs = Date.parse(record.timestamp ?? "");
  if (recapText === "" || Number.isNaN(writtenAtMs)) {
    return undefined;
  }
  return { text: recapText, writtenAtMs };
}

function readEditedFiles(line: string): string[] {
  const content = parseRecord(line)?.message?.content;
  if (!Array.isArray(content)) {
    return [];
  }
  const editedFiles: string[] = [];
  for (const block of content) {
    if (block?.type !== "tool_use" || !FILE_EDIT_TOOL_NAMES.has(block.name)) {
      continue;
    }
    const editedFile: unknown = block.input?.file_path ?? block.input?.notebook_path;
    if (typeof editedFile === "string" && path.isAbsolute(editedFile)) {
      editedFiles.push(editedFile);
    }
  }
  return editedFiles;
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
