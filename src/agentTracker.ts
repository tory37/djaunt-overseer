import * as path from "path";
import { formatAge } from "./format";

const OVERSEER_DIR_NAME = "overseer";
const WHERE_DIR_NAME = "where";
export const AGENT_TRACKER_SCHEMA_VERSION = 1;
export const MAX_WHERE_LINES = 3;
export const MAX_WHERE_LINE_CHARS = 100;
export const DONE_HISTORY_MS = 7 * 24 * 60 * 60 * 1000;

// Where one session stands, in the agent's own short lines. doneAt marks the work finished.
export interface SessionWhere {
  lines: string[];
  updatedAt: number;
  doneAt?: number;
}

// One session's row in the tracker, with the names the extension knows and the agent doesn't.
export interface TrackerEntry {
  sessionId: string;
  name: string;
  repo?: string;
  branch?: string;
  statusName?: string;
  where: SessionWhere;
}

export function whereDir(claudeHome: string): string {
  return path.join(claudeHome, OVERSEER_DIR_NAME, WHERE_DIR_NAME);
}

export function whereFile(claudeHome: string, sessionId: string): string {
  return path.join(whereDir(claudeHome), `${sessionId}.json`);
}

export function cleanWhereLines(rawLines: unknown[]): string[] {
  return rawLines
    .filter((line): line is string => typeof line === "string")
    .map((line) => singleLine(line).slice(0, MAX_WHERE_LINE_CHARS).trim())
    .filter((line) => line !== "")
    .slice(0, MAX_WHERE_LINES);
}

export function readSessionWhere(entries: unknown): SessionWhere | undefined {
  if (typeof entries !== "object" || entries === null) {
    return undefined;
  }
  const { lines, updatedAt, doneAt } = entries as Record<string, unknown>;
  if (typeof updatedAt !== "number") {
    return undefined;
  }
  return {
    lines: cleanWhereLines(Array.isArray(lines) ? lines : []),
    updatedAt,
    ...(typeof doneAt === "number" ? { doneAt } : {}),
  };
}

// New lines mean the work goes on, so they clear an earlier done.
export function withWhereLines(rawLines: string[], now: number): SessionWhere {
  return { lines: cleanWhereLines(rawLines), updatedAt: now };
}

export function withWhereDone(where: SessionWhere | undefined, now: number): SessionWhere {
  return { lines: where?.lines ?? [], updatedAt: now, doneAt: now };
}

export function isExpiredDone(where: SessionWhere, now: number): boolean {
  return where.doneAt !== undefined && now - where.doneAt > DONE_HISTORY_MS;
}

export function pruneTrackerEntries(entries: TrackerEntry[], now: number): TrackerEntry[] {
  return entries.filter((entry) => !isExpiredDone(entry.where, now));
}

export function formatWhereShow(where: SessionWhere | undefined): string {
  if (where === undefined || (where.lines.length === 0 && where.doneAt === undefined)) {
    return "No tracker lines set for this session.";
  }
  const lineTexts = where.lines.length === 0 ? ["  none"] : where.lines.map((line) => `  ${line}`);
  return [where.doneAt === undefined ? "Where this session is:" : "Where this session is (done):", ...lineTexts].join("\n");
}

export function renderTracker(entries: TrackerEntry[], now: number): string {
  const keptEntries = pruneTrackerEntries(entries, now);
  const activeEntries = keptEntries.filter((entry) => entry.where.doneAt === undefined);
  const doneEntries = keptEntries.filter((entry) => entry.where.doneAt !== undefined);
  activeEntries.sort((left, right) => right.where.updatedAt - left.where.updatedAt);
  doneEntries.sort((left, right) => (right.where.doneAt ?? 0) - (left.where.doneAt ?? 0));
  return [
    "# Overseer tracker",
    "",
    "## Active",
    "",
    ...trackerSection(activeEntries.map((entry) => activeEntryLines(entry, now))),
    "",
    "## Done",
    "",
    ...trackerSection(doneEntries.map((entry) => doneEntryLines(entry, now))),
    "",
  ].join("\n");
}

function trackerSection(entryLines: string[][]): string[] {
  return entryLines.length === 0 ? ["_None._"] : entryLines.flat();
}

function activeEntryLines(entry: TrackerEntry, now: number): string[] {
  const title = `**${singleLine(entry.name)}**`;
  const details = [...entryDetails(entry), ...(entry.statusName === undefined ? [] : [singleLine(entry.statusName)])];
  const heading = [title, ...details, formatAge(entry.where.updatedAt, now)].join(" · ");
  return [`- ${heading}`, ...entry.where.lines.map((line) => `  - ${line}`)];
}

function doneEntryLines(entry: TrackerEntry, now: number): string[] {
  const title = `~~**${singleLine(entry.name)}**~~`;
  const heading = [title, ...entryDetails(entry), `done ${formatAge(entry.where.doneAt ?? entry.where.updatedAt, now)}`].join(" · ");
  return [`- ${heading}`, ...entry.where.lines.map((line) => `  - ~~${line}~~`)];
}

function entryDetails(entry: TrackerEntry): string[] {
  return [
    ...(entry.repo === undefined ? [] : [singleLine(entry.repo)]),
    ...(entry.branch === undefined ? [] : [`\`${singleLine(entry.branch)}\``]),
  ];
}

function singleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
