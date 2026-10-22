import * as path from "path";
import * as vscode from "vscode";
import { buildSectionGroups, PinnedSession, pinnedSessionTitle, SessionGroup, SessionSection } from "./grouping";
import { SessionMeta } from "./indexer";
import { LiveSession } from "./liveParse";
import { LiveSessionMonitor } from "./liveSessions";
import { GroupRef, Registry, TerminalSession } from "./registry";
import { moveBeside } from "./reorder";
import { otherReposLabel } from "./repoFilter";
import { SessionIconState, sessionIconName, sessionIconSpec } from "./sessionIcons";
import { CompactMonitor } from "./compactMonitor";
import { SessionIndex } from "./sessionIndex";
import { SessionLinkService } from "./sessionLinks";
import { sessionStatusFor, sessionStatusUri } from "./sessionStatusView";
import { MarkedStatus } from "./sessionStatuses";
import { findSessionTerminal } from "./terminals";

export type TreeNode =
  | { kind: "group"; group: SessionGroup }
  | { kind: "session"; pinned: PinnedSession; groupRef: GroupRef };

type SessionNode = Extract<TreeNode, { kind: "session" }>;
type GroupNode = Extract<TreeNode, { kind: "group" }>;

interface DraggedSession {
  sessionId: string;
  groupRef: GroupRef;
}

interface DragPayload {
  draggedSessions: DraggedSession[];
  draggedGroupRefs: GroupRef[];
}

const TREE_DRAG_MIME = "application/vnd.code.tree.overseer.sessions";

export class SessionTreeProvider
  implements vscode.TreeDataProvider<TreeNode>, vscode.TreeDragAndDropController<TreeNode>
{
  readonly dragMimeTypes = [TREE_DRAG_MIME];
  readonly dropMimeTypes = [TREE_DRAG_MIME];
  private readonly treeChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.treeChangeEmitter.event;

  constructor(
    private readonly section: SessionSection,
    private readonly sessionIndex: SessionIndex,
    private readonly liveMonitor: LiveSessionMonitor,
    private readonly registry: Registry,
    private readonly linkService: SessionLinkService,
    private readonly compactMonitor: CompactMonitor,
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
    if (node.kind === "group") {
      return groupTreeItem(node.group, this.registry.isGroupCollapsed(this.collapseKey(node.group.ref)));
    }
    const status = sessionStatusFor(this.registry, node.pinned.sessionId);
    if (node.pinned.terminal !== undefined) {
      return terminalTreeItem(node.pinned, node.pinned.terminal, status);
    }
    return sessionTreeItem(
      node.pinned,
      this.liveMonitor.get(node.pinned.sessionId),
      this.compactMonitor.isCompacting(node.pinned.sessionId),
      status,
    );
  }

  handleDrag(sourceNodes: readonly TreeNode[], dataTransfer: vscode.DataTransfer): void {
    const draggedSessions = sourceNodes
      .filter((node): node is SessionNode => node.kind === "session")
      .map((node) => ({ sessionId: node.pinned.sessionId, groupRef: node.groupRef }));
    const draggedGroupRefs = sourceNodes
      .filter((node): node is GroupNode => node.kind === "group")
      .map((node) => node.group.ref);
    const payload: DragPayload = { draggedSessions, draggedGroupRefs };
    dataTransfer.set(TREE_DRAG_MIME, new vscode.DataTransferItem(payload));
  }

  async handleDrop(targetNode: TreeNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const payload = dataTransfer.get(TREE_DRAG_MIME)?.value as DragPayload | undefined;
    if (payload === undefined) {
      return;
    }
    if (payload.draggedSessions.length > 0) {
      await this.dropSessions(payload.draggedSessions, targetNode);
    } else if (payload.draggedGroupRefs.length > 0) {
      await this.dropGroups(payload.draggedGroupRefs, targetNode);
    }
  }

  private async dropSessions(draggedSessions: DraggedSession[], targetNode: TreeNode | undefined): Promise<void> {
    if (targetNode === undefined) {
      return;
    }
    const targetGroupRef = nodeGroupRef(targetNode);
    const draggedSessionIds = draggedSessions.map((dragged) => dragged.sessionId);
    const targetGroup = this.currentGroups().find((group) => group.ref === targetGroupRef);
    const targetGroupSessionIds = targetGroup?.sessions.map((pinned) => pinned.sessionId) ?? [];
    const movedIntoGroupIds = draggedSessions
      .filter((dragged) => dragged.groupRef !== targetGroupRef)
      .map((dragged) => dragged.sessionId);
    if (movedIntoGroupIds.length > 0) {
      await this.registry.assign(movedIntoGroupIds, targetGroupRef);
    }

    const reorderedGroupSessionIds =
      targetNode.kind === "group"
        ? [...draggedSessionIds, ...targetGroupSessionIds.filter((sessionId) => !draggedSessionIds.includes(sessionId))]
        : moveBeside(targetGroupSessionIds, draggedSessionIds, nodeSessionId(targetNode));
    const otherOrderedSessionIds = this.registry
      .sessionOrder()
      .filter((sessionId) => !reorderedGroupSessionIds.includes(sessionId));
    await this.registry.setSessionOrder([...otherOrderedSessionIds, ...reorderedGroupSessionIds]);
  }

  private async dropGroups(draggedGroupRefs: GroupRef[], targetNode: TreeNode | undefined): Promise<void> {
    const targetGroupRef = targetNode === undefined ? undefined : nodeGroupRef(targetNode);
    const displayedGroupRefs = this.currentGroups().map((group) => group.ref);
    const reorderedGroupRefs = moveBeside(displayedGroupRefs, draggedGroupRefs, targetGroupRef);
    const otherGroupRefs = this.registry.groupOrder().filter((groupRef) => !reorderedGroupRefs.includes(groupRef));
    await this.registry.setGroupOrder([...reorderedGroupRefs, ...otherGroupRefs]);
  }

  async saveExpansion(node: TreeNode, isExpanded: boolean): Promise<void> {
    if (node.kind === "group") {
      await this.registry.setGroupCollapsed(this.collapseKey(node.group.ref), !isExpanded);
    }
  }

  // A group can show in both views, and each view keeps its own collapsed state for it.
  private collapseKey(groupRef: GroupRef): string {
    return this.section === "terminal" ? `terminal|${groupRef}` : groupRef;
  }

  // TreeView.reveal walks up from the node it shows, so every node needs its parent.
  getParent(node: TreeNode): TreeNode | undefined {
    if (node.kind === "group") {
      return undefined;
    }
    const parentGroup = this.currentGroups().find((group) => group.ref === node.groupRef);
    return parentGroup === undefined ? undefined : { kind: "group", group: parentGroup };
  }

  sessionNode(sessionId: string): SessionNode | undefined {
    for (const group of this.currentGroups()) {
      const pinned = group.sessions.find((session) => session.sessionId === sessionId);
      if (pinned !== undefined) {
        return { kind: "session", pinned, groupRef: group.ref };
      }
    }
    return undefined;
  }

  pinnedSessions(): PinnedSession[] {
    return this.currentGroups().flatMap((group) => group.sessions);
  }

  private currentGroups(): SessionGroup[] {
    const sessionsById = new Map<string, SessionMeta>(
      this.sessionIndex.currentSessions.map((meta) => [meta.sessionId, meta]),
    );
    const pinnedSessionIds = this.registry.pinnedSessionIdsInActiveWorkspace();
    return buildSectionGroups(
      {
        pinnedSessionIds,
        sessionsById,
        userGroups: this.registry.userGroupsInActiveWorkspace(),
        assignments: this.registry.assignments(),
        labels: this.registry.labels(),
        pendingSessions: this.registry.pendingSessions(),
        terminalSessions: this.registry.terminalSessions(),
        groupOrder: this.registry.groupOrder(),
        sessionOrder: this.registry.sessionOrder(),
        linkedTicketKeys: this.linkService.ownedTicketKeys(
          pinnedSessionIds.filter((sessionId) => this.registry.hasFoundResources(sessionId)),
        ),
      },
      this.section,
    );
  }

  dispose(): void {
    this.treeChangeEmitter.dispose();
  }
}

function nodeGroupRef(node: TreeNode): GroupRef {
  return node.kind === "group" ? node.group.ref : node.groupRef;
}

function nodeSessionId(node: SessionNode): string {
  return node.pinned.sessionId;
}

function groupTreeItem(group: SessionGroup, isCollapsed: boolean): vscode.TreeItem {
  const collapsibleState = isCollapsed
    ? vscode.TreeItemCollapsibleState.Collapsed
    : vscode.TreeItemCollapsibleState.Expanded;
  const treeItem = new vscode.TreeItem(group.label, collapsibleState);
  treeItem.id = `group:${group.ref}`;
  treeItem.description = String(group.sessions.length);
  treeItem.iconPath = new vscode.ThemeIcon(group.kind === "auto" ? "tag" : "folder");
  treeItem.contextValue = `group.${group.kind}`;
  return treeItem;
}

type SessionState = Exclude<SessionIconState, "duplicate" | "compacting">;

function sessionState(sessionId: string, liveSession: LiveSession | undefined): SessionState {
  const hasTerminalHere = findSessionTerminal(sessionId) !== undefined;
  if (hasTerminalHere) {
    return liveSession?.status === "busy" ? "working" : "running";
  }
  return liveSession === undefined ? "suspended" : "elsewhere";
}

function sessionStateIcon(state: SessionIconState): vscode.ThemeIcon {
  const configuredName = vscode.workspace.getConfiguration("overseer.sessionIcons").get<string>(state);
  return new vscode.ThemeIcon(sessionIconName(state, configuredName), new vscode.ThemeColor(sessionIconSpec(state).colorId));
}

function sessionTreeItem(
  pinned: PinnedSession,
  liveSession: LiveSession | undefined,
  isCompacting: boolean,
  status: MarkedStatus | undefined,
): vscode.TreeItem {
  const state = sessionState(pinned.sessionId, liveSession);
  // The menu still follows the running state; only the icon and tooltip say compacting.
  const iconState: SessionIconState = isCompacting && liveSession !== undefined ? "compacting" : state;
  const treeItem = new vscode.TreeItem(pinnedSessionTitle(pinned), vscode.TreeItemCollapsibleState.None);
  treeItem.id = `session:${pinned.sessionId}`;
  treeItem.resourceUri = sessionStatusUri(pinned.sessionId);
  treeItem.description = sessionDescription(pinned);
  treeItem.tooltip = sessionTooltip(pinned, sessionIconSpec(iconState).label, status);
  treeItem.iconPath = sessionStateIcon(iconState);
  treeItem.contextValue = `session.${state}`;
  const copyCount = liveSession?.processCount ?? 0;
  if (copyCount > 1) {
    treeItem.iconPath = sessionStateIcon("duplicate");
    treeItem.description = `${copyCount} copies running · ${treeItem.description}`;
  }
  treeItem.command = { command: "overseer.clickSession", title: "Open", arguments: [pinned.sessionId] };
  return treeItem;
}

function terminalTreeItem(pinned: PinnedSession, terminalSession: TerminalSession, status: MarkedStatus | undefined): vscode.TreeItem {
  const isOpen = findSessionTerminal(pinned.sessionId) !== undefined;
  const treeItem = new vscode.TreeItem(pinnedSessionTitle(pinned), vscode.TreeItemCollapsibleState.None);
  treeItem.id = `session:${pinned.sessionId}`;
  treeItem.resourceUri = sessionStatusUri(pinned.sessionId);
  treeItem.description = `${path.basename(terminalSession.cwd)} · terminal`;
  const iconColorId = sessionIconSpec(isOpen ? "running" : "suspended").colorId;
  treeItem.iconPath = new vscode.ThemeIcon("terminal-bash", new vscode.ThemeColor(iconColorId));
  treeItem.tooltip = sessionTooltip(pinned, `Terminal ${isOpen ? "open" : "closed"}`, status);
  treeItem.contextValue = `terminal.${isOpen ? "open" : "closed"}`;
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

// The Session sidebar holds the details; the hover only names the session and its state.
function sessionTooltip(pinned: PinnedSession, stateLabel: string, status: MarkedStatus | undefined): vscode.MarkdownString {
  const statusSuffix = status === undefined ? "" : ` · $(${status.icon}) ${escapeMarkdown(status.name)}`;
  const tooltip = new vscode.MarkdownString(`**${escapeMarkdown(pinnedSessionTitle(pinned))}** · ${stateLabel}${statusSuffix}`);
  tooltip.supportThemeIcons = true;
  return tooltip;
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, "\\$&");
}
