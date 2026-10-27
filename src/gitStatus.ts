export interface BranchStatus {
  branch: string | undefined;
  headShortHash: string | undefined;
  hasUpstream: boolean;
  aheadCount: number;
  behindCount: number;
  changedFileCount: number;
}

export interface CommitEntry {
  hash: string;
  shortHash: string;
  author: string;
  committedAtMs: number;
  subject: string;
  refs: string[];
}

const FIELD_SEPARATOR = "\x1f";
const RECORD_SEPARATOR = "\x1e";
const SHORT_HASH_LENGTH = 7;
const AHEAD_BEHIND_PATTERN = /^\+(\d+) -(\d+)$/;
// `git commit` prints "[branch abc1234] subject"; a root commit adds "(root-commit)" before the hash.
const COMMIT_OUTPUT_PATTERN = /\[([^\]\s]+)(?: \(root-commit\))? ([0-9a-f]{7,40})\] /g;
// Claude Code also records the commit it saw on the tool result, when it recognized one.
const GIT_OPERATION_PATTERN = /"gitOperation":\{"commit":\{"sha":"([0-9a-f]{7,40})"/g;
const GITHUB_REMOTE_PATTERN = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/;

export const LOG_FORMAT = ["%H", "%h", "%an", "%ct", "%s", "%D"].join("%x1f") + "%x1e";

// Without --no-optional-locks, status rewrites .git/index, which the watcher would see as a new change.
export function statusArgs(repoRoot: string): string[] {
  return ["--no-optional-locks", "-C", repoRoot, "status", "--porcelain=v2", "--branch"];
}

export function logArgs(repoRoot: string, commitLimit: number): string[] {
  return ["-C", repoRoot, "log", `-n${commitLimit}`, `--format=${LOG_FORMAT}`];
}

// --ignore-missing skips hashes from other repos, so one call per repo looks up every hash the session printed.
export function describeCommitsArgs(repoRoot: string, hashes: string[]): string[] {
  return ["-C", repoRoot, "log", "--no-walk", "--ignore-missing", `--format=${LOG_FORMAT}`, ...hashes];
}

export function showArgs(repoRoot: string, hash: string): string[] {
  return ["-C", repoRoot, "show", "--stat", "--patch", "--format=fuller", hash];
}

export function parseBranchStatus(porcelainText: string): BranchStatus {
  const status: BranchStatus = {
    branch: undefined,
    headShortHash: undefined,
    hasUpstream: false,
    aheadCount: 0,
    behindCount: 0,
    changedFileCount: 0,
  };
  for (const line of porcelainText.split("\n")) {
    if (line.startsWith("# branch.oid ")) {
      const headHash = line.slice("# branch.oid ".length);
      status.headShortHash = headHash === "(initial)" ? undefined : headHash.slice(0, SHORT_HASH_LENGTH);
    } else if (line.startsWith("# branch.head ")) {
      const headName = line.slice("# branch.head ".length);
      status.branch = headName === "(detached)" ? undefined : headName;
    } else if (line.startsWith("# branch.upstream ")) {
      status.hasUpstream = true;
    } else if (line.startsWith("# branch.ab ")) {
      const aheadBehind = AHEAD_BEHIND_PATTERN.exec(line.slice("# branch.ab ".length));
      status.aheadCount = Number(aheadBehind?.[1] ?? 0);
      status.behindCount = Number(aheadBehind?.[2] ?? 0);
    } else if (line !== "" && !line.startsWith("#") && !line.startsWith("!")) {
      status.changedFileCount++;
    }
  }
  return status;
}

export function branchStatusLabel(status: BranchStatus): string {
  const headLabel = status.branch ?? (status.headShortHash === undefined ? "no commits" : `detached ${status.headShortHash}`);
  const parts = [headLabel];
  if (status.hasUpstream && (status.aheadCount > 0 || status.behindCount > 0)) {
    const arrows = [status.aheadCount > 0 ? `↑${status.aheadCount}` : "", status.behindCount > 0 ? `↓${status.behindCount}` : ""];
    parts.push(arrows.filter((arrow) => arrow !== "").join(" "));
  }
  if (status.changedFileCount > 0) {
    parts.push(`${status.changedFileCount} changed`);
  }
  return parts.join(" · ");
}

export function parseLog(logText: string): CommitEntry[] {
  const commits: CommitEntry[] = [];
  for (const record of logText.split(RECORD_SEPARATOR)) {
    const fields = record.replace(/^\n/, "").split(FIELD_SEPARATOR);
    if (fields.length < 6 || fields[0] === "") {
      continue;
    }
    const [hash, shortHash, author, committedAtSeconds, subject, refNames] = fields;
    commits.push({
      hash,
      shortHash,
      author,
      committedAtMs: Number(committedAtSeconds) * 1000,
      subject,
      refs: refNames === "" ? [] : refNames.split(", ").map((refName) => refName.trim()),
    });
  }
  return commits;
}

export function commitHashesIn(text: string): string[] {
  const printedHashes = [...text.matchAll(COMMIT_OUTPUT_PATTERN)].map((match) => match[2]);
  const recordedHashes = [...text.matchAll(GIT_OPERATION_PATTERN)].map((match) => match[1]);
  return [...new Set([...printedHashes, ...recordedHashes])];
}

export interface PrintedCommit {
  shortHash: string;
  branch: string;
  subject: string;
}

// Expects real newlines, so pass decoded tool output, not a raw transcript line.
export function printedCommitsIn(text: string): PrintedCommit[] {
  return [...text.matchAll(COMMIT_OUTPUT_PATTERN)].map((match) => {
    const subjectStart = match.index + match[0].length;
    const subjectEnd = text.indexOf("\n", subjectStart);
    const subject = text.slice(subjectStart, subjectEnd === -1 ? undefined : subjectEnd).trim();
    return { shortHash: match[2], branch: match[1], subject };
  });
}

export interface CommitAuthorship {
  shortHash: string;
  sessionId: string;
}

// Keyed by the 7-character prefix every printed short hash has, so a lookup checks only a few candidates.
export function indexCommitAuthorship(commitHashesBySession: Map<string, string[]>): Map<string, CommitAuthorship[]> {
  const authorshipByPrefix = new Map<string, CommitAuthorship[]>();
  for (const [sessionId, shortHashes] of commitHashesBySession) {
    for (const shortHash of shortHashes) {
      const prefix = shortHash.slice(0, SHORT_HASH_LENGTH);
      authorshipByPrefix.set(prefix, [...(authorshipByPrefix.get(prefix) ?? []), { shortHash, sessionId }]);
    }
  }
  return authorshipByPrefix;
}

// A transcript keeps the short hash git printed; it names the commit whose full hash starts with it.
export function commitSessionId(commitHash: string, authorshipByPrefix: Map<string, CommitAuthorship[]>): string | undefined {
  const candidates = authorshipByPrefix.get(commitHash.slice(0, SHORT_HASH_LENGTH)) ?? [];
  return candidates.find((candidate) => commitHash.startsWith(candidate.shortHash))?.sessionId;
}

export function githubCommitUrl(remoteUrl: string, hash: string): string | undefined {
  const remoteMatch = GITHUB_REMOTE_PATTERN.exec(remoteUrl.trim());
  return remoteMatch === null ? undefined : `https://github.com/${remoteMatch[1]}/${remoteMatch[2]}/commit/${hash}`;
}
