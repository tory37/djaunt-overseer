import { describe, expect, it } from "vitest";
import { PinnedSession } from "../../src/grouping";
import { SessionMeta } from "../../src/indexer";
import { collectRepos, sessionRepoRoots } from "../../src/repoSet";

const GIT_ROOTS: Record<string, string> = {
  "/src/api": "/src/api",
  "/src/api/packages/core": "/src/api",
  "/src/web": "/src/web",
};
const gitRootOf = (directory: string): string | undefined => GIT_ROOTS[directory];

function claudeSession(sessionId: string, meta: Partial<SessionMeta>): PinnedSession {
  const fullMeta = { sessionId, startCwd: "/tmp", resumeCwd: undefined, homeRepo: undefined, otherReposTouched: [], lastActivityMs: 0, ...meta };
  return { sessionId, meta: fullMeta as SessionMeta, label: undefined, pending: undefined };
}

function terminalSession(sessionId: string, cwd: string, createdAtMs: number): PinnedSession {
  return { sessionId, meta: undefined, label: undefined, pending: undefined, terminal: { cwd, createdAtMs } };
}

describe("repo set", () => {
  it("uses the indexed home repo and the repos a session touched", () => {
    const session = claudeSession("a", { homeRepo: "/src/api", otherReposTouched: ["/src/web"] });
    expect(sessionRepoRoots(session, gitRootOf)).toEqual(["/src/api", "/src/web"]);
  });

  it("falls back to the git root of the session's directory", () => {
    const session = claudeSession("a", { startCwd: "/src/api/packages/core" });
    expect(sessionRepoRoots(session, gitRootOf)).toEqual(["/src/api"]);
  });

  it("finds no repo for a directory outside git", () => {
    expect(sessionRepoRoots(terminalSession("t", "/Users/me", 1), gitRootOf)).toEqual([]);
  });

  it("merges sessions and terminals into one entry per repo, newest first", () => {
    const repos = collectRepos(
      [
        claudeSession("a", { homeRepo: "/src/api", lastActivityMs: 100 }),
        claudeSession("b", { homeRepo: "/src/web", otherReposTouched: ["/src/api"], lastActivityMs: 300 }),
        terminalSession("t", "/src/api/packages/core", 500),
      ],
      gitRootOf,
    );
    expect(repos).toEqual([
      { root: "/src/api", name: "api", sessionIds: ["a", "b", "t"], lastActivityMs: 500 },
      { root: "/src/web", name: "web", sessionIds: ["b"], lastActivityMs: 300 },
    ]);
  });
});
