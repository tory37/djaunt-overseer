import * as fs from "fs";
import { readStringField } from "./indexer";
import { extractTicketKey, findTicketKeysInText, isTicketKey } from "./ticket";

export type LinkKind = "pr" | "ticket" | "artifact";

export type LinkSignal =
  | "pr-link-record"
  | "pr-created"
  | "pr-write"
  | "pr-read"
  | "ticket-write"
  | "ticket-read"
  | "artifact-published"
  | "artifact-read"
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
}

type PendingToolSignal = "pr-created" | "pr-write" | "pr-read" | "artifact-published" | "artifact-read";

interface PendingToolCall {
  signal: PendingToolSignal;
  title?: string;
}

export interface LinkScanState {
  candidates: Record<string, LinkCandidate>;
  pendingToolCalls: Record<string, PendingToolCall>;
  gitBranch: string | undefined;
  jiraSite: string | undefined;
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
const NEWLINE_BYTE = 0x0a;

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

export function createLinkScanState(): LinkScanState {
  return { candidates: {}, pendingToolCalls: {}, gitBranch: undefined, jiraSite: undefined };
}

export function scanLinkLine(state: LinkScanState, line: string): void {
  state.gitBranch = readStringField(line, "gitBranch") ?? state.gitBranch;
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

export function summarizeCandidates(state: LinkScanState): LinkCandidate[] {
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

// Used when the judge agent is unavailable or returns nothing usable.
export function fallbackRole(candidate: LinkCandidate): LinkRole {
  const { signals } = candidate;
  if (signals["pr-created"] || signals["artifact-published"] || signals.branch) {
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
    scanLinkLine(state, line);
    offsetBytes = endOffsetBytes;
  }
  return { offsetBytes, mtimeMs: stats.mtimeMs, state };
}

async function* readCompleteLines(
  file: string,
  startOffsetBytes: number,
): AsyncGenerator<{ line: string; endOffsetBytes: number }> {
  let partialLineChunks: Buffer[] = [];
  let chunkStartOffsetBytes = startOffsetBytes;
  for await (const chunk of fs.createReadStream(file, { start: startOffsetBytes })) {
    const chunkBuffer = chunk as Buffer;
    let sliceStart = 0;
    let newlineIndex = chunkBuffer.indexOf(NEWLINE_BYTE, sliceStart);
    while (newlineIndex !== -1) {
      partialLineChunks.push(chunkBuffer.subarray(sliceStart, newlineIndex));
      const lineBuffer = Buffer.concat(partialLineChunks);
      const endOffsetBytes = chunkStartOffsetBytes + newlineIndex + 1;
      partialLineChunks = [];
      if (lineBuffer.length > 0) {
        yield { line: lineBuffer.toString("utf8"), endOffsetBytes };
      }
      sliceStart = newlineIndex + 1;
      newlineIndex = chunkBuffer.indexOf(NEWLINE_BYTE, sliceStart);
    }
    partialLineChunks.push(chunkBuffer.subarray(sliceStart));
    chunkStartOffsetBytes += chunkBuffer.length;
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
    }
  }
}

function scanToolUse(state: LinkScanState, block: ToolBlock, timestamp: string | undefined): void {
  const toolName = block.name ?? "";
  const input = block.input ?? {};
  if (toolName === "Bash" && typeof input.command === "string") {
    scanGhCommand(state, block.id, input.command, timestamp);
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
  if (signal === undefined) {
    return;
  }
  if (typeof input.url === "string") {
    for (const match of input.url.matchAll(ARTIFACT_URL_PATTERN)) {
      recordCandidate(state, "artifact", match[1], match[0], signal, timestamp);
    }
  }
  if (toolUseId !== undefined && input.url === undefined) {
    state.pendingToolCalls[toolUseId] = { signal };
  }
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
  if (pendingSignal.startsWith("artifact")) {
    // A publish result names the new URL first; later URLs are just references in the page.
    const firstArtifactUrl = resultText.matchAll(ARTIFACT_URL_PATTERN).next().value;
    if (firstArtifactUrl !== undefined) {
      recordCandidate(state, "artifact", firstArtifactUrl[1], firstArtifactUrl[0], pendingSignal, timestamp);
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
  scanMentions(state, typedText, "user-mention", timestamp);
  for (const ticketKey of findTicketKeysInText(typedText)) {
    recordCandidate(state, "ticket", ticketKey, undefined, "user-mention", timestamp, snippetAround(typedText, ticketKey));
  }
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
  recordCandidate(state, "pr", prId, prUrl, signal, timestamp, snippet, title);
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
): void {
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
