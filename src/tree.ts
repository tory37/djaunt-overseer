import * as path from "path";
import * as vscode from "vscode";
import { formatAge } from "./format";
import { buildGroups, PinnedSession, SessionGroup } from "./grouping";
import { displayTitle, SessionMeta } from "./indexer";
import { tildePath } from "./paths";
import { GroupRef, Registry } from "./registry";
import { SessionIndex } from "./sessionIndex";
import { findSessionTerminal } from "./terminals";

export type TreeNode =
  | { kind: "group"; group: SessionGroup }
  | { kind: "session"; pinned: PinnedSession; groupRef: GroupRef };

const SESSION_DRAG_MIME = "application/vnd.code.tree.overseer.sessions";
const SHORT_ID_LENGTH = 8;

export class SessionTreeProvider
  implements vscode.TreeDataProvider<TreeNode>, vscode.TreeDragAndDropController<TreeNode>
{
  readonly dragMimeTypes = [SESSION_DRAG_MIME];
  readonly dropMimeTypes = [SESSION_DRAG_MIME];
  private readonly treeChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.treeChangeEmitter.event;

  constructor(
    private readonly sessionIndex: SessionIndex,
    private readonly registry: Registry,
  ) {}

  refresh(): void {
    this.treeChangeEmitter.fire();
  }

  getChildren(parentNode?: TreeNode): TreeNode[] {
    if (parentNode === undefined) {
      return this.currentGroups().map((group) => ({ kind: "group", group }));
    }
    if (parentNode.kind === "group") {
      return parentNode.group.sessions.map((pinned) => ({
        kind: "session",
        pinned,
        groupRef: parentNode.group.ref,
      }));
    }
    return [];
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    return node.kind === "group" ? groupTreeItem(node.group) : sessionTreeItem(node.pinned);
  }

  handleDrag(sourceNodes: readonly TreeNode[], dataTransfer: vscode.DataTransfer): void {
    const draggedSessionIds = sourceNodes
      .filter((node): node is Extract<TreeNode, { kind: "session" }> => node.kind === "session")
      .map((node) => node.pinned.sessionId);
    if (draggedSessionIds.length > 0) {
      dataTransfer.set(SESSION_DRAG_MIME, new vscode.DataTransferItem(draggedSessionIds));
    }
  }

  async handleDrop(targetNode: TreeNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const draggedSessionIds = dataTransfer.get(SESSION_DRAG_MIME)?.value as string[] | undefined;
    if (targetNode === undefined || draggedSessionIds === undefined) {
      return;
    }
    const targetGroupRef = targetNode.kind === "group" ? targetNode.group.ref : targetNode.groupRef;
    await this.registry.assign(draggedSessionIds, targetGroupRef);
  }

  private currentGroups(): SessionGroup[] {
    const sessionsById = new Map<string, SessionMeta>(
      this.sessionIndex.currentSessions.map((meta) => [meta.sessionId, meta]),
    );
    return buildGroups({
      pinnedSessionIds: this.registry.pinnedSessionIds(),
      sessionsById,
      userGroups: this.registry.userGroups(),
      assignments: this.registry.assignments(),
    });
  }

  dispose(): void {
    this.treeChangeEmitter.dispose();
  }
}

function groupTreeItem(group: SessionGroup): vscode.TreeItem {
  const treeItem = new vscode.TreeItem(group.label, vscode.TreeItemCollapsibleState.Expanded);
  treeItem.id = `group:${group.ref}`;
  treeItem.description = String(group.sessions.length);
  treeItem.iconPath = new vscode.ThemeIcon(group.kind === "auto" ? "tag" : "folder");
  treeItem.contextValue = `group.${group.kind}`;
  return treeItem;
}

function sessionTreeItem(pinned: PinnedSession): vscode.TreeItem {
  const isRunning = findSessionTerminal(pinned.sessionId) !== undefined;
  const label = pinned.meta ? displayTitle(pinned.meta) : `Session ${pinned.sessionId.slice(0, SHORT_ID_LENGTH)}`;
  const treeItem = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  treeItem.id = `session:${pinned.sessionId}`;
  treeItem.description = sessionDescription(pinned.meta);
  treeItem.tooltip = sessionTooltip(pinned, isRunning);
  treeItem.iconPath = isRunning
    ? new vscode.ThemeIcon("terminal", new vscode.ThemeColor("terminal.ansiGreen"))
    : new vscode.ThemeIcon("debug-pause");
  treeItem.contextValue = isRunning ? "session.running" : "session.suspended";
  if (isRunning) {
    treeItem.command = { command: "overseer.focusSession", title: "Focus", arguments: [pinned.sessionId] };
  }
  return treeItem;
}

function sessionDescription(meta: SessionMeta | undefined): string {
  if (meta === undefined) {
    return "not found in index";
  }
  const repoName = path.basename(meta.resumeCwd ?? meta.startCwd);
  return [repoName, meta.gitBranch].filter((part) => part !== undefined && part !== "").join(" · ");
}

function sessionTooltip(pinned: PinnedSession, isRunning: boolean): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString();
  const meta = pinned.meta;
  if (meta === undefined) {
    tooltip.appendMarkdown(`Session \`${pinned.sessionId}\``);
    return tooltip;
  }
  tooltip.appendMarkdown(`**${escapeMarkdown(displayTitle(meta))}**\n\n`);
  tooltip.appendMarkdown(`${isRunning ? "Running" : "Suspended"} · last active ${formatAge(meta.lastActivityMs)}\n\n`);
  tooltip.appendMarkdown(`\`${tildePath(meta.resumeCwd ?? meta.startCwd)}\``);
  if (meta.gitBranch) {
    tooltip.appendMarkdown(` on \`${meta.gitBranch}\``);
  }
  if (meta.prUrl) {
    tooltip.appendMarkdown(`\n\n[Pull request](${meta.prUrl})`);
  }
  if (meta.firstPrompt && meta.firstPrompt !== displayTitle(meta)) {
    tooltip.appendMarkdown(`\n\n---\n\n${escapeMarkdown(meta.firstPrompt)}`);
  }
  return tooltip;
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, "\\$&");
}
