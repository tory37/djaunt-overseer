import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { commitHashesIn, printedCommitsIn } from "./gitStatus";
import { readStringField } from "./indexer";
import { readCompleteLines } from "./transcriptLines";
import { extractTicketKey, findTicketKeysInText, isTicketKey } from "./ticket";

export type LinkKind = "pr" | "ticket" | "artifact" | "commit";

export type LinkSignal =
  | "pr-link-record"
  | "pr-created"
  | "pr-write"
  | "pr-read"
  | "ticket-write"
  | "ticket-read"
  | "artifact-published"
  | "artifact-read"
  | "commit-created"
  | "branch"
  | "user-mention"
  | "mention";

export type LinkRole = "owned" | "touched" | "mentioned";

export interface LinkCandidate {
  kind: LinkKind;
  id: string;
  url: string | undefined;
  title: string | undefined;
  signals: Partial<Record<LinkSignal, number>>;
  snippets: string[];
  firstSeen: string | undefined;
  lastSeen: string | undefined;
  firstSeenOffsetBytes?: number;
  lastSeenOffsetBytes?: number;
  promptBeforeFirstSeen?: string;
  promptBeforeLastSeen?: string;
  description?: string;
  filePath?: string;
  repo?: string;
  branch?: string;
  directory?: string;
  fullHash?: string;
}

type PendingToolSignal = "pr-created" | "pr-write" | "pr-read" | "artifact-published" | "artifact-read";

interface ArtifactDetails {
  title?: string;
  description?: string;
  filePath?: string;
}

interface PendingToolCall extends ArtifactDetails {
  signal: PendingToolSignal;
  artifactId?: string;
}

interface PendingGitCall {
  directory: string | undefined;
  commitSubjects: string[];
}

export interface UserPrompt {
  text: string;
  endOffsetBytes: number;
}

export interface LinkScanState {
  candidates: Record<string, LinkCandidate>;
  pendingToolCalls: Record<string, PendingToolCall>;
  pendingGitCalls: Record<string, PendingGitCall>;
  htmlTitlesByPath: Record<string, string>;
  gitBranch: string | undefined;
  jiraSite: string | undefined;
  cwd: string | undefined;
  scannedBytes: number;
  latestPrompt: UserPrompt | undefined;
  // Ascending, so counting the prompts after an offset walks back only over the new ones.
  userPromptEndOffsets: number[];
}

export interface TranscriptScanStats {
  scannedBytes: number;
  userPromptCount: number;
  newBytes: number;
  newUserPromptCount: number;
}

export interface LinkScanCacheEntry {
  offsetBytes: number;
  mtimeMs: number;
  state: LinkScanState;
}

const MAX_SNIPPETS_PER_CANDIDATE = 3;
const SNIPPET_CONTEXT_CHARS = 80;
const MAX_SNIPPET_LENGTH = 200;
const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 300;
const MAX_PROMPT_LENGTH = 300;
const HTML_TITLE_READ_BYTES = 64 * 1024;
const FULL_HASH_LENGTH = 40;

const PR_URL_PATTERN = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g;
const ARTIFACT_URL_PATTERN = /https:\/\/claude\.ai\/(?:code\/)?artifact\/([A-Za-z0-9-]+)/g;
const JIRA_BROWSE_URL_PATTERN = /https:\/\/([\w-]+\.atlassian\.net)\/browse\/([A-Z][A-Z0-9]+-\d+)/g;
const GH_PR_COMMAND_PATTERN = /\bgh pr (\w+)([^\n;&|]*)/g;
const GH_REPO_FLAG_PATTERN = /(?:-R|--repo)[ =]([\w.-]+\/[\w.-]+)/;
const GH_TITLE_FLAG_PATTERN = /(?:-t|--title)[ =]"((?:[^"\\]|\\.)*)"/;
const GH_PR_NUMBER_ARG_PATTERN = /(?:^|\s)(\d+)(?=\s|$)/;
const JIRA_TOOL_PATTERN = /^mcp__.*(?:jira|atlassian)/i;
const JIRA_WRITE_VERB_PATTERN = /^(?:add|edit|update|transition|create|link|unlink|delete|assign|upload|move|convert|set)/i;
const SYSTEM_REMINDER_PATTERN = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const HTML_TITLE_PATTERN = /<title[^>]*>([\s\S]*?)<\/title>/i;
const HTML_FILE_PATTERN = /\.html?$/i;
const COMMAND_NAME_PATTERN = /<command-name>([^<]*)<\/command-name>/;
const COMMAND_ARGS_PATTERN = /<command-args>([\s\S]*?)<\/command-args>/;
const GIT_DIRECTORY_FLAG_PATTERN = /\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/;
const GIT_COMMIT_MESSAGE_PATTERN = /\bgit\b[^\n;&|]*?\bcommit\b[^\n;&|]*?\s-[a-z]*m\s*"((?:[^"\\]|\\.)*)"/g;
const HEREDOC_START_PATTERN = /^\$\(cat <<.*\n/;
const ONELINE_COMMIT_PATTERN = /^([0-9a-f]{7,40}) (.+)$/;
const LEADING_CD_PATTERN = /^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*(?:&&|;)/;
// Claude Code writes these as user records, but the user did not type them.
const NON_PROMPT_PREFIXES = [
  "<local-command-stdout>",
  "<local-command-stderr>",
  "<task-notification>",
  "<bash-input>",
  "<bash-stdout>",
  "<bash-stderr>",
  "[Request interrupted",
];

const GH_VERB_SIGNALS: Record<string, PendingToolSignal> = {
  create: "pr-created",
  edit: "pr-write",
  comment: "pr-write",
  review: "pr-write",
  merge: "pr-write",
  close: "pr-write",
  ready: "pr-write",
  reopen: "pr-write",
  view: "pr-read",
  checks: "pr-read",
  diff: "pr-read",
};

// Stronger signals win when one tool call touches a PR several ways.
const PENDING_SIGNAL_RANK: Record<PendingToolSignal, number> = {
  "pr-created": 3,
  "pr-write": 2,
  "pr-read": 1,
  "artifact-published": 2,
  "artifact-read": 1,
};

const ISSUE_KEY_FIELDS = new Set(["issue_keys", "issue_key", "issueIdOrKey", "source_issue", "target_issue", "key"]);
const ISSUE_KEY_LIST_FIELDS = new Set(["comments", "issues", "links", "transitions", "conversions"]);

export interface ArtifactUrlParts {
  id: string;
  url: string;
}

// Uses the scanner's own pattern, so a declared artifact and a scanned one share a link id.
export function artifactUrlParts(rawUrl: string): ArtifactUrlParts | undefined {
  const match = rawUrl.trim().matchAll(ARTIFACT_URL_PATTERN).next().value;
  return match === undefined ? undefined : { id: match[1], url: match[0] };
}

export function artifactUrlsIn(text: string): string[] {
  return [...new Set([...text.matchAll(ARTIFACT_URL_PATTERN)].map((match) => match[0]))];
}

export function createLinkScanState(): LinkScanState {
  return {
    candidates: {},
    pendingToolCalls: {},
    pendingGitCalls: {},
    htmlTitlesByPath: {},
    gitBranch: undefined,
    jiraSite: undefined,
    cwd: undefined,
    scannedBytes: 0,
    latestPrompt: undefined,
    userPromptEndOffsets: [],
  };
}

// The offset defaults to one newline-terminated line after the last one, which matches a transcript scanned from 0.
export function scanLinkLine(
  state: LinkScanState,
  line: string,
  lineEndOffsetBytes = state.scannedBytes + Buffer.byteLength(line, "utf8") + 1,
): void {
  state.scannedBytes = lineEndOffsetBytes;
  state.gitBranch = readStringField(line, "gitBranch") ?? state.gitBranch;
  state.cwd = readStringField(line, "cwd") ?? state.cwd;
  const timestamp = readStringField(line, "timestamp");

  if (line.includes('"type":"pr-link"')) {
    const prUrl = parseRecord(line)?.prUrl;
    if (typeof prUrl === "string") {
      for (const match of prUrl.matchAll(PR_URL_PATTERN)) {
        recordPr(state, match, "pr-link-record", timestamp);
      }
    }
    return;
  }
  // Compaction summaries and meta records (skill bodies, command output) are not the user's words or the session's work.
  const isInjectedRecord = line.includes('"isCompactSummary":true') || line.includes('"isMeta":true');
  if (isInjectedRecord) {
    return;
  }

  const isToolLine = line.includes('"tool_use"') || line.includes('"tool_result"');
  if (isToolLine) {
    scanToolLine(state, line, timestamp);
  }
  if (isUserPromptLine(line)) {
    scanUserPrompt(state, line, timestamp);
    return;
  }
  scanMentions(state, line, "mention", timestamp);
}

export function summarizeAllCandidates(state: LinkScanState): LinkCandidate[] {
  const candidates = Object.values(state.candidates).map((candidate) => ({ ...candidate }));
  const branchTicketKey = extractTicketKey({ gitBranch: state.gitBranch });
  if (branchTicketKey !== undefined) {
    const branchTicket =
      candidates.find((candidate) => candidate.kind === "ticket" && candidate.id === branchTicketKey) ??
      newCandidate("ticket", branchTicketKey, undefined);
    branchTicket.signals = { ...branchTicket.signals, branch: 1 };
    if (!candidates.includes(branchTicket)) {
      candidates.push(branchTicket);
    }
  }
  for (const candidate of candidates) {
    if (candidate.kind === "ticket" && candidate.url === undefined && state.jiraSite !== undefined) {
      candidate.url = `https://${state.jiraSite}/browse/${candidate.id}`;
    }
  }
  return candidates.sort((left, right) => roleRank(fallbackRole(right)) - roleRank(fallbackRole(left)));
}

// The strongest role the transcript signals prove.
export function fallbackRole(candidate: LinkCandidate): LinkRole {
  const { signals } = candidate;
  if (signals["pr-created"] || signals["artifact-published"] || signals["commit-created"] || signals.branch) {
    return "owned";
  }
  // Claude Code also writes pr-link records for PRs a session only read, so they prove involvement, not ownership.
  if (signals["pr-link-record"] || signals["pr-write"] || signals["ticket-write"] || signals["user-mention"]) {
    return "touched";
  }
  return "mentioned";
}

// Seen only in passing, in tool output or assistant text, with no action on it.
export function isPassiveMention(candidate: LinkCandidate): boolean {
  return Object.keys(candidate.signals).every((signal) => signal === "mention");
}

function roleRank(role: LinkRole): number {
  return role === "owned" ? 2 : role === "touched" ? 1 : 0;
}

export function scanStatsSince(state: LinkScanState, sinceOffsetBytes: number): TranscriptScanStats {
  const promptEndOffsets = state.userPromptEndOffsets;
  let newUserPromptCount = 0;
  while (
    newUserPromptCount < promptEndOffsets.length &&
    promptEndOffsets[promptEndOffsets.length - 1 - newUserPromptCount] > sinceOffsetBytes
  ) {
    newUserPromptCount++;
  }
  return {
    scannedBytes: state.scannedBytes,
    userPromptCount: promptEndOffsets.length,
    newBytes: Math.max(0, state.scannedBytes - sinceOffsetBytes),
    newUserPromptCount,
  };
}

// Reads only newline-terminated lines after the cached offset, so a transcript mid-write is picked up next time.
export async function scanTranscriptLinks(
  transcriptFile: string,
  previousEntry: LinkScanCacheEntry | undefined,
): Promise<LinkScanCacheEntry | undefined> {
  const stats = await fs.promises.stat(transcriptFile).catch(() => undefined);
  if (!stats) {
    return undefined;
  }
  const canResume = previousEntry !== undefined && previousEntry.offsetBytes <= stats.size;
  if (canResume && previousEntry.mtimeMs === stats.mtimeMs) {
    return previousEntry;
  }
  const state: LinkScanState = canResume ? structuredClone(previousEntry.state) : createLinkScanState();
  let offsetBytes = canResume ? previousEntry.offsetBytes : 0;
  for await (const { line, endOffsetBytes } of readCompleteLines(transcriptFile, offsetBytes)) {
    scanLinkLine(state, line, endOffsetBytes);
    offsetBytes = endOffsetBytes;
  }
  await titleArtifactsFromFiles(state);
  return { offsetBytes, mtimeMs: stats.mtimeMs, state };
}

// Scratchpad files vanish, so an unreadable file is skipped and tried again on the next scan.
async function titleArtifactsFromFiles(state: LinkScanState): Promise<void> {
  for (const candidate of Object.values(state.candidates)) {
    const isUntitledHtmlArtifact =
      candidate.kind === "artifact" && candidate.title === undefined && HTML_FILE_PATTERN.test(candidate.filePath ?? "");
    if (!isUntitledHtmlArtifact || candidate.filePath === undefined) {
      continue;
    }
    const fileTitle = htmlTitleIn(await readFileHead(candidate.filePath, HTML_TITLE_READ_BYTES));
    if (fileTitle !== undefined) {
      candidate.title = fileTitle;
    }
  }
}

async function readFileHead(file: string, maxBytes: number): Promise<string> {
  let fileHandle: fs.promises.FileHandle | undefined;
  try {
    fileHandle = await fs.promises.open(file, "r");
    const headBuffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await fileHandle.read(headBuffer, 0, maxBytes, 0);
    return headBuffer.subarray(0, bytesRead).toString("utf8");
  } catch {
    return "";
  } finally {
    await fileHandle?.close().catch(() => undefined);
  }
}

interface ToolBlock {
  type?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
}

function scanToolLine(state: LinkScanState, line: string, timestamp: string | undefined): void {
  const content = parseRecord(line)?.message?.content;
  if (!Array.isArray(content)) {
    return;
  }
  for (const block of content as ToolBlock[]) {
    if (block?.type === "tool_use" && typeof block.name === "string") {
      scanToolUse(state, block, timestamp);
    } else if (block?.type === "tool_result" && typeof block.tool_use_id === "string") {
      scanToolResult(state, block, timestamp);
      scanGitResult(state, block, line, timestamp);
    }
  }
}

function scanToolUse(state: LinkScanState, block: ToolBlock, timestamp: string | undefined): void {
  const toolName = block.name ?? "";
  const input = block.input ?? {};
  if (toolName === "Bash" && typeof input.command === "string") {
    scanGhCommand(state, block.id, input.command, timestamp);
    noteGitCommand(state, block.id, input.command);
  } else if (toolName === "Write") {
    noteWrittenHtmlTitle(state, input);
  } else if (JIRA_TOOL_PATTERN.test(toolName)) {
    scanJiraToolUse(state, toolName, input, timestamp);
  } else if (toolName === "Artifact") {
    scanArtifactToolUse(state, block.id, input, timestamp);
  }
}

function scanGhCommand(
  state: LinkScanState,
  toolUseId: string | undefined,
  command: string,
  timestamp: string | undefined,
): void {
  let strongestSignal: PendingToolSignal | undefined;
  let createdTitle: string | undefined;
  for (const match of command.matchAll(GH_PR_COMMAND_PATTERN)) {
    const signal = GH_VERB_SIGNALS[match[1]];
    if (signal === undefined) {
      continue;
    }
    if (strongestSignal === undefined || PENDING_SIGNAL_RANK[signal] > PENDING_SIGNAL_RANK[strongestSignal]) {
      strongestSignal = signal;
    }
    const commandArgs = match[2];
    const snippet = clip(`gh pr ${match[1]}${commandArgs}`);
    const title = signal === "pr-created" ? GH_TITLE_FLAG_PATTERN.exec(commandArgs)?.[1] : undefined;
    createdTitle ??= title;
    for (const urlMatch of commandArgs.matchAll(PR_URL_PATTERN)) {
      recordPr(state, urlMatch, signal, timestamp, snippet, title);
    }
    const repo = GH_REPO_FLAG_PATTERN.exec(commandArgs)?.[1];
    const prNumber = GH_PR_NUMBER_ARG_PATTERN.exec(commandArgs.replace(GH_REPO_FLAG_PATTERN, ""))?.[1];
    if (repo !== undefined && prNumber !== undefined) {
      const [owner, repoName] = repo.split("/");
      recordPrParts(state, owner, repoName, prNumber, signal, timestamp, snippet, title);
    }
  }
  if (toolUseId !== undefined && strongestSignal !== undefined) {
    state.pendingToolCalls[toolUseId] = { signal: strongestSignal, title: createdTitle };
  }
}

function scanJiraToolUse(
  state: LinkScanState,
  toolName: string,
  input: Record<string, unknown>,
  timestamp: string | undefined,
): void {
  const cloudId = input.cloudId;
  if (typeof cloudId === "string" && cloudId.includes(".atlassian.net")) {
    state.jiraSite = cloudId.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
  const toolShortName = toolName.split("__").pop() ?? toolName;
  const action = typeof input.action === "string" ? input.action : undefined;
  const signal = JIRA_WRITE_VERB_PATTERN.test(action ?? toolShortName) ? "ticket-write" : "ticket-read";
  const snippet = action === undefined ? toolShortName : `${toolShortName} ${action}`;
  for (const ticketKey of collectIssueKeys(input)) {
    recordCandidate(state, "ticket", ticketKey, undefined, signal, timestamp, snippet);
  }
}

function scanArtifactToolUse(
  state: LinkScanState,
  toolUseId: string | undefined,
  input: Record<string, unknown>,
  timestamp: string | undefined,
): void {
  const action = typeof input.action === "string" ? input.action : "publish";
  const signal: PendingToolSignal | undefined =
    action === "publish" ? "artifact-published" : action === "read" ? "artifact-read" : undefined;
  if (signal === undefined || input.asset === true) {
    return;
  }
  const details = signal === "artifact-published" ? artifactDetailsFromInput(state, input) : {};
  let artifactId: string | undefined;
  if (typeof input.url === "string") {
    for (const match of input.url.matchAll(ARTIFACT_URL_PATTERN)) {
      artifactId ??= match[1];
      const artifact = recordCandidate(state, "artifact", match[1], match[0], signal, timestamp);
      applyArtifactDetails(artifact, details);
    }
  }
  // A read result holds the page HTML, whose <title> names an artifact this session did not publish.
  const needsResult = input.url === undefined || signal === "artifact-read";
  if (toolUseId !== undefined && needsResult) {
    state.pendingToolCalls[toolUseId] = { signal, artifactId, ...details };
  }
}

function artifactDetailsFromInput(state: LinkScanState, input: Record<string, unknown>): ArtifactDetails {
  const filePath = nonEmptyString(input.file_path);
  const inputTitle = nonEmptyString(input.title);
  const writtenTitle = filePath === undefined ? undefined : state.htmlTitlesByPath[filePath];
  return { title: inputTitle ?? writtenTitle, description: nonEmptyString(input.description), filePath };
}

function applyArtifactDetails(artifact: LinkCandidate, details: ArtifactDetails): void {
  if (details.title !== undefined && artifact.title === undefined) {
    artifact.title = clip(details.title, MAX_TITLE_LENGTH);
  }
  if (details.description !== undefined) {
    artifact.description = clip(details.description, MAX_DESCRIPTION_LENGTH);
  }
  artifact.filePath = details.filePath ?? artifact.filePath;
}

function noteWrittenHtmlTitle(state: LinkScanState, input: Record<string, unknown>): void {
  const filePath = nonEmptyString(input.file_path);
  if (filePath === undefined || !HTML_FILE_PATTERN.test(filePath) || typeof input.content !== "string") {
    return;
  }
  const writtenTitle = htmlTitleIn(input.content);
  if (writtenTitle !== undefined) {
    state.htmlTitlesByPath[filePath] = writtenTitle;
  }
}

function htmlTitleIn(html: string): string | undefined {
  const rawTitle = HTML_TITLE_PATTERN.exec(html)?.[1];
  const title = rawTitle === undefined ? "" : clip(rawTitle, MAX_TITLE_LENGTH);
  return title === "" ? undefined : title;
}

function noteGitCommand(state: LinkScanState, toolUseId: string | undefined, command: string): void {
  if (toolUseId === undefined || !command.includes("git ")) {
    return;
  }
  const namedDirectory = GIT_DIRECTORY_FLAG_PATTERN.exec(command)?.[1] ?? LEADING_CD_PATTERN.exec(command)?.[1];
  state.pendingGitCalls[toolUseId] = {
    directory: resolveDirectory(state.cwd, namedDirectory),
    commitSubjects: commitSubjectsIn(command),
  };
}

function commitSubjectsIn(command: string): string[] {
  return [...command.matchAll(GIT_COMMIT_MESSAGE_PATTERN)].flatMap((match) => {
    const message = match[1].replace(/\\"/g, '"').replace(HEREDOC_START_PATTERN, "");
    const subject = message.split("\n").find((messageLine) => messageLine.trim() !== "")?.trim();
    return subject === undefined ? [] : [subject];
  });
}

// `git commit -q` prints nothing, so a quiet commit is found only when a `git log --oneline` in the same call shows its subject.
function onelineCommitsFor(resultText: string, commitSubjects: string[]): { shortHash: string; subject: string }[] {
  if (commitSubjects.length === 0) {
    return [];
  }
  return resultText.split("\n").flatMap((resultLine) => {
    const onelineMatch = ONELINE_COMMIT_PATTERN.exec(resultLine.trim());
    const isOwnCommit = onelineMatch !== null && commitSubjects.includes(onelineMatch[2].trim());
    return isOwnCommit ? [{ shortHash: onelineMatch[1], subject: onelineMatch[2].trim() }] : [];
  });
}

function resolveDirectory(cwd: string | undefined, namedDirectory: string | undefined): string | undefined {
  if (namedDirectory === undefined) {
    return cwd;
  }
  const unquotedDirectory = namedDirectory.replace(/^["']|["']$/g, "").replace(/^~(?=\/|$)/, os.homedir());
  if (path.isAbsolute(unquotedDirectory) || cwd === undefined) {
    return unquotedDirectory;
  }
  return path.resolve(cwd, unquotedDirectory);
}

// Claude Code records the commit sha on the result line itself, outside the block, so the raw line is searched too.
function scanGitResult(state: LinkScanState, block: ToolBlock, line: string, timestamp: string | undefined): void {
  const toolUseId = block.tool_use_id ?? "";
  const gitCall = state.pendingGitCalls[toolUseId];
  if (gitCall === undefined) {
    return;
  }
  delete state.pendingGitCalls[toolUseId];
  const resultText = toolResultText(block.content);
  for (const printedCommit of printedCommitsIn(resultText)) {
    recordCommit(state, printedCommit.shortHash, timestamp, gitCall.directory, printedCommit.branch, printedCommit.subject);
  }
  for (const onelineCommit of onelineCommitsFor(resultText, gitCall.commitSubjects)) {
    recordCommit(state, onelineCommit.shortHash, timestamp, gitCall.directory, undefined, onelineCommit.subject);
  }
  for (const commitHash of commitHashesIn(line)) {
    recordCommit(state, commitHash, timestamp, gitCall.directory);
  }
}

// git prints a short hash and Claude Code may record a longer one; both name the same commit.
function recordCommit(
  state: LinkScanState,
  commitHash: string,
  timestamp: string | undefined,
  directory: string | undefined,
  branch?: string,
  subject?: string,
): void {
  const knownCommit = Object.values(state.candidates).find(
    (candidate) => candidate.kind === "commit" && (candidate.id.startsWith(commitHash) || commitHash.startsWith(candidate.id)),
  );
  const commitId = knownCommit !== undefined && knownCommit.id.length < commitHash.length ? knownCommit.id : commitHash;
  if (knownCommit !== undefined && knownCommit.id !== commitId) {
    delete state.candidates[linkKey(knownCommit)];
    knownCommit.id = commitId;
    state.candidates[linkKey(knownCommit)] = knownCommit;
  }
  const isAlreadyCounted = knownCommit?.lastSeenOffsetBytes === state.scannedBytes;
  const commit = isAlreadyCounted ? knownCommit : recordCandidate(state, "commit", commitId, undefined, "commit-created", timestamp);
  if (subject !== undefined && subject !== "") {
    commit.title ??= clip(subject, MAX_TITLE_LENGTH);
  }
  if (commitHash.length === FULL_HASH_LENGTH) {
    commit.fullHash = commitHash;
  }
  commit.branch ??= branch;
  commit.directory ??= directory;
}

function scanToolResult(state: LinkScanState, block: ToolBlock, timestamp: string | undefined): void {
  const toolUseId = block.tool_use_id ?? "";
  const pendingCall = state.pendingToolCalls[toolUseId];
  if (pendingCall === undefined) {
    return;
  }
  delete state.pendingToolCalls[toolUseId];
  const pendingSignal = pendingCall.signal;
  const resultText = toolResultText(block.content);
  if (pendingCall.artifactId !== undefined) {
    const readArtifact = state.candidates[`artifact:${pendingCall.artifactId}`];
    const pageTitle = htmlTitleIn(resultText);
    if (readArtifact !== undefined && readArtifact.title === undefined && pageTitle !== undefined) {
      readArtifact.title = pageTitle;
    }
    return;
  }
  if (pendingSignal.startsWith("artifact")) {
    // A publish result names the new URL first; later URLs are just references in the page.
    const firstArtifactUrl = resultText.matchAll(ARTIFACT_URL_PATTERN).next().value;
    if (firstArtifactUrl !== undefined) {
      const artifact = recordCandidate(state, "artifact", firstArtifactUrl[1], firstArtifactUrl[0], pendingSignal, timestamp);
      applyArtifactDetails(artifact, pendingCall);
    }
    return;
  }
  for (const match of resultText.matchAll(PR_URL_PATTERN)) {
    recordPr(state, match, pendingSignal, timestamp, undefined, pendingCall.title);
  }
}

function scanUserPrompt(state: LinkScanState, line: string, timestamp: string | undefined): void {
  const promptText = extractPromptText(parseRecord(line)?.message?.content);
  if (promptText === undefined) {
    return;
  }
  const typedText = promptText.replace(SYSTEM_REMINDER_PATTERN, " ");
  const intentText = userIntentText(typedText);
  if (intentText !== undefined) {
    state.latestPrompt = { text: clip(intentText, MAX_PROMPT_LENGTH), endOffsetBytes: state.scannedBytes };
    state.userPromptEndOffsets.push(state.scannedBytes);
  }
  scanMentions(state, typedText, "user-mention", timestamp);
  for (const ticketKey of findTicketKeysInText(typedText)) {
    recordCandidate(state, "ticket", ticketKey, undefined, "user-mention", timestamp, snippetAround(typedText, ticketKey));
  }
}

// The words the user typed on a prompt line, without injected reminders; undefined for any other line.
export function userPromptTextOf(line: string): string | undefined {
  const isInjectedRecord = line.includes('"isCompactSummary":true') || line.includes('"isMeta":true');
  if (isInjectedRecord || !isUserPromptLine(line)) {
    return undefined;
  }
  const promptText = extractPromptText(parseRecord(line)?.message?.content);
  return promptText === undefined ? undefined : userIntentText(promptText.replace(SYSTEM_REMINDER_PATTERN, " "));
}

// Slash commands count only with arguments: "/clear" alone says nothing about the work.
function userIntentText(typedText: string): string | undefined {
  const trimmedText = typedText.trim();
  if (trimmedText === "" || NON_PROMPT_PREFIXES.some((prefix) => trimmedText.startsWith(prefix))) {
    return undefined;
  }
  const commandName = COMMAND_NAME_PATTERN.exec(trimmedText)?.[1]?.trim();
  if (commandName === undefined) {
    return trimmedText;
  }
  const commandArgs = COMMAND_ARGS_PATTERN.exec(trimmedText)?.[1]?.trim() ?? "";
  return commandArgs === "" ? undefined : `${commandName} ${commandArgs}`;
}

function scanMentions(state: LinkScanState, text: string, signal: LinkSignal, timestamp: string | undefined): void {
  for (const match of text.matchAll(PR_URL_PATTERN)) {
    recordPr(state, match, signal, timestamp, snippetAround(text, match[0], match.index));
  }
  for (const match of text.matchAll(ARTIFACT_URL_PATTERN)) {
    recordCandidate(state, "artifact", match[1], match[0], signal, timestamp, snippetAround(text, match[0], match.index));
  }
  for (const match of text.matchAll(JIRA_BROWSE_URL_PATTERN)) {
    state.jiraSite ??= match[1];
    recordCandidate(state, "ticket", match[2], match[0], signal, timestamp, snippetAround(text, match[0], match.index));
  }
}

function recordPr(
  state: LinkScanState,
  match: RegExpMatchArray,
  signal: LinkSignal,
  timestamp: string | undefined,
  snippet?: string,
  title?: string,
): void {
  recordPrParts(state, match[1], match[2], match[3], signal, timestamp, snippet, title);
}

function recordPrParts(
  state: LinkScanState,
  owner: string,
  repoName: string,
  prNumber: string,
  signal: LinkSignal,
  timestamp: string | undefined,
  snippet?: string,
  title?: string,
): void {
  const prId = `${owner}/${repoName}/pull/${prNumber}`.toLowerCase();
  const prUrl = `https://github.com/${owner}/${repoName}/pull/${prNumber}`;
  const pr = recordCandidate(state, "pr", prId, prUrl, signal, timestamp, snippet, title);
  pr.repo ??= `${owner}/${repoName}`;
}

function recordCandidate(
  state: LinkScanState,
  kind: LinkKind,
  id: string,
  url: string | undefined,
  signal: LinkSignal,
  timestamp: string | undefined,
  snippet?: string,
  title?: string,
): LinkCandidate {
  const candidateKey = `${kind}:${id}`;
  const candidate = (state.candidates[candidateKey] ??= newCandidate(kind, id, url));
  candidate.url ??= url;
  candidate.signals[signal] = (candidate.signals[signal] ?? 0) + 1;
  if (title !== undefined && candidate.title === undefined) {
    candidate.title = clip(title.replace(/\\"/g, '"'), MAX_TITLE_LENGTH);
  }
  if (snippet !== undefined && candidate.snippets.length < MAX_SNIPPETS_PER_CANDIDATE && !candidate.snippets.includes(snippet)) {
    candidate.snippets.push(snippet);
  }
  if (timestamp !== undefined) {
    candidate.firstSeen ??= timestamp;
    candidate.lastSeen = timestamp;
  }
  if (candidate.firstSeenOffsetBytes === undefined) {
    candidate.firstSeenOffsetBytes = state.scannedBytes;
    candidate.promptBeforeFirstSeen = state.latestPrompt?.text;
  }
  candidate.lastSeenOffsetBytes = state.scannedBytes;
  candidate.promptBeforeLastSeen = state.latestPrompt?.text;
  return candidate;
}

export function linkKey(candidate: Pick<LinkCandidate, "kind" | "id">): string {
  return `${candidate.kind}:${candidate.id}`;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function newCandidate(kind: LinkKind, id: string, url: string | undefined): LinkCandidate {
  return { kind, id, url, title: undefined, signals: {}, snippets: [], firstSeen: undefined, lastSeen: undefined };
}

function collectIssueKeys(value: unknown, fieldName?: string): string[] {
  if (typeof value === "string") {
    return fieldName !== undefined && ISSUE_KEY_FIELDS.has(fieldName) && isTicketKey(value) ? [value] : [];
  }
  if (Array.isArray(value)) {
    // Transitions arrive as [key, status] tuples; only the first slot is a key.
    if (fieldName === "transitions" && value.every(Array.isArray)) {
      return value.flatMap((tuple: unknown[]) => collectIssueKeys(tuple[0], "key"));
    }
    return value.flatMap((item) => collectIssueKeys(item, fieldName));
  }
  if (value !== null && typeof value === "object") {
    const isTopLevel = fieldName === undefined;
    if (!isTopLevel && !ISSUE_KEY_LIST_FIELDS.has(fieldName)) {
      return [];
    }
    return Object.entries(value).flatMap(([childField, childValue]) =>
      ISSUE_KEY_FIELDS.has(childField) || ISSUE_KEY_LIST_FIELDS.has(childField)
        ? collectIssueKeys(childValue, childField)
        : [],
    );
  }
  return [];
}

function isUserPromptLine(line: string): boolean {
  return line.includes('"type":"user"') && !line.includes('"tool_result"');
}

function extractPromptText(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  const textParts = content
    .filter((block): block is { type: "text"; text: string } => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text);
  return textParts.length > 0 ? textParts.join("\n") : undefined;
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("\n");
}

function snippetAround(text: string, needle: string, knownIndex?: number): string {
  const needleIndex = knownIndex ?? text.indexOf(needle);
  const windowStart = Math.max(0, needleIndex - SNIPPET_CONTEXT_CHARS);
  const windowEnd = Math.min(text.length, needleIndex + needle.length + SNIPPET_CONTEXT_CHARS);
  const rawWindow = text.slice(windowStart, windowEnd);
  return clip(rawWindow.replace(/\\[nrt]/g, " ").replace(/\\"/g, '"'));
}

function clip(text: string, maxLength = MAX_SNIPPET_LENGTH): string {
  const collapsedText = text.replace(/\s+/g, " ").trim();
  return collapsedText.length > maxLength ? collapsedText.slice(0, maxLength - 1) + "…" : collapsedText;
}

interface LinkRecord {
  prUrl?: unknown;
  message?: { content?: unknown };
}

function parseRecord(line: string): LinkRecord | undefined {
  try {
    return JSON.parse(line) as LinkRecord;
  } catch {
    return undefined;
  }
}
