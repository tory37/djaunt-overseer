import * as fs from "fs";
import { SessionRecap } from "./indexer";

export interface SummaryCacheEntry {
  text: string;
  model: string;
  summarizedAtMs: number;
  transcriptSizeBytes: number;
}

export interface HoverSummary {
  source: "recap" | "haiku";
  text: string;
  writtenAtMs: number;
  isStale: boolean;
}

export interface SummarySessionContext {
  title: string | undefined;
  gitBranch: string | undefined;
  cwd: string | undefined;
  firstPrompt: string | undefined;
}

const TRANSCRIPT_TAIL_BYTES = 2 * 1024 * 1024;
const MAX_DIGEST_BYTES = 12 * 1024;
const MAX_TURN_CHARS = 400;
const MAX_TOOL_CHARS = 120;
const MAX_SUMMARY_CHARS = 600;

const SUMMARY_SYSTEM_PROMPT = `You summarize one Claude Code session for a sidebar hover.
The input has the session's title, branch, cwd, first prompt, and its latest turns, oldest first.
Write 2 or 3 short sentences of plain text: what the user wants, where the work stands, and what comes next or what blocks it.
Name concrete things such as tickets, PRs, files, and commands. No markdown, no preamble.`;

interface TranscriptRecord {
  type?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  isCompactSummary?: boolean;
  message?: { content?: unknown };
}

export async function readTranscriptTail(transcriptFile: string, maxBytes = TRANSCRIPT_TAIL_BYTES): Promise<string[]> {
  const fileHandle = await fs.promises.open(transcriptFile, "r");
  try {
    const { size } = await fileHandle.stat();
    const startOffset = Math.max(0, size - maxBytes);
    const tailBuffer = Buffer.alloc(size - startOffset);
    await fileHandle.read(tailBuffer, 0, tailBuffer.length, startOffset);
    const tailLines = tailBuffer.toString("utf8").split("\n");
    // A tail that starts mid-file starts mid-line.
    return startOffset > 0 ? tailLines.slice(1) : tailLines;
  } finally {
    await fileHandle.close();
  }
}

// Keeps the newest turns that fit, then lists them oldest first.
export function buildSummaryDigest(context: SummarySessionContext, transcriptLines: string[]): string {
  const headerText = [
    `Session title: ${context.title ?? "(none)"}`,
    `Branch: ${context.gitBranch ?? "(none)"}`,
    `Cwd: ${context.cwd ?? "(unknown)"}`,
    `First prompt: ${clipText(context.firstPrompt ?? "(none)", MAX_TURN_CHARS)}`,
    "",
    "Latest turns:",
  ].join("\n");
  const turns = transcriptLines.flatMap(readTurns);
  const keptTurns: string[] = [];
  let usedBytes = Buffer.byteLength(headerText, "utf8");
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex--) {
    const turnLine = `\n${turns[turnIndex]}`;
    const turnBytes = Buffer.byteLength(turnLine, "utf8");
    if (usedBytes + turnBytes > MAX_DIGEST_BYTES) {
      break;
    }
    keptTurns.unshift(turnLine);
    usedBytes += turnBytes;
  }
  return headerText + keptTurns.join("");
}

export function summaryArgs(model: string): string[] {
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
    "--system-prompt", SUMMARY_SYSTEM_PROMPT,
  ];
}

export function parseSummaryOutput(stdout: string): string {
  const envelope = JSON.parse(stdout) as { is_error?: boolean; result?: unknown };
  if (envelope.is_error) {
    throw new Error(`summary run failed: ${String(envelope.result)}`);
  }
  const summaryText = typeof envelope.result === "string" ? clipText(envelope.result, MAX_SUMMARY_CHARS) : "";
  if (summaryText === "") {
    throw new Error("summary run returned no text");
  }
  return summaryText;
}

// Shows whichever of Claude Code's recap and the Haiku summary was written last.
export function pickHoverSummary(
  recap: SessionRecap | undefined,
  haikuSummary: SummaryCacheEntry | undefined,
  transcriptSizeBytes: number,
): HoverSummary | undefined {
  const haikuHoverSummary: HoverSummary | undefined =
    haikuSummary === undefined
      ? undefined
      : {
          source: "haiku",
          text: haikuSummary.text,
          writtenAtMs: haikuSummary.summarizedAtMs,
          isStale: haikuSummary.transcriptSizeBytes < transcriptSizeBytes,
        };
  const recapHoverSummary: HoverSummary | undefined =
    recap === undefined ? undefined : { source: "recap", ...recap };
  if (haikuHoverSummary === undefined || recapHoverSummary === undefined) {
    return haikuHoverSummary ?? recapHoverSummary;
  }
  return haikuHoverSummary.writtenAtMs >= recapHoverSummary.writtenAtMs ? haikuHoverSummary : recapHoverSummary;
}

function readTurns(line: string): string[] {
  const isTurnRecord = line.includes('"type":"user"') || line.includes('"type":"assistant"');
  if (!isTurnRecord) {
    return [];
  }
  let record: TranscriptRecord;
  try {
    record = JSON.parse(line) as TranscriptRecord;
  } catch {
    return [];
  }
  if (record.isMeta || record.isSidechain || record.isCompactSummary) {
    return [];
  }
  const content = record.message?.content;
  if (record.type === "user") {
    return userTurns(content);
  }
  if (record.type === "assistant" && Array.isArray(content)) {
    return content.flatMap(assistantTurn);
  }
  return [];
}

function userTurns(content: unknown): string[] {
  if (typeof content === "string") {
    return promptTurn(content);
  }
  if (!Array.isArray(content)) {
    return [];
  }
  // Tool results arrive as user records too; only typed text is the user's words.
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .flatMap((block: { text: string }) => promptTurn(block.text));
}

function promptTurn(promptText: string): string[] {
  const isCommandOutput = promptText.startsWith("<local-command") || promptText.startsWith("<command-");
  const withoutMarkup = promptText.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, " ");
  if (isCommandOutput || withoutMarkup.trim() === "") {
    return [];
  }
  return [`User: ${clipText(withoutMarkup, MAX_TURN_CHARS)}`];
}

function assistantTurn(block: { type?: string; text?: unknown; name?: unknown; input?: unknown }): string[] {
  if (block?.type === "text" && typeof block.text === "string" && block.text.trim() !== "") {
    return [`Claude: ${clipText(block.text, MAX_TURN_CHARS)}`];
  }
  if (block?.type === "tool_use" && typeof block.name === "string") {
    const toolInput = block.input as { description?: unknown } | undefined;
    const toolDescription = typeof toolInput?.description === "string" ? `: ${toolInput.description}` : "";
    return [`Tool: ${clipText(`${block.name}${toolDescription}`, MAX_TOOL_CHARS)}`];
  }
  return [];
}

function clipText(text: string, maxLength: number): string {
  const singleLineText = text.replace(/\s+/g, " ").trim();
  return singleLineText.length <= maxLength ? singleLineText : `${singleLineText.slice(0, maxLength - 1)}…`;
}
