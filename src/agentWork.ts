import * as path from "path";
import { normalizeTicketKey } from "./agentTickets";
import { artifactUrlParts } from "./linkCandidates";

const OVERSEER_DIR_NAME = "overseer";
const WORK_DIR_NAME = "work";
export const AGENT_WORK_SCHEMA_VERSION = 1;
const COMMIT_HASH_PATTERN = /^[0-9a-f]{7,40}$/;
const PR_URL_PATTERN = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/;

export interface DeclaredCommit {
  hash: string;
  note?: string;
  addedAt: number;
}

// A PR's parent is the ticket it implements.
export interface DeclaredPullRequest {
  url: string;
  note?: string;
  parentKey?: string;
  addedAt: number;
}

// An artifact's parent is a ticket key or a PR URL.
export interface DeclaredArtifact {
  url: string;
  note?: string;
  parentKey?: string;
  addedAt: number;
}

// populatedAt marks a session whose whole history was read once, so an empty list means "none", not "not tracked".
export interface SessionWork {
  commits: DeclaredCommit[];
  pullRequests: DeclaredPullRequest[];
  artifacts: DeclaredArtifact[];
  populatedAt?: number;
}

export type TrackedKind = "tickets" | "commits" | "pullRequests";

export const TRACKED_KIND_LABELS: Record<TrackedKind, string> = { tickets: "tickets", commits: "commits", pullRequests: "pull requests" };

export const EMPTY_SESSION_WORK: SessionWork = { commits: [], pullRequests: [], artifacts: [] };

export function declaredWorkDir(claudeHome: string): string {
  return path.join(claudeHome, OVERSEER_DIR_NAME, WORK_DIR_NAME);
}

export function declaredWorkFile(claudeHome: string, sessionId: string): string {
  return path.join(declaredWorkDir(claudeHome), `${sessionId}.json`);
}

export function normalizeCommitHash(rawHash: string): string | undefined {
  const lowerHash = rawHash.trim().toLowerCase();
  return COMMIT_HASH_PATTERN.test(lowerHash) ? lowerHash : undefined;
}

// Keeps only the PR itself, so ".../pull/12/files" and ".../pull/12" are the same PR.
export function normalizePullRequestUrl(rawUrl: string): string | undefined {
  const match = PR_URL_PATTERN.exec(rawUrl.trim());
  return match === null ? undefined : `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`;
}

export function normalizeArtifactUrl(rawUrl: string): string | undefined {
  return artifactUrlParts(rawUrl)?.url;
}

export function normalizeArtifactParentKey(rawParentKey: string): string | undefined {
  return normalizeTicketKey(rawParentKey) ?? normalizePullRequestUrl(rawParentKey);
}

export function pullRequestLabel(url: string): string {
  const match = PR_URL_PATTERN.exec(url);
  return match === null ? url : `${match[1]}/${match[2]}#${match[3]}`;
}

export function readSessionWork(entries: unknown): SessionWork {
  const fields = typeof entries === "object" && entries !== null ? (entries as Record<string, unknown>) : {};
  return {
    commits: readEntries(fields.commits, "hash", normalizeCommitHash).map(({ id, note, addedAt }) => ({ hash: id, ...note, addedAt })),
    pullRequests: readEntries(fields.pullRequests, "url", normalizePullRequestUrl, normalizeTicketKey).map(
      ({ id, note, parent, addedAt }) => ({ url: id, ...note, ...parent, addedAt }),
    ),
    artifacts: readEntries(fields.artifacts, "url", normalizeArtifactUrl, normalizeArtifactParentKey).map(
      ({ id, note, parent, addedAt }) => ({ url: id, ...note, ...parent, addedAt }),
    ),
    ...(typeof fields.populatedAt === "number" ? { populatedAt: fields.populatedAt } : {}),
  };
}

// Declaring again updates the note but keeps when it was first declared.
export function withDeclaredCommit(work: SessionWork, hash: string, note: string | undefined, now: number): SessionWork {
  const existingCommit = work.commits.find((commit) => commit.hash === hash);
  const updatedCommit: DeclaredCommit = { hash, ...noteField(note ?? existingCommit?.note), addedAt: existingCommit?.addedAt ?? now };
  const commits =
    existingCommit === undefined
      ? [...work.commits, updatedCommit]
      : work.commits.map((commit) => (commit.hash === hash ? updatedCommit : commit));
  return { ...work, commits };
}

export function withoutDeclaredCommit(work: SessionWork, hash: string): SessionWork {
  return { ...work, commits: work.commits.filter((commit) => commit.hash !== hash) };
}

export function withDeclaredPullRequest(
  work: SessionWork,
  url: string,
  note: string | undefined,
  now: number,
  parentKey?: string,
): SessionWork {
  const existingPullRequest = work.pullRequests.find((pullRequest) => pullRequest.url === url);
  const updatedPullRequest: DeclaredPullRequest = {
    url,
    ...noteField(note ?? existingPullRequest?.note),
    ...parentField(parentKey ?? existingPullRequest?.parentKey),
    addedAt: existingPullRequest?.addedAt ?? now,
  };
  const pullRequests =
    existingPullRequest === undefined
      ? [...work.pullRequests, updatedPullRequest]
      : work.pullRequests.map((pullRequest) => (pullRequest.url === url ? updatedPullRequest : pullRequest));
  return { ...work, pullRequests };
}

export function withoutDeclaredPullRequest(work: SessionWork, url: string): SessionWork {
  return { ...work, pullRequests: work.pullRequests.filter((pullRequest) => pullRequest.url !== url) };
}

export function withDeclaredArtifact(
  work: SessionWork,
  url: string,
  note: string | undefined,
  now: number,
  parentKey?: string,
): SessionWork {
  const existingArtifact = work.artifacts.find((artifact) => artifact.url === url);
  const updatedArtifact: DeclaredArtifact = {
    url,
    ...noteField(note ?? existingArtifact?.note),
    ...parentField(parentKey ?? existingArtifact?.parentKey),
    addedAt: existingArtifact?.addedAt ?? now,
  };
  const artifacts =
    existingArtifact === undefined
      ? [...work.artifacts, updatedArtifact]
      : work.artifacts.map((artifact) => (artifact.url === url ? updatedArtifact : artifact));
  return { ...work, artifacts };
}

// Keeps every target entry and adds the incoming ones it doesn't have yet.
export function mergeSessionWork(targetWork: SessionWork, incomingWork: SessionWork): SessionWork {
  const targetHashes = new Set(targetWork.commits.map((commit) => commit.hash));
  const targetUrls = new Set(targetWork.pullRequests.map((pullRequest) => pullRequest.url));
  const targetArtifactUrls = new Set(targetWork.artifacts.map((artifact) => artifact.url));
  const populatedAt = targetWork.populatedAt ?? incomingWork.populatedAt;
  return {
    commits: [...targetWork.commits, ...incomingWork.commits.filter((commit) => !targetHashes.has(commit.hash))],
    pullRequests: [...targetWork.pullRequests, ...incomingWork.pullRequests.filter((pullRequest) => !targetUrls.has(pullRequest.url))],
    artifacts: [...targetWork.artifacts, ...incomingWork.artifacts.filter((artifact) => !targetArtifactUrls.has(artifact.url))],
    ...(populatedAt !== undefined ? { populatedAt } : {}),
  };
}

export function hasSessionWork(work: SessionWork): boolean {
  return work.commits.length > 0 || work.pullRequests.length > 0 || work.artifacts.length > 0 || work.populatedAt !== undefined;
}

// Before a populate run, a kind with nothing declared may be empty or may never have been tracked.
export function untrackedKinds(work: SessionWork, declaredTicketCount: number): TrackedKind[] {
  if (work.populatedAt !== undefined) {
    return [];
  }
  const counts: Record<TrackedKind, number> = {
    tickets: declaredTicketCount,
    commits: work.commits.length,
    pullRequests: work.pullRequests.length,
  };
  return (Object.keys(counts) as TrackedKind[]).filter((kind) => counts[kind] === 0);
}

export function formatWorkList(work: SessionWork): string {
  if (work.commits.length === 0 && work.pullRequests.length === 0 && work.artifacts.length === 0) {
    return "No commits or pull requests declared for this session.";
  }
  const lines: string[] = [];
  if (work.commits.length > 0) {
    lines.push("Commits:", ...work.commits.map((commit) => `  ${commit.hash}${noteSuffix(commit.note)}`));
  }
  if (work.pullRequests.length > 0) {
    lines.push("Pull requests:", ...work.pullRequests.map((pullRequest) => `  ${pullRequest.url}${noteSuffix(pullRequest.note)}`));
  }
  if (work.artifacts.length > 0) {
    lines.push("Artifacts:", ...work.artifacts.map((artifact) => `  ${artifact.url}${noteSuffix(artifact.note)}`));
  }
  return lines.join("\n");
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
      parent: parentField(parentKey === id ? undefined : parentKey),
      addedAt: typeof fields.addedAt === "number" ? fields.addedAt : 0,
    });
  }
  return parsedEntries;
}

function noteField(note: string | undefined): { note?: string } {
  return note !== undefined && note.length > 0 ? { note } : {};
}

function parentField(parentKey: string | undefined): { parentKey?: string } {
  return parentKey !== undefined && parentKey.length > 0 ? { parentKey } : {};
}

function noteSuffix(note: string | undefined): string {
  return note === undefined ? "" : `  (${note})`;
}
