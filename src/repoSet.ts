import * as path from "path";
import type { GitRootResolver } from "./gitRoots";
import { lastActivityMs, PinnedSession } from "./grouping";

export interface RepoEntry {
  root: string;
  name: string;
  sessionIds: string[];
  lastActivityMs: number;
}

// The directory whose git root stands in for a session that the indexer has not tied to a repo.
export function sessionDirectory(pinned: PinnedSession): string | undefined {
  return pinned.meta?.resumeCwd ?? pinned.meta?.startCwd ?? pinned.pending?.cwd ?? pinned.terminal?.cwd;
}

// Repos come from the index when it knows them, else from the git root of the session's directory.
export function sessionRepoRoots(pinned: PinnedSession, gitRootOf: (directory: string) => string | undefined): string[] {
  const directory = sessionDirectory(pinned);
  const homeRepo = pinned.meta?.homeRepo ?? (directory === undefined ? undefined : gitRootOf(directory));
  const otherRepos = pinned.meta?.otherReposTouched ?? [];
  return [...new Set([homeRepo, ...otherRepos].filter((repo): repo is string => repo !== undefined))];
}

// One entry per repo, most recently active first.
export function collectRepos(
  pinnedSessions: PinnedSession[],
  gitRootOf: (directory: string) => string | undefined,
): RepoEntry[] {
  const reposByRoot = new Map<string, RepoEntry>();
  for (const pinned of pinnedSessions) {
    const activityMs = lastActivityMs(pinned);
    for (const root of sessionRepoRoots(pinned, gitRootOf)) {
      const repo = reposByRoot.get(root) ?? { root, name: path.basename(root), sessionIds: [], lastActivityMs: 0 };
      repo.sessionIds.push(pinned.sessionId);
      repo.lastActivityMs = Math.max(repo.lastActivityMs, activityMs);
      reposByRoot.set(root, repo);
    }
  }
  return [...reposByRoot.values()].sort(
    (left, right) => right.lastActivityMs - left.lastActivityMs || left.name.localeCompare(right.name),
  );
}


export async function resolveRepos(pinnedSessions: PinnedSession[], resolveGitRoot: GitRootResolver): Promise<RepoEntry[]> {
  const directories = [...new Set(pinnedSessions.map(sessionDirectory).filter((directory): directory is string => directory !== undefined))];
  const rootByDirectory = new Map(
    await Promise.all(directories.map(async (directory) => [directory, await resolveGitRoot(directory)] as const)),
  );
  return collectRepos(pinnedSessions, (directory) => rootByDirectory.get(directory));
}
