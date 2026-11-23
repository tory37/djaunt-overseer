import * as path from "path";
import { LiveSession } from "./liveParse";

const OVERSEER_DIR_NAME = "overseer";
const BRIEFS_DIR_NAME = "briefs";
const MARKDOWN_EXTENSION = ".md";

export const REPLY_END_SENTINEL = "<!-- end -->";
const MAX_REPLY_WORDS = 120;
const MAX_MERGE_INPUT_CHARS = 48 * 1024;
const CLIP_MARKER = "…";
const BRIEF_FILE_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.md$/;

export const SKIP_REASON_NO_TERMINAL = "no terminal in this window";
export const SKIP_REASON_BACKGROUND = "background agent, no terminal to type into";
export const SKIP_REASON_NOT_LIVE = "stopped running";
export const SKIP_REASON_TERMINAL_CLOSED = "terminal closed";

export const DEFAULT_TIMEOUT_MINUTES = 10;
export const DEFAULT_MERGE_MODEL = "sonnet";
// Merging many replies with sonnet can outlast the runner's default two minutes.
export const MERGE_TIMEOUT_MS = 300_000;
const MIN_TIMEOUT_MINUTES = 1;
const MS_PER_MINUTE = 60_000;

export type RunEndReason = "allAnswered" | "timeout" | "mergeNow" | "cancelled";

export type TargetCheck = { action: "send" } | { action: "wait" } | { action: "skip"; reason: string };

export interface WhereAreWeTargets {
  sendNow: LiveSession[];
  sendWhenIdle: LiveSession[];
  skipped: { sessionId: string; reason: string }[];
}

export interface WhereAreWeReply {
  sessionId: string;
  title: string;
  repo?: string;
  branch?: string;
  body: string;
}

export type MergeOutcome = { stdout: string } | { error: string };

export interface BriefResult {
  text: string;
  mergeError?: string;
}

export interface SkippedSession {
  sessionId: string;
  title: string;
  reason: string;
}

export const MERGE_SYSTEM_PROMPT = `You merge status replies from several Claude Code sessions into one markdown brief for Tory.
Each reply has the headings Goal, Done, State, Next, and Needs Tory. The input also lists sessions that did not reply, with reasons.
Write the brief in this order:
1. "## Start here": at most 5 bullets. Rank sessions that need Tory first, then the ones closest to done. Each bullet names the session and the one action to take.
2. One "### <session title>" block per session: repo and branch on one line, then a one-line state, then the next step.
3. "## Skipped": each skipped session and its reason. Leave this section out when nothing was skipped.
Name concrete things such as PRs, tickets, branches, and failing tests. Do not invent facts the replies do not state. No preamble.`;

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

// Colons are not safe in file names on every platform, so the time uses dashes.
export function whereAreWeRunId(now: Date): string {
  const datePart = `${now.getFullYear()}-${twoDigits(now.getMonth() + 1)}-${twoDigits(now.getDate())}`;
  const timePart = `${twoDigits(now.getHours())}-${twoDigits(now.getMinutes())}-${twoDigits(now.getSeconds())}`;
  return `${datePart}T${timePart}`;
}

export function briefsDir(claudeHome: string): string {
  return path.join(claudeHome, OVERSEER_DIR_NAME, BRIEFS_DIR_NAME);
}

export function briefRunDir(claudeHome: string, runId: string): string {
  return path.join(briefsDir(claudeHome), runId);
}

export function replyFile(claudeHome: string, runId: string, sessionId: string): string {
  return path.join(briefRunDir(claudeHome, runId), `${sessionId}${MARKDOWN_EXTENSION}`);
}

export function briefFile(claudeHome: string, runId: string): string {
  return path.join(briefsDir(claudeHome), `${runId}${MARKDOWN_EXTENSION}`);
}

// Enter inside a Claude input sends the prompt early, so the prompt is one line.
function singleLine(text: string): string {
  return text.replace(/[\r\n]+/g, " ").trim();
}

export function discussPrompt(briefPath: string, runDir: string): string {
  return singleLine(
    `Read the brief at ${briefPath} and the reply files in ${runDir}. ` +
      "Then wait for my questions about where my sessions stand. Do not change any code.",
  );
}

export function discussSessionName(runId: string): string {
  return `Where are we ${runId}`;
}

// Run ids are zero-padded local times, so the newest sorts last.
export function latestBriefRunId(fileNames: string[]): string | undefined {
  const runIds = fileNames
    .map((fileName) => BRIEF_FILE_PATTERN.exec(fileName)?.[1])
    .filter((runId): runId is string => runId !== undefined);
  return runIds.sort().at(-1);
}

export function whereAreWePrompt(replyPath: string, extraInstructions?: string): string {
  const extraText = singleLine(extraInstructions ?? "");
  const extraSentence = extraText === "" ? "" : ` Extra instructions: ${extraText}`;
  return singleLine(
    `Where are we? Write your answer only to ${replyPath}, and overwrite that file if it exists. ` +
      "Do not run any other tool and do not change any code. " +
      `Keep it under ${MAX_REPLY_WORDS} words of markdown with these headings: ` +
      "Goal (one line); Done (finished work, with PR, ticket, and branch); " +
      "State (where it stands now: uncommitted work, failing tests); Next (the next concrete step); " +
      'Needs Tory (decisions, approvals, and blockers, or "none"). ' +
      `The last line must be exactly ${REPLY_END_SENTINEL}${extraSentence}`,
  );
}

// The session may still be writing the file, so only a reply that ends with the sentinel counts.
export function isCompleteReply(replyText: string): boolean {
  return replyText.trimEnd().endsWith(REPLY_END_SENTINEL);
}

export function replyBody(replyText: string): string {
  const trimmedText = replyText.trimEnd();
  const withoutSentinel = trimmedText.endsWith(REPLY_END_SENTINEL)
    ? trimmedText.slice(0, -REPLY_END_SENTINEL.length)
    : trimmedText;
  return withoutSentinel.trim();
}

export function pickTargets(liveSessions: LiveSession[], hasTerminalHere: (sessionId: string) => boolean): WhereAreWeTargets {
  const targets: WhereAreWeTargets = { sendNow: [], sendWhenIdle: [], skipped: [] };
  for (const session of liveSessions) {
    if (session.status === "background") {
      targets.skipped.push({ sessionId: session.sessionId, reason: SKIP_REASON_BACKGROUND });
    } else if (!hasTerminalHere(session.sessionId)) {
      targets.skipped.push({ sessionId: session.sessionId, reason: SKIP_REASON_NO_TERMINAL });
    } else if (isWorking(session)) {
      targets.sendWhenIdle.push(session);
    } else {
      targets.sendNow.push(session);
    }
  }
  return targets;
}

// Run right before each send: the session may have started work, closed, or left since the targets were picked.
export function checkTarget(liveSession: LiveSession | undefined, hasTerminalHere: boolean): TargetCheck {
  if (liveSession === undefined) {
    return { action: "skip", reason: SKIP_REASON_NOT_LIVE };
  }
  if (liveSession.status === "background") {
    return { action: "skip", reason: SKIP_REASON_BACKGROUND };
  }
  if (!hasTerminalHere) {
    return { action: "skip", reason: SKIP_REASON_TERMINAL_CLOSED };
  }
  return isWorking(liveSession) ? { action: "wait" } : { action: "send" };
}

// A session that waits for input while a background shell runs reads as busy, but typed input reaches it.
function isWorking(liveSession: LiveSession): boolean {
  return liveSession.status === "busy" && !liveSession.isWaitingWithBackgroundShell;
}

export function unansweredReason(wasAsked: boolean, endReason: RunEndReason): string {
  const endedBy = endReason === "mergeNow" ? "Merge now" : "the timeout";
  return wasAsked ? `no answer before ${endedBy}` : `busy until ${endedBy}`;
}

export function whereAreWeTimeoutMs(configuredMinutes: unknown): number {
  const isUsableNumber = typeof configuredMinutes === "number" && Number.isFinite(configuredMinutes);
  const minutes = isUsableNumber ? Math.max(MIN_TIMEOUT_MINUTES, configuredMinutes) : DEFAULT_TIMEOUT_MINUTES;
  return minutes * MS_PER_MINUTE;
}

export function progressMessage(answeredCount: number, askableCount: number): string {
  return `${answeredCount} of ${askableCount} answered`;
}

function skippedSummary(skipped: SkippedSession[]): string {
  return skipped.map((session) => `${session.title} (${session.reason})`).join("; ");
}

export function noTargetsMessage(skipped: SkippedSession[]): string {
  if (skipped.length === 0) {
    return "Where are we: no live sessions to ask.";
  }
  return `Where are we: no session here to ask. Skipped: ${skippedSummary(skipped)}.`;
}

export function briefReadyMessage(answeredCount: number, skippedCount: number): string {
  return `Where are we: brief ready (${answeredCount} answered, ${skippedCount} skipped)`;
}

export function noRepliesMessage(skipped: SkippedSession[]): string {
  if (skipped.length === 0) {
    return "Where are we: no session answered.";
  }
  return `Where are we: no session answered. Skipped: ${skippedSummary(skipped)}.`;
}

// Keeps line breaks, because the replies are markdown.
function clipReplyBody(body: string, maxChars: number): string {
  return body.length <= maxChars ? body : `${body.slice(0, maxChars - CLIP_MARKER.length)}${CLIP_MARKER}`;
}

function repoAndBranchLine(reply: WhereAreWeReply): string {
  return `Repo: ${reply.repo ?? "(unknown)"} | Branch: ${reply.branch ?? "(unknown)"}`;
}

function skippedLines(skipped: SkippedSession[]): string[] {
  return skipped.map((session) => `- ${session.title}: ${session.reason}`);
}

// Each reply gets an equal share of the cap, so one long reply cannot crowd out the rest.
export function buildMergeInput(replies: WhereAreWeReply[], skipped: SkippedSession[]): string {
  const perReplyChars = Math.floor(MAX_MERGE_INPUT_CHARS / Math.max(1, replies.length));
  const replyBlocks = replies.map((reply) =>
    [`## Session: ${reply.title}`, repoAndBranchLine(reply), "", clipReplyBody(reply.body, perReplyChars)].join("\n"),
  );
  const skippedBlock = ["## Skipped sessions", ...(skipped.length === 0 ? ["(none)"] : skippedLines(skipped))].join("\n");
  const repliesBlock = replyBlocks.length === 0 ? "(no replies)" : replyBlocks.join("\n\n");
  return `${repliesBlock}\n\n${skippedBlock}`;
}

export function mergeArgs(model: string): string[] {
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
    "--system-prompt", MERGE_SYSTEM_PROMPT,
  ];
}

// The merge prompt asks for no preamble, so this is the brief's only header.
export function briefHeader(runId: string, answeredCount: number, skippedCount: number): string {
  return `# Where are we: ${runId}\n\n${answeredCount} answered, ${skippedCount} skipped.`;
}

export function parseMergeOutput(stdout: string): string {
  const envelope = JSON.parse(stdout) as { is_error?: boolean; result?: unknown };
  if (envelope.is_error) {
    throw new Error(`merge run failed: ${String(envelope.result)}`);
  }
  const mergedText = typeof envelope.result === "string" ? envelope.result.trim() : "";
  if (mergedText === "") {
    throw new Error("merge run returned no text");
  }
  return mergedText;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildBrief(
  mergeOutcome: MergeOutcome,
  replies: WhereAreWeReply[],
  skipped: SkippedSession[],
  runId: string,
): BriefResult {
  if ("error" in mergeOutcome) {
    return { text: fallbackBrief(replies, skipped, runId), mergeError: mergeOutcome.error };
  }
  let mergedText: string;
  try {
    mergedText = parseMergeOutput(mergeOutcome.stdout);
  } catch (error) {
    return { text: fallbackBrief(replies, skipped, runId), mergeError: errorMessage(error) };
  }
  return { text: `${briefHeader(runId, replies.length, skipped.length)}\n\n${mergedText}\n` };
}

export function fallbackBrief(replies: WhereAreWeReply[], skipped: SkippedSession[], runId: string): string {
  const sections = [briefHeader(runId, replies.length, skipped.length), "The merge failed. These are the raw replies."];
  if (replies.length === 0) {
    sections.push("No replies.");
  }
  for (const reply of replies) {
    sections.push([`## ${reply.title}`, repoAndBranchLine(reply), "", reply.body].join("\n"));
  }
  if (skipped.length > 0) {
    sections.push(["## Skipped", ...skippedLines(skipped)].join("\n"));
  }
  return `${sections.join("\n\n")}\n`;
}
