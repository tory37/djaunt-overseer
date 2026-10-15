import * as path from "path";
import { displayTitle, SessionMeta } from "./indexer";
import { tildePath } from "./paths";
import { parseRepoQuery, sessionRepoNames } from "./repoFilter";

export type HistoryScope = "all" | "pinned" | "live";
export type HistoryLiveState = "busy" | "idle";

export interface HistoryStatus {
  name: string;
  icon: string;
  colorVariable: string;
  reason: string | undefined;
}

export interface HistoryRow {
  sessionId: string;
  title: string;
  repoName: string;
  repoNames: string[];
  branch: string | undefined;
  folder: string;
  lastActivityMs: number;
  sizeBytes: number;
  firstPrompt: string | undefined;
  lastPrompt: string | undefined;
  recap: string | undefined;
  prUrl: string | undefined;
  commitHashes: string[];
  isPinned: boolean;
  liveState: HistoryLiveState | undefined;
  status: HistoryStatus | undefined;
}

export interface HistoryRowContext {
  label: string | undefined;
  isPinned: boolean;
  liveState: HistoryLiveState | undefined;
  status: HistoryStatus | undefined;
}

export interface HistoryQuery {
  searchText: string;
  scope: HistoryScope;
  repoName: string | undefined;
  olderThanDays: number | undefined;
  nowMs: number;
}

export interface DeletionCandidates {
  deletableIds: string[];
  pinnedIds: string[];
  liveIds: string[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function historyRow(meta: SessionMeta, context: HistoryRowContext): HistoryRow {
  const sessionCwd = meta.resumeCwd ?? meta.startCwd;
  return {
    sessionId: meta.sessionId,
    title: context.label ?? displayTitle(meta),
    repoName: path.basename(sessionCwd),
    repoNames: sessionRepoNames(meta),
    branch: meta.gitBranch,
    folder: tildePath(sessionCwd),
    lastActivityMs: meta.lastActivityMs,
    sizeBytes: meta.sizeBytes,
    firstPrompt: meta.firstPrompt,
    lastPrompt: meta.lastPrompt,
    recap: meta.recap?.text,
    prUrl: meta.prUrl,
    commitHashes: meta.commitHashes,
    isPinned: context.isPinned,
    liveState: context.liveState,
    status: context.status,
  };
}

function searchableText(row: HistoryRow): string {
  const fields = [
    row.title,
    row.sessionId,
    row.branch,
    row.folder,
    row.firstPrompt,
    row.lastPrompt,
    row.recap,
    row.prUrl,
    row.status?.name,
    ...row.repoNames,
  ];
  return fields.filter((field) => field !== undefined).join("\n").toLowerCase();
}

function isInScope(row: HistoryRow, scope: HistoryScope): boolean {
  if (scope === "pinned") {
    return row.isPinned;
  }
  if (scope === "live") {
    return row.liveState !== undefined;
  }
  return true;
}

// Every search term must appear somewhere in the row. A repo: term matches any repo the session touched.
export function matchingSessionIds(rows: HistoryRow[], query: HistoryQuery): string[] {
  const repoQuery = parseRepoQuery(query.searchText);
  const searchTerms = repoQuery?.remainingTerms ?? query.searchText.toLowerCase().split(/\s+/).filter((term) => term !== "");
  const lowerRepoName = query.repoName?.toLowerCase();
  const cutoffMs = query.olderThanDays === undefined ? undefined : query.nowMs - query.olderThanDays * MS_PER_DAY;
  return rows
    .filter((row) => isInScope(row, query.scope))
    .filter((row) => cutoffMs === undefined || row.lastActivityMs < cutoffMs)
    .filter((row) => lowerRepoName === undefined || row.repoNames.some((repoName) => repoName.toLowerCase() === lowerRepoName))
    .filter(
      (row) =>
        repoQuery === undefined || row.repoNames.some((repoName) => repoName.toLowerCase().includes(repoQuery.repoTerm)),
    )
    .filter((row) => {
      const rowText = searchableText(row);
      return searchTerms.every((term) => rowText.includes(term));
    })
    .map((row) => row.sessionId);
}

export function newestFirst(rows: HistoryRow[]): HistoryRow[] {
  return [...rows].sort((left, right) => right.lastActivityMs - left.lastActivityMs);
}

// A running session is never deleted. A purge also spares pinned sessions; deleting one session by hand does not.
export function deletionCandidates(rows: HistoryRow[], sessionIds: string[], sparesPinned: boolean): DeletionCandidates {
  const rowsById = new Map(rows.map((row) => [row.sessionId, row]));
  const candidates: DeletionCandidates = { deletableIds: [], pinnedIds: [], liveIds: [] };
  for (const sessionId of sessionIds) {
    const row = rowsById.get(sessionId);
    if (row === undefined) {
      continue;
    }
    if (row.liveState !== undefined) {
      candidates.liveIds.push(sessionId);
    } else if (sparesPinned && row.isPinned) {
      candidates.pinnedIds.push(sessionId);
    } else {
      candidates.deletableIds.push(sessionId);
    }
  }
  return candidates;
}
