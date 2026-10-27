import { clipLine, SessionAnalysis, TICKET_ITEM_PREFIX, workstreamOfItem } from "./analysisState";
import { EnrichedCandidate } from "./candidateEnrichment";
import { isPassiveMention, linkKey, userPromptTextOf } from "./linkCandidates";
import { StatusOption } from "./sessionStatuses";
import { isLockedItem, isUserEditedWorkstream, WorkstreamEdits } from "./workstreamEdits";

export type AnalyzerMode = "diff" | "recheck";

export interface TimedPrompt {
  text: string;
  timeMs: number | undefined;
}

interface StampedPrompt extends TimedPrompt {
  timeMs: number;
}

export interface DigestEvent {
  order: number;
  text: string;
  isEvidence: boolean;
  userPrompt?: TimedPrompt;
}

export interface AnalyzerSessionContext {
  title: string;
  gitBranch: string | undefined;
  cwd: string | undefined;
}

export interface AnalyzerDigestInput {
  mode: AnalyzerMode;
  session: AnalyzerSessionContext;
  analysis: SessionAnalysis;
  edits: WorkstreamEdits;
  candidates: EnrichedCandidate[];
  events: DigestEvent[];
  overlapPrompt: string | undefined;
  statusOptions: StatusOption[];
  transcriptEndBytes: number;
}

// itemKeys are the items the model saw, so only those may be placed.
export interface AnalyzerDigest {
  text: string;
  watermarkBytes: number;
  itemKeys: string[];
}

export const DIFF_DIGEST_BYTES = 16 * 1024;
export const RECHECK_DIGEST_BYTES = 64 * 1024;
// Items matter more than chatter, but some transcript must fit, so items stop at this share of the budget.
const ITEM_BUDGET_SHARE = 0.6;
// User prompts carry the timeline, so they get this share of the transcript budget before evidence.
const PROMPT_BUDGET_SHARE = 0.5;
// A pause this long between prompts starts a new stretch of work.
const WORK_STRETCH_GAP_MS = 30 * 60 * 1000;
const OMITTED_NOTE_RESERVE_BYTES = 64;
const MAX_PROMPT_CHARS = 400;
const MAX_ASSISTANT_CHARS = 200;
const MAX_TOOL_CALL_CHARS = 160;
const MAX_EVIDENCE_CALL_CHARS = 300;
const MAX_EVIDENCE_RESULT_CHARS = 300;
const MAX_ITEM_PROMPT_CHARS = 160;
const COMPACT_TIMESTAMP_CHARS = "2026-01-31T12:00".length;
const EVIDENCE_COMMAND_PATTERN = /\bgit\s+(?:-C\s+\S+\s+)?(?:commit|cherry-pick|revert|merge|push)\b|\bgh\s+pr\b/;
const EVIDENCE_TOOL_PATTERN = /jira|atlassian|github|^Artifact$/i;
const FILE_TOOL_NAMES = new Set(["Read", "Edit", "Write", "MultiEdit", "NotebookEdit"]);

interface TranscriptRecord {
  type?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  isCompactSummary?: boolean;
  timestamp?: unknown;
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

// Fed one transcript line at a time, so a long transcript never sits in memory whole.
export class DigestEventCollector {
  readonly events: DigestEvent[] = [];
  private readonly evidenceToolIds = new Set<string>();

  addLine(line: string): void {
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) {
      return;
    }
    const promptText = userPromptTextOf(line);
    if (promptText !== undefined) {
      const rawTimestamp = parseRecord(line)?.timestamp;
      const promptTime = compactTimestamp(rawTimestamp);
      const timeText = promptTime === undefined ? "" : ` [${promptTime}]`;
      const userPrompt = { text: promptText, timeMs: timeMsOf(rawTimestamp) };
      this.push(`User${timeText}: ${clipLine(promptText, MAX_PROMPT_CHARS)}`, false, userPrompt);
      return;
    }
    const record = parseRecord(line);
    if (record === undefined || record.isMeta || record.isSidechain || record.isCompactSummary) {
      return;
    }
    const content = record.message?.content;
    if (!Array.isArray(content)) {
      return;
    }
    for (const block of content as ContentBlock[]) {
      if (record.type === "assistant") {
        this.addAssistantBlock(block);
      } else {
        this.addToolResult(block);
      }
    }
  }

  private addAssistantBlock(block: ContentBlock): void {
    if (block?.type === "text" && typeof block.text === "string" && block.text.trim() !== "") {
      this.push(`Claude: ${clipLine(block.text, MAX_ASSISTANT_CHARS)}`, false);
      return;
    }
    if (block?.type !== "tool_use" || typeof block.name !== "string") {
      return;
    }
    const toolInput = (typeof block.input === "object" && block.input !== null ? block.input : {}) as Record<string, unknown>;
    const command = block.name === "Bash" && typeof toolInput.command === "string" ? toolInput.command : undefined;
    const isEvidence = command !== undefined ? EVIDENCE_COMMAND_PATTERN.test(command) : EVIDENCE_TOOL_PATTERN.test(block.name);
    if (isEvidence && typeof block.id === "string") {
      this.evidenceToolIds.add(block.id);
    }
    const callSummary = toolCallSummary(block.name, toolInput);
    this.push(`Ran: ${clipLine(callSummary, isEvidence ? MAX_EVIDENCE_CALL_CHARS : MAX_TOOL_CALL_CHARS)}`, isEvidence);
  }

  private addToolResult(block: ContentBlock): void {
    if (block?.type !== "tool_result" || typeof block.tool_use_id !== "string" || !this.evidenceToolIds.has(block.tool_use_id)) {
      return;
    }
    const resultText = toolResultText(block.content);
    if (resultText.trim() !== "") {
      this.push(`Result: ${clipLine(resultText, MAX_EVIDENCE_RESULT_CHARS)}`, true);
    }
  }

  private push(text: string, isEvidence: boolean, userPrompt?: TimedPrompt): void {
    const event: DigestEvent = { order: this.events.length, text, isEvidence };
    if (userPrompt !== undefined) {
      event.userPrompt = userPrompt;
    }
    this.events.push(event);
  }
}

export function digestEventsOf(transcriptLines: Iterable<string>): DigestEvent[] {
  const collector = new DigestEventCollector();
  for (const line of transcriptLines) {
    collector.addLine(line);
  }
  return collector.events;
}

export function digestBudgetBytes(mode: AnalyzerMode): number {
  return mode === "recheck" ? RECHECK_DIGEST_BYTES : DIFF_DIGEST_BYTES;
}

// Date plus hh:mm in UTC, so the model sees phase changes; anything that is not a time gives undefined.
export function compactTimestamp(rawTimestamp: unknown): string | undefined {
  const timeMs = timeMsOf(rawTimestamp);
  return timeMs === undefined ? undefined : compactTime(timeMs);
}

function compactTime(timeMs: number): string {
  return new Date(timeMs).toISOString().slice(0, COMPACT_TIMESTAMP_CHARS).replace("T", " ");
}

function timeMsOf(rawTimestamp: unknown): number | undefined {
  if (typeof rawTimestamp !== "string") {
    return undefined;
  }
  const timeMs = Date.parse(rawTimestamp);
  return Number.isNaN(timeMs) ? undefined : timeMs;
}

// Fixed sections first, then items, then the overlap prompt, then the transcript.
export function buildAnalyzerDigest(input: AnalyzerDigestInput): AnalyzerDigest {
  const budgetBytes = digestBudgetBytes(input.mode);
  const headerText = [sessionSection(input), stateSection(input), seedFactsSection(input), statusSection(input)].join("\n\n");
  let usedBytes = byteLength(headerText) + OMITTED_NOTE_RESERVE_BYTES;

  const itemBudgetBytes = Math.max(usedBytes, budgetBytes * ITEM_BUDGET_SHARE);
  const rankedItems = digestItems(input);
  const keptItemKeys = new Set(input.analysis.seedFacts.keptItemKeys);
  const stampedPrompts = input.events.flatMap((event) => (isStampedPrompt(event.userPrompt) ? [event.userPrompt] : []));
  const keptItems: { item: EnrichedCandidate; entry: string }[] = [];
  const itemsHeading = `\n\n${input.mode === "recheck" ? "All items" : "New and unsorted items"}, oldest first (times are UTC):`;
  usedBytes += byteLength(itemsHeading);
  for (const item of rankedItems) {
    const stretchPrompt = stretchStartPrompt(stampedPrompts, timeMsOf(item.firstSeen), input.mode === "recheck");
    const itemEntry = renderItem(item, input.edits, keptItemKeys, stretchPrompt);
    if (usedBytes + byteLength(itemEntry) > itemBudgetBytes) {
      break;
    }
    keptItems.push({ item, entry: itemEntry });
    usedBytes += byteLength(itemEntry);
  }
  keptItems.sort((left, right) => firstSeenOrder(left.item) - firstSeenOrder(right.item));
  const itemEntries = keptItems.map((keptItem) => keptItem.entry);
  const itemKeys = keptItems.map((keptItem) => linkKey(keptItem.item));
  const omittedItemCount = rankedItems.length - itemEntries.length;
  const omittedItemsNote = omittedItemCount > 0 ? `\n(${omittedItemCount} more items omitted for space.)` : "";
  const itemsText = itemsHeading + (itemEntries.length === 0 ? "\n(none)" : itemEntries.join("")) + omittedItemsNote;

  const fullOverlapText =
    input.overlapPrompt === undefined
      ? ""
      : `\n\nThe last user prompt before this diff, for context:\nUser: ${clipLine(input.overlapPrompt, MAX_PROMPT_CHARS)}`;
  const overlapText = usedBytes + byteLength(fullOverlapText) <= budgetBytes ? fullOverlapText : "";
  usedBytes += byteLength(overlapText);

  const transcriptHeading = `\n\n${input.mode === "recheck" ? "Whole transcript" : "Transcript since the last pass"}, oldest first (times are UTC):`;
  usedBytes += byteLength(transcriptHeading);
  const keptEvents = eventsWithinBudget(input.events, budgetBytes - usedBytes);
  const transcriptText = transcriptHeading + (keptEvents.length === 0 ? "\n(nothing new)" : keptEvents.map((event) => `\n${event.text}`).join(""));

  return {
    text: headerText + itemsText + overlapText + transcriptText,
    watermarkBytes: input.transcriptEndBytes,
    itemKeys: [...new Set([...itemKeys, ...input.analysis.seedFacts.knownItems.map((knownItem) => knownItem.itemKey)])],
  };
}

// Newest prompts first up to their share, then evidence, then everything else newest first.
function eventsWithinBudget(events: DigestEvent[], availableBytes: number): DigestEvent[] {
  const keptEvents = new Set<DigestEvent>();
  let usedBytes = 0;
  const keeperWithin = (limitBytes: number) => (event: DigestEvent): void => {
    const eventBytes = byteLength(`\n${event.text}`);
    if (!keptEvents.has(event) && usedBytes + eventBytes <= limitBytes) {
      keptEvents.add(event);
      usedBytes += eventBytes;
    }
  };
  events
    .filter((event) => event.userPrompt !== undefined)
    .reverse()
    .forEach(keeperWithin(availableBytes * PROMPT_BUDGET_SHARE));
  events.filter((event) => event.isEvidence).forEach(keeperWithin(availableBytes));
  events
    .filter((event) => !event.isEvidence)
    .reverse()
    .forEach(keeperWithin(availableBytes));
  return [...keptEvents].sort((left, right) => left.order - right.order);
}

// A diff starts mid-session, so its first prompt opens a stretch only when a pause before it proves one began there.
function stretchStartPrompt(stampedPrompts: StampedPrompt[], firstSeenMs: number | undefined, isWholeTranscript: boolean): StampedPrompt | undefined {
  if (firstSeenMs === undefined) {
    return undefined;
  }
  let stretchIndex = stampedPrompts.length - 1;
  while (stretchIndex >= 0 && stampedPrompts[stretchIndex].timeMs > firstSeenMs) {
    stretchIndex--;
  }
  if (stretchIndex === -1) {
    return undefined;
  }
  while (stretchIndex > 0 && stampedPrompts[stretchIndex].timeMs - stampedPrompts[stretchIndex - 1].timeMs < WORK_STRETCH_GAP_MS) {
    stretchIndex--;
  }
  return stretchIndex > 0 || isWholeTranscript ? stampedPrompts[stretchIndex] : undefined;
}

function isStampedPrompt(prompt: TimedPrompt | undefined): prompt is StampedPrompt {
  return prompt?.timeMs !== undefined;
}

function firstSeenOrder(item: EnrichedCandidate): number {
  return item.firstSeenOffsetBytes ?? item.lastSeenOffsetBytes ?? 0;
}

// Newest first, so the item budget drops the oldest. A diff shows what is new plus what is still unsorted; a recheck shows everything. Removed items never show; kept ones always do.
function digestItems(input: AnalyzerDigestInput): EnrichedCandidate[] {
  const removedItemKeys = new Set(input.edits.removedItems);
  const keptItemKeys = new Set(input.analysis.seedFacts.keptItemKeys);
  const taggedTicketKeys = new Set(input.analysis.workstreams.flatMap((workstream) => workstream.ticketKeys));
  const isPlaced = (candidate: EnrichedCandidate): boolean =>
    candidate.kind === "ticket"
      ? taggedTicketKeys.has(candidate.id)
      : workstreamOfItem(input.analysis, linkKey(candidate)) !== undefined;
  const isNew = (candidate: EnrichedCandidate): boolean =>
    (candidate.lastSeenOffsetBytes ?? 0) > input.analysis.watermarkBytes;
  return input.candidates
    .filter((candidate) => (keptItemKeys.has(linkKey(candidate)) || !isPassiveMention(candidate)) && !removedItemKeys.has(linkKey(candidate)))
    .filter((candidate) => input.mode === "recheck" || isNew(candidate) || !isPlaced(candidate))
    .sort((left, right) => (right.lastSeenOffsetBytes ?? 0) - (left.lastSeenOffsetBytes ?? 0));
}

function sessionSection(input: AnalyzerDigestInput): string {
  return [
    `Pass: ${input.mode}`,
    `Session title: ${input.session.title}`,
    `Branch: ${input.session.gitBranch ?? "(none)"}`,
    `Cwd: ${input.session.cwd ?? "(unknown)"}`,
  ].join("\n");
}

function stateSection(input: AnalyzerDigestInput): string {
  const { analysis, edits, candidates } = input;
  const labelsByKey = new Map(candidates.map((candidate) => [linkKey(candidate), candidate.title]));
  const lines = ["Current workstreams:"];
  if (analysis.workstreams.length === 0) {
    lines.push("(none)");
  }
  for (const workstream of analysis.workstreams) {
    const markers = [
      edits.workstreamTitles[workstream.id] !== undefined ? "title fixed by user" : undefined,
      workstream.done ? "done" : undefined,
      edits.workstreamDone[workstream.id] !== undefined ? "done state fixed by user" : undefined,
    ].filter((marker): marker is string => marker !== undefined);
    const markerText = markers.length === 0 ? "" : ` [${markers.join("; ")}]`;
    const ticketText = workstream.ticketKeys.length === 0 ? "" : ` tickets: ${workstream.ticketKeys.join(", ")}`;
    lines.push(`- ${workstream.id} "${workstream.title}"${markerText}${ticketText}`);
    for (const itemKey of workstream.itemKeys) {
      const itemLabel = analysis.artifactTitles[itemKey] ?? labelsByKey.get(itemKey);
      const fixedText = isLockedItem(edits, itemKey) ? " [fixed by user]" : "";
      lines.push(`  - ${itemKey}${itemLabel === undefined ? "" : ` "${itemLabel}"`}${fixedText}`);
    }
  }
  const pinnedTickets = Object.entries(edits.pinnedItems).filter(([itemKey]) => itemKey.startsWith(TICKET_ITEM_PREFIX));
  if (pinnedTickets.length > 0) {
    lines.push(`Ticket tags fixed by user: ${pinnedTickets.map(([itemKey, workstreamId]) => `${itemKey} on ${workstreamId}`).join(", ")}`);
  }
  if (edits.removedItems.length > 0) {
    lines.push(`Removed by the user, never assign or tag: ${edits.removedItems.join(", ")}`);
  }
  const userEditedIds = analysis.workstreams.filter((workstream) => isUserEditedWorkstream(edits, workstream.id));
  if (userEditedIds.length > 0) {
    lines.push(`Workstreams the user edited, keep them: ${userEditedIds.map((workstream) => workstream.id).join(", ")}`);
  }
  lines.push(`Where lines: ${analysis.where.length === 0 ? "(none)" : analysis.where.join(" | ")}`);
  return lines.join("\n");
}

function seedFactsSection(input: AnalyzerDigestInput): string {
  const { knownItems, keptItemKeys } = input.analysis.seedFacts;
  const removedItemKeys = new Set(input.edits.removedItems);
  const shownItems = knownItems.filter((knownItem) => !removedItemKeys.has(knownItem.itemKey));
  const lines = ["Background facts from earlier notes, not workstreams:"];
  if (shownItems.length === 0) {
    lines.push("(none)");
  }
  for (const knownItem of shownItems) {
    const noteText = knownItem.note === undefined ? "" : ` "${knownItem.note}"`;
    const parentText = knownItem.parentKey === undefined ? "" : ` | parent ${knownItem.parentKey}`;
    lines.push(`- ${knownItem.itemKey}${noteText}${parentText}`);
  }
  if (keptItemKeys.length > 0) {
    lines.push(`Kept by the user, always place them: ${keptItemKeys.join(", ")}`);
  }
  return lines.join("\n");
}

function statusSection(input: AnalyzerDigestInput): string {
  const { analysis, edits, statusOptions } = input;
  const currentStatus = analysis.sessionStatus ?? "(none)";
  const fixedText = edits.sessionStatus !== undefined || edits.sessionDone !== undefined ? " [fixed by user]" : "";
  const optionLines = statusOptions.map((option) => `- ${option.id} "${option.name}"${option.done ? " (means done)" : ""}`);
  return [
    `Session status: ${currentStatus}, done: ${analysis.sessionDone ? "yes" : "no"}${fixedText}`,
    "Allowed session statuses:",
    ...(optionLines.length === 0 ? ["(none configured)"] : optionLines),
  ].join("\n");
}

function renderItem(
  item: EnrichedCandidate,
  edits: WorkstreamEdits,
  keptItemKeys: ReadonlySet<string>,
  stretchPrompt: StampedPrompt | undefined,
): string {
  const itemKey = linkKey(item);
  const facts = [
    item.repo === undefined ? undefined : `repo ${item.repo}`,
    item.repo === undefined && item.directory !== undefined ? `dir ${item.directory}` : undefined,
    item.branch === undefined ? undefined : `branch ${item.branch}`,
    item.status === undefined ? undefined : `status ${item.status}`,
    item.parentKey === undefined ? undefined : `parent ${item.parentKey}`,
    isLockedItem(edits, itemKey) ? "fixed by user" : undefined,
    keptItemKeys.has(itemKey) ? "kept by user" : undefined,
  ].filter((fact): fact is string => fact !== undefined);
  const titleFact = item.title === undefined ? [] : [`title "${clipLine(item.title, MAX_TOOL_CALL_CHARS)}"`];
  const firstSeenTime = compactTimestamp(item.firstSeen);
  const firstSeenFact = firstSeenTime === undefined ? [] : [`first seen ${firstSeenTime}`];
  const itemFacts = [...titleFact, ...firstSeenFact, ...facts];
  let entry = `\n- ${itemKey}${itemFacts.length === 0 ? "" : ` | ${itemFacts.join(" | ")}`}`;
  if (item.description !== undefined) {
    entry += `\n  description: ${clipLine(item.description, MAX_ITEM_PROMPT_CHARS)}`;
  }
  const firstSeenPromptText = item.promptBeforeFirstSeen === undefined ? undefined : clipLine(item.promptBeforeFirstSeen, MAX_ITEM_PROMPT_CHARS);
  const stretchPromptText = stretchPrompt === undefined ? undefined : clipLine(stretchPrompt.text, MAX_ITEM_PROMPT_CHARS);
  if (stretchPrompt !== undefined && stretchPromptText !== firstSeenPromptText) {
    entry += `\n  work began with user prompt [${compactTime(stretchPrompt.timeMs)}]: ${stretchPromptText}`;
  }
  if (firstSeenPromptText !== undefined) {
    entry += `\n  user prompt when first seen: ${firstSeenPromptText}`;
  }
  return entry;
}

function toolCallSummary(toolName: string, toolInput: Record<string, unknown>): string {
  if (toolName === "Bash" && typeof toolInput.command === "string") {
    return toolInput.command;
  }
  if (FILE_TOOL_NAMES.has(toolName) && typeof toolInput.file_path === "string") {
    return `${toolName} ${toolInput.file_path}`;
  }
  return `${toolName} ${JSON.stringify(toolInput)}`;
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

function parseRecord(line: string): TranscriptRecord | undefined {
  try {
    return JSON.parse(line) as TranscriptRecord;
  } catch {
    return undefined;
  }
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}
