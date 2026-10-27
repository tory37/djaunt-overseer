import * as path from "path";
import { cleanWhereLines } from "./analysisState";
import { artifactUrlParts } from "./linkCandidates";
import { isTicketKey } from "./ticket";

const OVERSEER_DIR_NAME = "overseer";
const DECLARED_DIR_NAME = "declared";
const WORK_DIR_NAME = "work";
const WHERE_DIR_NAME = "where";
export const LEGACY_SCHEMA_VERSION = 1;
const COMMIT_HASH_PATTERN = /^[0-9a-f]{7,40}$/;
const PR_URL_PATTERN = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/;

export interface DeclaredTicket {
  key: string;
  note?: string;
  parentKey?: string;
  addedAt: number;
}

export interface DeclaredCommit {
  hash: string;
  note?: string;
  addedAt: number;
}

// A PR's parent is the ticket it implements; an artifact's parent is a ticket key or a PR URL.
export interface DeclaredLink {
  url: string;
  note?: string;
  parentKey?: string;
  addedAt: number;
}

export interface SessionWork {
  commits: DeclaredCommit[];
  pullRequests: DeclaredLink[];
  artifacts: DeclaredLink[];
}

// Where one session stood, in the agent's own short lines. doneAt marks the work finished.
export interface SessionWhere {
  lines: string[];
  updatedAt: number;
  doneAt?: number;
}

export function declaredTicketsFile(claudeHome: string, sessionId: string): string {
  return path.join(claudeHome, OVERSEER_DIR_NAME, DECLARED_DIR_NAME, `${sessionId}.json`);
}

export function declaredWorkFile(claudeHome: string, sessionId: string): string {
  return path.join(claudeHome, OVERSEER_DIR_NAME, WORK_DIR_NAME, `${sessionId}.json`);
}

export function whereFile(claudeHome: string, sessionId: string): string {
  return path.join(claudeHome, OVERSEER_DIR_NAME, WHERE_DIR_NAME, `${sessionId}.json`);
}

// Keeps only the PR itself, so ".../pull/12/files" and ".../pull/12" are the same PR.
export function normalizePullRequestUrl(rawUrl: string): string | undefined {
  const match = PR_URL_PATTERN.exec(rawUrl.trim());
  return match === null ? undefined : `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`;
}

export function readDeclaredTickets(entries: unknown): DeclaredTicket[] {
  if (!Array.isArray(entries)) {
    return [];
  }
  const declaredTickets: DeclaredTicket[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const { key, note, parentKey, addedAt } = entry as Record<string, unknown>;
    if (typeof key !== "string" || !isTicketKey(key)) {
      continue;
    }
    const isValidParent = typeof parentKey === "string" && isTicketKey(parentKey) && parentKey !== key;
    declaredTickets.push({
      key,
      ...noteField(typeof note === "string" ? note : undefined),
      ...(isValidParent ? { parentKey } : {}),
      addedAt: typeof addedAt === "number" ? addedAt : 0,
    });
  }
  return declaredTickets;
}

export function readSessionWork(entries: unknown): SessionWork {
  const fields = typeof entries === "object" && entries !== null ? (entries as Record<string, unknown>) : {};
  return {
    commits: withoutDuplicateCommits(
      readEntries(fields.commits, "hash", normalizeCommitHash).map(({ id, note, addedAt }) => ({ hash: id, ...note, addedAt })),
    ),
    pullRequests: readEntries(fields.pullRequests, "url", normalizePullRequestUrl, normalizeTicketKey).map(
      ({ id, note, parent, addedAt }) => ({ url: id, ...note, ...parent, addedAt }),
    ),
    artifacts: readEntries(fields.artifacts, "url", normalizeArtifactUrl, normalizeArtifactParentKey).map(
      ({ id, note, parent, addedAt }) => ({ url: id, ...note, ...parent, addedAt }),
    ),
  };
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

function normalizeTicketKey(rawKey: string): string | undefined {
  const upperKey = rawKey.trim().toUpperCase();
  return isTicketKey(upperKey) ? upperKey : undefined;
}

function normalizeCommitHash(rawHash: string): string | undefined {
  const lowerHash = rawHash.trim().toLowerCase();
  return COMMIT_HASH_PATTERN.test(lowerHash) ? lowerHash : undefined;
}

function normalizeArtifactUrl(rawUrl: string): string | undefined {
  return artifactUrlParts(rawUrl)?.url;
}

function normalizeArtifactParentKey(rawParentKey: string): string | undefined {
  return normalizeTicketKey(rawParentKey) ?? normalizePullRequestUrl(rawParentKey);
}

interface ParsedEntry {
  id: string;
  note: { note?: string };
  parent: { parentKey?: string };
  addedAt: number;
}

type Normalizer = (rawValue: string) => string | undefined;

function readEntries(value: unknown, idField: string, normalizeId: Normalizer, normalizeParentKey?: Normalizer): ParsedEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const parsedEntries: ParsedEntry[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const fields = entry as Record<string, unknown>;
    const rawId = fields[idField];
    const id = typeof rawId === "string" ? normalizeId(rawId) : undefined;
    if (id === undefined) {
      continue;
    }
    const parentKey =
      normalizeParentKey !== undefined && typeof fields.parentKey === "string" ? normalizeParentKey(fields.parentKey) : undefined;
    parsedEntries.push({
      id,
      note: noteField(typeof fields.note === "string" ? fields.note : undefined),
      parent: parentKey === undefined || parentKey === id ? {} : { parentKey },
      addedAt: typeof fields.addedAt === "number" ? fields.addedAt : 0,
    });
  }
  return parsedEntries;
}

function withoutDuplicateCommits(commits: DeclaredCommit[]): DeclaredCommit[] {
  const uniqueCommits: DeclaredCommit[] = [];
  for (const commit of commits) {
    const duplicateIndex = uniqueCommits.findIndex((uniqueCommit) => isSameCommit(uniqueCommit.hash, commit.hash));
    if (duplicateIndex === -1) {
      uniqueCommits.push(commit);
      continue;
    }
    uniqueCommits[duplicateIndex] = mergedDuplicateCommit(uniqueCommits[duplicateIndex], commit);
  }
  return uniqueCommits;
}

function mergedDuplicateCommit(firstCommit: DeclaredCommit, secondCommit: DeclaredCommit): DeclaredCommit {
  const [olderCommit, newerCommit] = firstCommit.addedAt <= secondCommit.addedAt ? [firstCommit, secondCommit] : [secondCommit, firstCommit];
  const longerHash = firstCommit.hash.length >= secondCommit.hash.length ? firstCommit.hash : secondCommit.hash;
  return { hash: longerHash, ...noteField(newerCommit.note ?? olderCommit.note), addedAt: olderCommit.addedAt };
}

// One hash abbreviates the other, as with "09fd90e" and "09fd90e1".
function isSameCommit(leftHash: string, rightHash: string): boolean {
  const [shorter, longer] = leftHash.length <= rightHash.length ? [leftHash, rightHash] : [rightHash, leftHash];
  return longer.startsWith(shorter);
}

function noteField(note: string | undefined): { note?: string } {
  return note !== undefined && note.length > 0 ? { note } : {};
}
