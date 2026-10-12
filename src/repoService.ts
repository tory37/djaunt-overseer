import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { BranchStatus, CommitEntry, logArgs, parseBranchStatus, parseLog, showArgs, statusArgs } from "./gitStatus";
import { ConcurrencyLimiter } from "./linkView";
import { RepoEntry } from "./repoSet";

export type RepoStatus = { kind: "loading" } | { kind: "ready"; branchStatus: BranchStatus } | { kind: "failed"; message: string };

const GIT_BINARY = "git";
const GIT_TIMEOUT_MS = 15_000;
const GIT_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const MAX_GIT_RUNS = 4;
// A commit or checkout writes many files under .git; one refresh after the burst is enough.
const WATCH_DEBOUNCE_MS = 1_000;
export const COMMIT_LIMIT = 20;

// Runs git for each repo in the tree, and reruns it when the repo's .git folder changes.
export class RepoService implements vscode.Disposable {
  private repos: RepoEntry[] = [];
  private readonly statusByRoot = new Map<string, RepoStatus>();
  private readonly commitsByRoot = new Map<string, Promise<CommitEntry[]>>();
  private readonly watcherByRoot = new Map<string, fs.FSWatcher>();
  private readonly debounceTimerByRoot = new Map<string, NodeJS.Timeout>();
  private readonly staleRoots = new Set<string>();
  private readonly limiter = new ConcurrencyLimiter(MAX_GIT_RUNS);
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private isVisible = false;

  constructor(private readonly log: vscode.OutputChannel) {}

  currentRepos(): RepoEntry[] {
    return this.repos;
  }

  status(repoRoot: string): RepoStatus {
    return this.statusByRoot.get(repoRoot) ?? { kind: "loading" };
  }

  commits(repoRoot: string): Promise<CommitEntry[]> {
    const cachedCommits = this.commitsByRoot.get(repoRoot);
    if (cachedCommits !== undefined) {
      return cachedCommits;
    }
    const pendingCommits = this.runGit(logArgs(repoRoot, COMMIT_LIMIT))
      .then(parseLog)
      .catch((error: unknown) => {
        this.log.appendLine(`git log failed in ${repoRoot}: ${firstLine(error)}`);
        this.commitsByRoot.delete(repoRoot);
        return [];
      });
    this.commitsByRoot.set(repoRoot, pendingCommits);
    return pendingCommits;
  }

  showCommit(repoRoot: string, hash: string): Promise<string> {
    return this.runGit(showArgs(repoRoot, hash));
  }

  remoteUrl(repoRoot: string): Promise<string | undefined> {
    return this.runGit(["-C", repoRoot, "remote", "get-url", "origin"]).then(
      (remoteText) => remoteText.trim() || undefined,
      () => undefined,
    );
  }

  setRepos(repos: RepoEntry[]): void {
    if (repoListKey(repos) === repoListKey(this.repos)) {
      return;
    }
    const nextRoots = new Set(repos.map((repo) => repo.root));
    for (const root of this.watcherByRoot.keys()) {
      if (!nextRoots.has(root)) {
        this.forget(root);
      }
    }
    const addedRoots = repos.map((repo) => repo.root).filter((root) => !this.watcherByRoot.has(root));
    this.repos = repos;
    for (const root of addedRoots) {
      this.watch(root);
      this.staleRoots.add(root);
    }
    this.refreshStale();
    this.changeEmitter.fire();
  }

  // Hidden views skip git runs; whatever changed meanwhile refreshes when the view shows again.
  setVisible(isVisible: boolean): void {
    this.isVisible = isVisible;
    this.refreshStale();
  }

  refreshAll(): void {
    for (const repo of this.repos) {
      this.markStale(repo.root);
    }
  }

  private markStale(root: string): void {
    this.staleRoots.add(root);
    this.commitsByRoot.delete(root);
    this.refreshStale();
  }

  private refreshStale(): void {
    if (!this.isVisible) {
      return;
    }
    const staleRoots = [...this.staleRoots];
    this.staleRoots.clear();
    for (const root of staleRoots) {
      void this.refreshStatus(root);
    }
  }

  private async refreshStatus(root: string): Promise<void> {
    try {
      const branchStatus = parseBranchStatus(await this.runGit(statusArgs(root)));
      this.statusByRoot.set(root, { kind: "ready", branchStatus });
    } catch (error) {
      this.statusByRoot.set(root, { kind: "failed", message: firstLine(error) });
    }
    this.commitsByRoot.delete(root);
    this.changeEmitter.fire();
  }

  private watch(root: string): void {
    try {
      const watcher = fs.watch(path.join(root, ".git"), { recursive: true }, (_eventType, changedFile) => {
        if (changedFile !== null && isNoiseFile(changedFile)) {
          return;
        }
        clearTimeout(this.debounceTimerByRoot.get(root));
        this.debounceTimerByRoot.set(
          root,
          setTimeout(() => this.markStale(root), WATCH_DEBOUNCE_MS),
        );
      });
      watcher.on("error", () => watcher.close());
      this.watcherByRoot.set(root, watcher);
    } catch (error) {
      this.log.appendLine(`Can't watch ${root}/.git: ${String(error)}`);
    }
  }

  private forget(root: string): void {
    this.watcherByRoot.get(root)?.close();
    this.watcherByRoot.delete(root);
    clearTimeout(this.debounceTimerByRoot.get(root));
    this.debounceTimerByRoot.delete(root);
    this.statusByRoot.delete(root);
    this.commitsByRoot.delete(root);
    this.staleRoots.delete(root);
  }

  private runGit(args: string[]): Promise<string> {
    return this.limiter.run(
      () =>
        new Promise((resolve, reject) => {
          execFile(GIT_BINARY, args, { timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER_BYTES }, (error, stdout, stderr) => {
            if (error) {
              reject(new Error(stderr.trim() || error.message));
            } else {
              resolve(stdout);
            }
          });
        }),
    );
  }

  dispose(): void {
    for (const root of [...this.watcherByRoot.keys()]) {
      this.forget(root);
    }
    this.changeEmitter.dispose();
  }
}

function repoListKey(repos: RepoEntry[]): string {
  return JSON.stringify(repos.map((repo) => [repo.root, repo.sessionIds]));
}

// Object writes and lock files never change status on their own; the ref or index write that follows does.
function isNoiseFile(changedFile: string): boolean {
  return changedFile.startsWith("objects") || changedFile.endsWith(".lock");
}

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0];
}
