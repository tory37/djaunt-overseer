import { normalizeTicketKey } from "./agentTickets";
import { normalizeArtifactParentKey, normalizeArtifactUrl, normalizeCommitHash, normalizePullRequestUrl } from "./agentWork";
import { artifactUrlsIn } from "./linkCandidates";
import { clipText } from "./sessionSummary";

export interface PopulateContext {
  title: string;
  gitBranch: string | undefined;
  cwd: string | undefined;
  removedTicketKeys: string[];
}

export interface PopulatedItem {
  id: string;
  note?: string;
  parentKey?: string;
}

export interface PopulateResult {
  tickets: PopulatedItem[];
  commits: PopulatedItem[];
  pullRequests: PopulatedItem[];
  artifacts: PopulatedItem[];
}

interface DigestEvent {
  order: number;
  text: string;
  isEvidence: boolean;
}

interface TranscriptRecord {
  type?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  isCompactSummary?: boolean;
  message?: { content?: unknown };
}

interface ContentBlock {
  type?: string;
  text?: unknown;
  name?: unknown;
  id?: unknown;
  input?: unknown;
  tool_use_id?: unknown;
  content?: unknown;
}

const MAX_DIGEST_BYTES = 48 * 1024;
export const RECHECK_DIGEST_BYTES = 128 * 1024;
const MAX_TEXT_CHARS = 400;
const MAX_COMMAND_CHARS = 300;
const MAX_RESULT_CHARS = 400;
const MAX_NOTE_CHARS = 120;
// Commands and tools whose results show the session creating work, not just reading it.
// overseer commands count too, so a declaration that failed still shows up.
const EVIDENCE_COMMAND_PATTERN = /\bgit\s+(?:-C\s+\S+\s+)?(?:commit|cherry-pick|revert|merge|push)\b|\bgh\s+pr\b|\bacli\b|\boverseer\b/;
const EVIDENCE_TOOL_PATTERN = /jira|atlassian|github|^Artifact$/i;

const POPULATE_SYSTEM_PROMPT = `You read a digest of one Claude Code session and list the work that session did.
Reply with only this JSON, no markdown:
{"tickets":[{"key":"PROJ-2","note":"...","parent":"PROJ-1"}],"commits":[{"hash":"abc1234","note":"..."}],"pullRequests":[{"url":"https://github.com/owner/repo/pull/1","note":"...","parent":"PROJ-2"}],"artifacts":[{"url":"https://claude.ai/artifact/...","note":"...","parent":"PROJ-2"}]}
Rules:
- tickets: Jira tickets the session implemented, fixed, investigated, reviewed, or test-planned. Not tickets it only read for context, such as linked tickets, parent epics, or similar past bugs. Never list a ticket under "Removed by the user".
- commits: commits this session created, as shown by git commit, cherry-pick, revert, or merge output. Not commits it only saw in logs, diffs, or other output.
- pullRequests: GitHub PRs this session opened, pushed commits to, or reviewed. Not PRs it only mentioned.
- artifacts: claude.ai artifact URLs this session published. Not ones it only read.
- note: one short line on the item's current state and purpose. Use the latest events.
- parent: optional. For a ticket, its epic or parent ticket. For a PR, the ticket it implements. For an artifact, a ticket key or PR URL. Only keys and URLs that appear in the digest.
- Use empty arrays when there is nothing.`;

export function populateArgs(model: string): string[] {
  return [
    "-p",
    "--model", model,
    "--effort", "low",
    "--output-format", "json",
    "--no-session-persistence",
    "--tools", "",
    "--strict-mcp-config",
    "--setting-sources", "",
    "--settings", JSON.stringify({ alwaysThinkingEnabled: false }),
    "--system-prompt", POPULATE_SYSTEM_PROMPT,
  ];
}

// Evidence (commits, PR and Jira commands) goes in first; the conversation fills the rest, newest first.
export function buildPopulateDigest(context: PopulateContext, transcriptLines: string[], maxBytes = MAX_DIGEST_BYTES): string {
  const headerText = [
    `Session title: ${context.title}`,
    `Branch: ${context.gitBranch ?? "(none)"}`,
    `Cwd: ${context.cwd ?? "(unknown)"}`,
    `Removed by the user: ${context.removedTicketKeys.length > 0 ? context.removedTicketKeys.join(", ") : "(none)"}`,
    "",
    "Session events, oldest first:",
  ].join("\n");
  const events = digestEvents(transcriptLines);
  const keptEvents: DigestEvent[] = [];
  let usedBytes = Buffer.byteLength(headerText, "utf8");
  const tryKeep = (event: DigestEvent): void => {
    const eventBytes = Buffer.byteLength(`\n${event.text}`, "utf8");
    if (usedBytes + eventBytes <= maxBytes) {
      keptEvents.push(event);
      usedBytes += eventBytes;
    }
  };
  events.filter((event) => event.isEvidence).forEach(tryKeep);
  events
    .filter((event) => !event.isEvidence)
    .reverse()
    .forEach(tryKeep);
  keptEvents.sort((left, right) => left.order - right.order);
  return headerText + keptEvents.map((event) => `\n${event.text}`).join("");
}

export function parsePopulateOutput(stdout: string): PopulateResult {
  const envelope = JSON.parse(stdout) as { is_error?: boolean; result?: unknown };
  if (envelope.is_error || typeof envelope.result !== "string") {
    throw new Error(`populate run failed: ${String(envelope.result)}`);
  }
  const resultText = envelope.result;
  const jsonStart = resultText.indexOf("{");
  const jsonEnd = resultText.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd < jsonStart) {
    throw new Error("populate run returned no JSON");
  }
  const fields = JSON.parse(resultText.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>;
  return {
    tickets: readItems(fields.tickets, "key", normalizeTicketKey, normalizeTicketKey),
    commits: readItems(fields.commits, "hash", normalizeCommitHash),
    pullRequests: readItems(fields.pullRequests, "url", normalizePullRequestUrl, normalizeTicketKey),
    artifacts: readItems(fields.artifacts, "url", normalizeArtifactUrl, normalizeArtifactParentKey),
  };
}

export function populateFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/ENOENT/.test(message)) {
    return "Couldn't find the claude CLI.";
  }
  if (/timed out/i.test(message)) {
    return "Haiku timed out.";
  }
  if (/JSON/.test(message)) {
    return "Haiku's reply had no usable list.";
  }
  return "Haiku run failed. See the Overseer output.";
}

type Normalizer = (rawValue: string) => string | undefined;

function readItems(value: unknown, idField: string, normalizeId: Normalizer, normalizeParentKey?: Normalizer): PopulatedItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const items = new Map<string, PopulatedItem>();
  for (const entry of value) {
    const fields = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
    const rawId = fields[idField];
    const id = typeof rawId === "string" ? normalizeId(rawId) : undefined;
    if (id === undefined || items.has(id)) {
      continue;
    }
    const note = typeof fields.note === "string" && fields.note.trim() !== "" ? clipText(fields.note, MAX_NOTE_CHARS) : undefined;
    const rawParentKey = fields.parent;
    const parentKey =
      normalizeParentKey !== undefined && typeof rawParentKey === "string" ? normalizeParentKey(rawParentKey) : undefined;
    items.set(id, {
      id,
      ...(note !== undefined ? { note } : {}),
      ...(parentKey !== undefined && parentKey !== id ? { parentKey } : {}),
    });
  }
  return [...items.values()];
}

function digestEvents(transcriptLines: string[]): DigestEvent[] {
  const events: DigestEvent[] = [];
  const evidenceToolIds = new Set<string>();
  for (const line of transcriptLines) {
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) {
      continue;
    }
    let record: TranscriptRecord;
    try {
      record = JSON.parse(line) as TranscriptRecord;
    } catch {
      continue;
    }
    if (record.isMeta || record.isSidechain || record.isCompactSummary) {
      continue;
    }
    for (const eventText of recordEvents(record, evidenceToolIds)) {
      events.push({ order: events.length, ...eventText });
    }
  }
  return events;
}

function recordEvents(record: TranscriptRecord, evidenceToolIds: Set<string>): Omit<DigestEvent, "order">[] {
  const content = record.message?.content;
  if (record.type === "user" && typeof content === "string") {
    return promptEvents(content);
  }
  if (!Array.isArray(content)) {
    return [];
  }
  return (content as ContentBlock[]).flatMap((block) =>
    record.type === "user" ? userBlockEvents(block, evidenceToolIds) : assistantBlockEvents(block, evidenceToolIds),
  );
}

function promptEvents(promptText: string): Omit<DigestEvent, "order">[] {
  const isCommandOutput = promptText.startsWith("<local-command") || promptText.startsWith("<command-");
  const withoutMarkup = promptText.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, " ");
  if (isCommandOutput || withoutMarkup.trim() === "") {
    return [];
  }
  return [{ text: `User: ${clipText(withoutMarkup, MAX_TEXT_CHARS)}`, isEvidence: false }];
}

function userBlockEvents(block: ContentBlock, evidenceToolIds: Set<string>): Omit<DigestEvent, "order">[] {
  if (block?.type === "text" && typeof block.text === "string") {
    return promptEvents(block.text);
  }
  if (block?.type !== "tool_result" || typeof block.tool_use_id !== "string") {
    return [];
  }
  const resultText = toolResultText(block.content);
  if (evidenceToolIds.has(block.tool_use_id)) {
    return resultText === "" ? [] : [{ text: `Result: ${evidenceResultText(resultText)}`, isEvidence: true }];
  }
  const artifactUrls = artifactUrlsIn(resultText);
  return artifactUrls.length === 0 ? [] : [{ text: `Tool result names artifacts: ${artifactUrls.join(" ")}`, isEvidence: true }];
}

// A long result can push its artifact URL past the clip, so missing URLs go on the end.
function evidenceResultText(resultText: string): string {
  const clippedText = clipText(resultText, MAX_RESULT_CHARS);
  const clippedArtifactUrls = artifactUrlsIn(resultText).filter((url) => !clippedText.includes(url));
  return clippedArtifactUrls.length === 0 ? clippedText : `${clippedText} (artifacts: ${clippedArtifactUrls.join(" ")})`;
}

function assistantBlockEvents(block: ContentBlock, evidenceToolIds: Set<string>): Omit<DigestEvent, "order">[] {
  if (block?.type === "text" && typeof block.text === "string" && block.text.trim() !== "") {
    return [{ text: `Claude: ${clipText(block.text, MAX_TEXT_CHARS)}`, isEvidence: false }];
  }
  if (block?.type !== "tool_use" || typeof block.name !== "string") {
    return [];
  }
  const toolInput = (typeof block.input === "object" && block.input !== null ? block.input : {}) as Record<string, unknown>;
  const command = block.name === "Bash" && typeof toolInput.command === "string" ? toolInput.command : undefined;
  const isEvidence = command !== undefined ? EVIDENCE_COMMAND_PATTERN.test(command) : EVIDENCE_TOOL_PATTERN.test(block.name);
  if (!isEvidence) {
    return [];
  }
  if (typeof block.id === "string") {
    evidenceToolIds.add(block.id);
  }
  const callText = command ?? `${block.name} ${JSON.stringify(toolInput)}`;
  return [{ text: `Ran: ${clipText(callText, MAX_COMMAND_CHARS)}`, isEvidence: true }];
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter((part): part is { text: string } => typeof part?.text === "string")
    .map((part) => part.text)
    .join(" ");
}
