import { isTicketKey } from "./ticket";

export const ANALYSIS_SCHEMA_VERSION = 2;
export const MAX_WHERE_LINES = 3;
export const MAX_WHERE_LINE_CHARS = 100;
export const MAX_WORKSTREAM_TITLE_CHARS = 80;
export const MAX_ARTIFACT_TITLE_CHARS = 40;
export const MAX_SEED_NOTE_CHARS = 160;
export const TICKET_ITEM_PREFIX = "ticket:";
const WORKSTREAM_ID_PREFIX = "ws-";
const TRAILING_PUNCTUATION_PATTERN = /[\s:;,.(\-–—]+$/;

// Item keys use the link key format: "pr:owner/repo/pull/1", "commit:abc1234", "artifact:<id>", "ticket:KEY".
export interface Workstream {
  id: string;
  title: string;
  ticketKeys: string[];
  itemKeys: string[];
  done: boolean;
}

export interface KnownItem {
  itemKey: string;
  note?: string;
  parentKey?: string;
}

// What the old declared files and link marks said. The model sees it as background; none of it is a user workstream edit.
export interface SeedFacts {
  knownItems: KnownItem[];
  keptItemKeys: string[];
  removedItemKeys: string[];
}

// sessionStatus holds a configured session status id.
export interface SessionAnalysis {
  workstreams: Workstream[];
  seedFacts: SeedFacts;
  artifactTitles: Record<string, string>;
  where: string[];
  sessionStatus?: string;
  sessionDone: boolean;
  watermarkBytes: number;
  lastPassAt?: number;
  lastModel?: string;
  nextWorkstreamNumber: number;
}

export function emptySeedFacts(): SeedFacts {
  return { knownItems: [], keptItemKeys: [], removedItemKeys: [] };
}

export function emptyAnalysis(): SessionAnalysis {
  return { workstreams: [], seedFacts: emptySeedFacts(), artifactTitles: {}, where: [], sessionDone: false, watermarkBytes: 0, nextWorkstreamNumber: 1 };
}

export function workstreamIdFor(workstreamNumber: number): string {
  return `${WORKSTREAM_ID_PREFIX}${workstreamNumber}`;
}

export function ticketItemKey(ticketKey: string): string {
  return `${TICKET_ITEM_PREFIX}${ticketKey}`;
}

// Accepts "ticket:KEY" or a bare "KEY".
export function ticketKeyOf(rawTicket: string): string | undefined {
  const trimmedTicket = rawTicket.trim();
  const bareKey = trimmedTicket.startsWith(TICKET_ITEM_PREFIX) ? trimmedTicket.slice(TICKET_ITEM_PREFIX.length) : trimmedTicket;
  const upperKey = bareKey.toUpperCase();
  return isTicketKey(upperKey) ? upperKey : undefined;
}

export function cleanWhereLines(rawLines: unknown[]): string[] {
  return rawLines
    .filter((line): line is string => typeof line === "string")
    .map((line) => clipLine(line, MAX_WHERE_LINE_CHARS))
    .filter((line) => line !== "")
    .slice(0, MAX_WHERE_LINES);
}

export function clipLine(text: string, maxLength: number): string {
  const singleLineText = text.replace(/\s+/g, " ").trim();
  return singleLineText.length <= maxLength ? singleLineText : `${singleLineText.slice(0, maxLength - 1)}…`;
}

// A name cut mid-word or with an ellipsis reads as broken, so a long one ends at its last whole word.
export function trimToWholeWords(text: string, maxLength: number): string {
  const singleLineText = text.replace(/\s+/g, " ").trim();
  if (singleLineText.length <= maxLength) {
    return singleLineText;
  }
  const lastSpaceIndex = singleLineText.lastIndexOf(" ", maxLength);
  const wholeWordsText = lastSpaceIndex > 0 ? singleLineText.slice(0, lastSpaceIndex) : singleLineText.slice(0, maxLength);
  const trimmedText = wholeWordsText.replace(TRAILING_PUNCTUATION_PATTERN, "");
  return trimmedText === "" ? wholeWordsText : trimmedText;
}

export function workstreamOfItem(analysis: SessionAnalysis, itemKey: string): Workstream | undefined {
  return analysis.workstreams.find((workstream) => workstream.itemKeys.includes(itemKey));
}

// A file edited by hand or written by a newer version must never break the sidebar, so bad parts drop out.
export function readSessionAnalysis(entries: unknown): SessionAnalysis {
  if (typeof entries !== "object" || entries === null) {
    return emptyAnalysis();
  }
  const fields = entries as Record<string, unknown>;
  const workstreams = readWorkstreams(fields.workstreams);
  const highestWorkstreamNumber = Math.max(0, ...workstreams.map((workstream) => workstreamNumberOf(workstream.id)));
  const savedNextNumber = typeof fields.nextWorkstreamNumber === "number" ? Math.floor(fields.nextWorkstreamNumber) : 1;
  const analysis: SessionAnalysis = {
    workstreams,
    seedFacts: readSeedFacts(fields.seedFacts),
    artifactTitles: readStringRecord(fields.artifactTitles),
    where: cleanWhereLines(Array.isArray(fields.where) ? fields.where : []),
    sessionDone: fields.sessionDone === true,
    watermarkBytes: isNonNegativeNumber(fields.watermarkBytes) ? fields.watermarkBytes : 0,
    nextWorkstreamNumber: Math.max(savedNextNumber, highestWorkstreamNumber + 1),
  };
  if (typeof fields.sessionStatus === "string" && fields.sessionStatus !== "") {
    analysis.sessionStatus = fields.sessionStatus;
  }
  if (isNonNegativeNumber(fields.lastPassAt)) {
    analysis.lastPassAt = fields.lastPassAt;
  }
  if (typeof fields.lastModel === "string" && fields.lastModel !== "") {
    analysis.lastModel = fields.lastModel;
  }
  return analysis;
}

function readWorkstreams(value: unknown): Workstream[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const workstreams: Workstream[] = [];
  const claimedItemKeys = new Set<string>();
  for (const entry of value) {
    const fields = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
    const { id, title } = fields;
    const isDuplicateId = workstreams.some((workstream) => workstream.id === id);
    if (typeof id !== "string" || id === "" || isDuplicateId || typeof title !== "string" || title.trim() === "") {
      continue;
    }
    // An item sits in one workstream at most; the first one wins.
    const itemKeys = readStrings(fields.itemKeys).filter((itemKey) => !claimedItemKeys.has(itemKey));
    itemKeys.forEach((itemKey) => claimedItemKeys.add(itemKey));
    const ticketKeys = readStrings(fields.ticketKeys).flatMap((rawKey) => ticketKeyOf(rawKey) ?? []);
    workstreams.push({
      id,
      title: clipLine(title, MAX_WORKSTREAM_TITLE_CHARS),
      ticketKeys: [...new Set(ticketKeys)],
      itemKeys,
      done: fields.done === true,
    });
  }
  return workstreams;
}

function readSeedFacts(value: unknown): SeedFacts {
  const fields = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const knownItems: KnownItem[] = [];
  for (const entry of Array.isArray(fields.knownItems) ? fields.knownItems : []) {
    const itemFields = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
    const { itemKey, note, parentKey } = itemFields;
    if (typeof itemKey !== "string" || itemKey === "" || knownItems.some((knownItem) => knownItem.itemKey === itemKey)) {
      continue;
    }
    const knownItem: KnownItem = { itemKey };
    if (typeof note === "string" && note.trim() !== "") {
      knownItem.note = clipLine(note, MAX_SEED_NOTE_CHARS);
    }
    if (typeof parentKey === "string" && parentKey !== "") {
      knownItem.parentKey = parentKey;
    }
    knownItems.push(knownItem);
  }
  return { knownItems, keptItemKeys: readStrings(fields.keptItemKeys), removedItemKeys: readStrings(fields.removedItemKeys) };
}

function workstreamNumberOf(workstreamId: string): number {
  const numberText = workstreamId.startsWith(WORKSTREAM_ID_PREFIX) ? workstreamId.slice(WORKSTREAM_ID_PREFIX.length) : "";
  const workstreamNumber = Number(numberText);
  return Number.isInteger(workstreamNumber) && workstreamNumber > 0 ? workstreamNumber : 0;
}

function readStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item !== ""))];
}

function readStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== ""),
  );
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
