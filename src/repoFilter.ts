import * as path from "path";
import { SessionMeta } from "./indexer";

export interface RepoQuery {
  repoTerm: string;
  remainingTerms: string[];
}

const REPO_TOKEN_PATTERN = /(?:^|\s)repo:(\S+)/i;

export function parseRepoQuery(searchText: string): RepoQuery | undefined {
  const repoTokenMatch = REPO_TOKEN_PATTERN.exec(searchText);
  if (repoTokenMatch === null) {
    return undefined;
  }
  const remainingText = searchText.replace(repoTokenMatch[0], " ");
  return {
    repoTerm: repoTokenMatch[1].toLowerCase(),
    remainingTerms: remainingText.toLowerCase().split(/\s+/).filter((term) => term !== ""),
  };
}

export function sessionRepoNames(meta: SessionMeta): string[] {
  const homeRepo = meta.homeRepo ?? meta.resumeCwd ?? meta.startCwd;
  return [homeRepo, ...meta.otherReposTouched].map((repo) => path.basename(repo));
}

export function matchesRepoQuery(meta: SessionMeta, searchableText: string, query: RepoQuery): boolean {
  const touchesRepo = sessionRepoNames(meta).some((repoName) => repoName.toLowerCase().includes(query.repoTerm));
  if (!touchesRepo) {
    return false;
  }
  const lowerSearchableText = searchableText.toLowerCase();
  return query.remainingTerms.every((term) => lowerSearchableText.includes(term));
}

export function otherReposLabel(meta: SessionMeta): string | undefined {
  const otherRepoCount = meta.otherReposTouched.length;
  if (otherRepoCount === 0) {
    return undefined;
  }
  return otherRepoCount === 1 ? "+1 repo" : `+${otherRepoCount} repos`;
}
