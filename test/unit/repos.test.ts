import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGitRootResolver } from "../../src/gitRoots";
import { indexSessions, SessionMeta } from "../../src/indexer";
import { encodeProjectDir } from "../../src/paths";
import { matchesRepoQuery, otherReposLabel, parseRepoQuery } from "../../src/repoFilter";

const SESSION_ID = "0b3c1d52-7a8e-4f1e-9c2a-5d6e7f8a9b0c";

let sandboxRoot: string;
let projectsRoot: string;

beforeEach(() => {
  sandboxRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "overseer-repos-")));
  projectsRoot = path.join(sandboxRoot, "projects");
});

afterEach(() => {
  fs.rmSync(sandboxRoot, { recursive: true, force: true });
});

function makeRepo(repoName: string): string {
  const repoRoot = path.join(sandboxRoot, "src", repoName);
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  return repoRoot;
}

function makeWorktree(mainRepo: string, worktreeName: string): string {
  const worktreeRoot = path.join(mainRepo, ".claude", "worktrees", worktreeName);
  fs.mkdirSync(worktreeRoot, { recursive: true });
  fs.writeFileSync(path.join(worktreeRoot, ".git"), `gitdir: ${mainRepo}/.git/worktrees/${worktreeName}\n`);
  return worktreeRoot;
}

function editRecord(cwd: string, toolName: string, input: Record<string, unknown>): unknown {
  return {
    type: "assistant",
    cwd,
    message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: toolName, input }] },
  };
}

function writeTranscript(projectCwd: string, records: unknown[]): void {
  const projectPath = path.join(projectsRoot, encodeProjectDir(projectCwd));
  fs.mkdirSync(projectPath, { recursive: true });
  const lines = records.map((record) => JSON.stringify(record)).join("\n");
  fs.writeFileSync(path.join(projectPath, `${SESSION_ID}.jsonl`), lines + "\n");
}

describe("repos touched", () => {
  it("lists repos edited outside the home repo, deduped and sorted", async () => {
    const agentCollection = makeRepo("agent-tools");
    const webApp = makeRepo("web-app");
    const adminPortal = makeRepo("admin-portal");
    writeTranscript(agentCollection, [
      { type: "user", cwd: agentCollection, message: { role: "user", content: "triage" } },
      editRecord(agentCollection, "Edit", { file_path: path.join(agentCollection, "README.md") }),
      editRecord(agentCollection, "Write", { file_path: path.join(webApp, "src", "new-file.ts") }),
      editRecord(agentCollection, "MultiEdit", { file_path: path.join(webApp, "src", "other.ts") }),
      editRecord(agentCollection, "NotebookEdit", { notebook_path: path.join(adminPortal, "src", "a.ipynb") }),
      editRecord(agentCollection, "Read", { file_path: path.join(sandboxRoot, "src", "read-only", "x.ts") }),
    ]);

    const { sessions } = await indexSessions(projectsRoot, {});

    expect(sessions[0].homeRepo).toBe(agentCollection);
    expect(sessions[0].otherReposTouched).toEqual([adminPortal, webApp]);
  });

  it("counts a repo the session moved into as touched", async () => {
    const agentCollection = makeRepo("agent-tools");
    const webApp = makeRepo("web-app");
    writeTranscript(agentCollection, [
      { type: "user", cwd: agentCollection, message: { role: "user", content: "go" } },
      { type: "assistant", cwd: path.join(webApp, "src") },
    ]);

    const { sessions } = await indexSessions(projectsRoot, {});

    expect(sessions[0].otherReposTouched).toEqual([webApp]);
  });

  it("ignores edits outside any git repo", async () => {
    const agentCollection = makeRepo("agent-tools");
    const loosePath = path.join(sandboxRoot, "plans", "plan.md");
    writeTranscript(agentCollection, [
      { type: "user", cwd: agentCollection, message: { role: "user", content: "go" } },
      editRecord(agentCollection, "Write", { file_path: loosePath }),
    ]);

    const { sessions } = await indexSessions(projectsRoot, {});

    expect(sessions[0].otherReposTouched).toEqual([]);
  });

  it("maps a worktree to its main repo", async () => {
    const webApp = makeRepo("web-app");
    const worktree = makeWorktree(webApp, "proj-2567");
    const resolveGitRoot = createGitRootResolver();

    expect(await resolveGitRoot(path.join(worktree, "src"))).toBe(webApp);
  });
});

describe("repo query", () => {
  const meta = {
    homeRepo: "/src/agent-tools",
    otherReposTouched: ["/src/web-app"],
    startCwd: "/src/agent-tools",
    resumeCwd: "/src/agent-tools",
  } as SessionMeta;

  it("ignores text without a repo token", () => {
    expect(parseRepoQuery("login bug")).toBeUndefined();
    expect(parseRepoQuery("repo:")).toBeUndefined();
  });

  it("matches the home repo and touched repos by substring", () => {
    expect(matchesRepoQuery(meta, "", parseRepoQuery("repo:WEB")!)).toBe(true);
    expect(matchesRepoQuery(meta, "", parseRepoQuery("repo:agent")!)).toBe(true);
    expect(matchesRepoQuery(meta, "", parseRepoQuery("repo:admin")!)).toBe(false);
  });

  it("requires every remaining word in the item text", () => {
    const query = parseRepoQuery("login repo:web bug")!;
    expect(query.remainingTerms).toEqual(["login", "bug"]);
    expect(matchesRepoQuery(meta, "Fix the Login bug", query)).toBe(true);
    expect(matchesRepoQuery(meta, "Fix the login crash", query)).toBe(false);
  });

  it("labels the extra repo count", () => {
    expect(otherReposLabel(meta)).toBe("+1 repo");
    expect(otherReposLabel({ ...meta, otherReposTouched: ["/a", "/b"] })).toBe("+2 repos");
    expect(otherReposLabel({ ...meta, otherReposTouched: [] })).toBeUndefined();
  });
});
