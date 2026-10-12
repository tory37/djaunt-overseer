import * as path from "path";
import * as vscode from "vscode";
import { formatAge } from "./format";
import { branchStatusLabel, CommitAuthorship, commitSessionId, CommitEntry } from "./gitStatus";
import { tildePath } from "./paths";
import { RepoService, RepoStatus } from "./repoService";
import { RepoEntry } from "./repoSet";

export type RepoTreeNode =
  | { kind: "repo"; repo: RepoEntry }
  | { kind: "commit"; repoRoot: string; commit: CommitEntry; sessionId: string | undefined };

export const COMMIT_DOCUMENT_SCHEME = "overseer-git";
const MAX_SUBJECT_LENGTH = 80;

export interface RepoTreeDependencies {
  repoService: RepoService;
  sessionTitle: (sessionId: string) => string;
  commitAuthorship: () => Map<string, CommitAuthorship[]>;
}

export class RepoTreeProvider implements vscode.TreeDataProvider<RepoTreeNode>, vscode.Disposable {
  private readonly treeChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.treeChangeEmitter.event;
  private readonly serviceSubscription: vscode.Disposable;

  constructor(private readonly dependencies: RepoTreeDependencies) {
    this.serviceSubscription = dependencies.repoService.onDidChange(() => this.treeChangeEmitter.fire());
  }

  // Attribution comes from the session index, so a new index refreshes the commit rows.
  refresh(): void {
    this.treeChangeEmitter.fire();
  }

  async getChildren(node?: RepoTreeNode): Promise<RepoTreeNode[]> {
    const { repoService, commitAuthorship } = this.dependencies;
    if (node === undefined) {
      return repoService.currentRepos().map((repo) => ({ kind: "repo", repo }));
    }
    if (node.kind === "commit") {
      return [];
    }
    const authorshipByPrefix = commitAuthorship();
    const commits = await repoService.commits(node.repo.root);
    return commits.map((commit) => ({
      kind: "commit",
      repoRoot: node.repo.root,
      commit,
      sessionId: commitSessionId(commit.hash, authorshipByPrefix),
    }));
  }

  getTreeItem(node: RepoTreeNode): vscode.TreeItem {
    const { repoService, sessionTitle } = this.dependencies;
    if (node.kind === "repo") {
      return repoTreeItem(node.repo, repoService.status(node.repo.root), sessionTitle);
    }
    return commitTreeItem(node, sessionTitle);
  }

  dispose(): void {
    this.serviceSubscription.dispose();
    this.treeChangeEmitter.dispose();
  }
}

// Serves `git show` for a commit as a read-only document, so a diff opens without the repo in Source Control.
export class CommitDocumentProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly repoService: RepoService) {}

  async provideTextDocumentContent(documentUri: vscode.Uri): Promise<string> {
    const { repoRoot, hash } = JSON.parse(documentUri.query) as { repoRoot: string; hash: string };
    try {
      return await this.repoService.showCommit(repoRoot, hash);
    } catch (error) {
      return `git show failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}

export function commitDocumentUri(repoRoot: string, commit: CommitEntry): vscode.Uri {
  return vscode.Uri.from({
    scheme: COMMIT_DOCUMENT_SCHEME,
    path: `/${path.basename(repoRoot)}/${commit.shortHash}.diff`,
    query: JSON.stringify({ repoRoot, hash: commit.hash }),
  });
}

function repoTreeItem(repo: RepoEntry, status: RepoStatus, sessionTitle: (sessionId: string) => string): vscode.TreeItem {
  const treeItem = new vscode.TreeItem(repo.name, vscode.TreeItemCollapsibleState.Collapsed);
  treeItem.id = `repo:${repo.root}`;
  treeItem.contextValue = "repo";
  if (status.kind === "loading") {
    treeItem.description = "loading…";
    treeItem.iconPath = new vscode.ThemeIcon("repo");
  } else if (status.kind === "failed") {
    treeItem.description = "git failed";
    treeItem.iconPath = new vscode.ThemeIcon("warning", new vscode.ThemeColor("problemsWarningIcon.foreground"));
  } else {
    const isDirty = status.branchStatus.changedFileCount > 0;
    treeItem.description = branchStatusLabel(status.branchStatus);
    treeItem.iconPath = isDirty
      ? new vscode.ThemeIcon("repo", new vscode.ThemeColor("gitDecoration.modifiedResourceForeground"))
      : new vscode.ThemeIcon("repo");
  }
  treeItem.tooltip = repoTooltip(repo, status, sessionTitle);
  return treeItem;
}

function repoTooltip(repo: RepoEntry, status: RepoStatus, sessionTitle: (sessionId: string) => string): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString();
  tooltip.appendMarkdown(`**${escapeMarkdown(repo.name)}**\n\n`);
  tooltip.appendCodeblock(tildePath(repo.root), "text");
  if (status.kind === "failed") {
    tooltip.appendMarkdown(`\n\ngit failed: ${escapeMarkdown(status.message)}`);
  } else if (status.kind === "ready" && !status.branchStatus.hasUpstream && status.branchStatus.branch !== undefined) {
    tooltip.appendMarkdown("\n\nNo upstream branch.");
  }
  const sessionLines = repo.sessionIds.map((sessionId) => `- ${escapeMarkdown(sessionTitle(sessionId))}`);
  tooltip.appendMarkdown(`\n\nSessions:\n\n${sessionLines.join("\n")}`);
  return tooltip;
}

function commitTreeItem(node: Extract<RepoTreeNode, { kind: "commit" }>, sessionTitle: (sessionId: string) => string): vscode.TreeItem {
  const { commit, sessionId, repoRoot } = node;
  const treeItem = new vscode.TreeItem(truncate(commit.subject, MAX_SUBJECT_LENGTH), vscode.TreeItemCollapsibleState.None);
  treeItem.id = `commit:${repoRoot}:${commit.hash}`;
  const madeBy = sessionId === undefined ? undefined : sessionTitle(sessionId);
  treeItem.description = [commit.shortHash, formatAge(commit.committedAtMs), madeBy].filter((part) => part !== undefined).join(" · ");
  treeItem.iconPath =
    sessionId === undefined
      ? new vscode.ThemeIcon("git-commit")
      : new vscode.ThemeIcon("sparkle", new vscode.ThemeColor("overseer.sessionRunning"));
  treeItem.contextValue = sessionId === undefined ? "commit" : "commit.session";
  treeItem.command = { command: "overseer.showCommit", title: "Show Commit", arguments: [node] };
  const tooltip = new vscode.MarkdownString();
  tooltip.appendMarkdown(`**${escapeMarkdown(commit.subject)}**\n\n`);
  tooltip.appendMarkdown(`${escapeMarkdown(commit.author)}, ${new Date(commit.committedAtMs).toLocaleString()}\n\n`);
  tooltip.appendCodeblock(commit.hash, "text");
  if (commit.refs.length > 0) {
    tooltip.appendMarkdown(`\n\n${commit.refs.map((ref) => `\`${ref}\``).join(" ")}`);
  }
  if (madeBy !== undefined) {
    tooltip.appendMarkdown(`\n\nMade by session: ${escapeMarkdown(madeBy)}`);
  }
  treeItem.tooltip = tooltip;
  return treeItem;
}

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, "\\$&");
}
