import * as path from "path";
import * as vscode from "vscode";
import { formatAge } from "./format";
import { buildGroups, PinnedSession, pinnedSessionTitle, SessionGroup } from "./grouping";
import { displayTitle, SessionMeta } from "./indexer";
import { LiveSession } from "./liveParse";
import { LiveSessionMonitor } from "./liveSessions";
import { tildePath } from "./paths";
import { GroupRef, Registry } from "./registry";
import { otherReposLabel } from "./repoFilter";
import { SessionIndex } from "./sessionIndex";
import { findSessionTerminal } from "./terminals";

export type TreeNode =
  | { kind: "group"; group: SessionGroup }
  | { kind: "session"; pinned: PinnedSession; groupRef: GroupRef };

const SESSION_DRAG_MIME = "application/vnd.code.tree.overseer.sessions";

export class SessionTreeProvider
  implements vscode.TreeDataProvider<TreeNode>, vscode.TreeDragAndDropController<TreeNode>
{
  readonly dragMimeTypes = [SESSION_DRAG_MIME];
  readonly dropMimeTypes = [SESSION_DRAG_MIME];
  private readonly treeChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.treeChangeEmitter.event;

  constructor(
    private readonly sessionIndex: SessionIndex,
    private readonly liveMonitor: LiveSessionMonitor,
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
    return node.kind === "group"
      ? groupTreeItem(node.group)
      : sessionTreeItem(node.pinned, this.liveMonitor.get(node.pinned.sessionId));
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
      labels: this.registry.labels(),
      pendingSessions: this.registry.pendingSessions(),
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

type SessionState = "working" | "running" | "elsewhere" | "suspended";

function sessionState(sessionId: string, liveSession: LiveSession | undefined): SessionState {
  const hasTerminalHere = findSessionTerminal(sessionId) !== undefined;
  if (hasTerminalHere) {
    return liveSession?.status === "busy" ? "working" : "running";
  }
  return liveSession === undefined ? "suspended" : "elsewhere";
}

const SESSION_STATE_ICONS: Record<SessionState, vscode.ThemeIcon> = {
  working: new vscode.ThemeIcon("loading~spin", new vscode.ThemeColor("terminal.ansiGreen")),
  running: new vscode.ThemeIcon("terminal", new vscode.ThemeColor("terminal.ansiGreen")),
  elsewhere: new vscode.ThemeIcon("window", new vscode.ThemeColor("terminal.ansiYellow")),
  suspended: new vscode.ThemeIcon("debug-pause"),
};

const SESSION_STATE_LABELS: Record<SessionState, string> = {
  working: "Working in this window",
  running: "Running in this window",
  elsewhere: "Running outside this window",
  suspended: "Suspended",
};

function sessionTreeItem(pinned: PinnedSession, liveSession: LiveSession | undefined): vscode.TreeItem {
  const state = sessionState(pinned.sessionId, liveSession);
  const treeItem = new vscode.TreeItem(pinnedSessionTitle(pinned), vscode.TreeItemCollapsibleState.None);
  treeItem.id = `session:${pinned.sessionId}`;
  treeItem.description = sessionDescription(pinned);
  treeItem.tooltip = sessionTooltip(pinned, SESSION_STATE_LABELS[state]);
  treeItem.iconPath = SESSION_STATE_ICONS[state];
  treeItem.contextValue = `session.${state}`;
  const copyCount = liveSession?.processCount ?? 0;
  if (copyCount > 1) {
    treeItem.iconPath = new vscode.ThemeIcon("warning", new vscode.ThemeColor("list.warningForeground"));
    treeItem.description = `${copyCount} copies running · ${treeItem.description}`;
  }
  treeItem.command = { command: "overseer.clickSession", title: "Open", arguments: [pinned.sessionId] };
  return treeItem;
}

function sessionDescription(pinned: PinnedSession): string {
  const meta = pinned.meta;
  if (meta === undefined) {
    return pinned.pending ? `${path.basename(pinned.pending.cwd)} · new` : "not found in index";
  }
  const repoName = path.basename(meta.resumeCwd ?? meta.startCwd);
  return [repoName, meta.gitBranch, otherReposLabel(meta)]
    .filter((part) => part !== undefined && part !== "")
    .join(" · ");
}

function sessionTooltip(pinned: PinnedSession, stateLabel: string): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString();
  const meta = pinned.meta;
  tooltip.appendMarkdown(`**${escapeMarkdown(pinnedSessionTitle(pinned))}**\n\n`);
  if (meta === undefined) {
    tooltip.appendMarkdown(`${stateLabel} · \`${pinned.pending ? tildePath(pinned.pending.cwd) : pinned.sessionId}\``);
    return tooltip;
  }
  tooltip.appendMarkdown(`${stateLabel} · last active ${formatAge(meta.lastActivityMs)}\n\n`);
  tooltip.appendMarkdown(`\`${tildePath(meta.resumeCwd ?? meta.startCwd)}\``);
  if (meta.gitBranch) {
    tooltip.appendMarkdown(` on \`${meta.gitBranch}\``);
  }
  if (meta.otherReposTouched.length > 0) {
    const otherRepoList = meta.otherReposTouched.map((repo) => `\`${tildePath(repo)}\``).join(", ");
    tooltip.appendMarkdown(`\n\nAlso touched ${otherRepoList}`);
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
