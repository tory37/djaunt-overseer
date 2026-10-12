import * as vscode from "vscode";
import { branchStatusLabel } from "./gitStatus";
import { tildePath } from "./paths";
import { RepoService, RepoStatus } from "./repoService";
import { RepoEntry } from "./repoSet";

export type RepoTreeNode = { kind: "repo"; repo: RepoEntry };

export class RepoTreeProvider implements vscode.TreeDataProvider<RepoTreeNode>, vscode.Disposable {
  private readonly treeChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.treeChangeEmitter.event;
  private readonly serviceSubscription: vscode.Disposable;

  constructor(
    private readonly repoService: RepoService,
    private readonly sessionTitle: (sessionId: string) => string,
  ) {
    this.serviceSubscription = repoService.onDidChange(() => this.treeChangeEmitter.fire());
  }

  getChildren(node?: RepoTreeNode): RepoTreeNode[] {
    if (node !== undefined) {
      return [];
    }
    return this.repoService.currentRepos().map((repo) => ({ kind: "repo", repo }));
  }

  getTreeItem(node: RepoTreeNode): vscode.TreeItem {
    return repoTreeItem(node.repo, this.repoService.status(node.repo.root), this.sessionTitle);
  }

  dispose(): void {
    this.serviceSubscription.dispose();
    this.treeChangeEmitter.dispose();
  }
}

function repoTreeItem(repo: RepoEntry, status: RepoStatus, sessionTitle: (sessionId: string) => string): vscode.TreeItem {
  const treeItem = new vscode.TreeItem(repo.name, vscode.TreeItemCollapsibleState.None);
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
  const lines = [`**${repo.name}**`, "", `\`${tildePath(repo.root)}\``];
  if (status.kind === "failed") {
    lines.push("", `git failed: ${status.message}`);
  } else if (status.kind === "ready" && !status.branchStatus.hasUpstream && status.branchStatus.branch !== undefined) {
    lines.push("", "No upstream branch.");
  }
  lines.push("", "Sessions:", ...repo.sessionIds.map((sessionId) => `- ${sessionTitle(sessionId)}`));
  const tooltip = new vscode.MarkdownString(lines.join("\n"));
  tooltip.supportHtml = false;
  return tooltip;
}
