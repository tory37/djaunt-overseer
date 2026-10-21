import * as path from "path";
import * as vscode from "vscode";
import { formatAge } from "./format";
import { buildSectionGroups, PinnedSession, pinnedSessionTitle, SessionGroup, SessionSection } from "./grouping";
import { displayTitle, SessionMeta } from "./indexer";
import { linkCountBadge, MarkedLink } from "./linkView";
import { LiveSession } from "./liveParse";
import { LiveSessionMonitor } from "./liveSessions";
import { tildePath } from "./paths";
import { GroupRef, Registry, TerminalSession } from "./registry";
import { moveBeside } from "./reorder";
import { otherReposLabel } from "./repoFilter";
import { SessionIconState, sessionIconName, sessionIconSpec } from "./sessionIcons";
import { CompactMonitor } from "./compactMonitor";
import { SessionIndex } from "./sessionIndex";
import { SessionLinkService } from "./sessionLinks";
import { SessionSummaryService } from "./sessionSummaries";
import { sessionStatusFor, sessionStatusUri } from "./sessionStatusView";
import { MarkedStatus } from "./sessionStatuses";
import { HoverSummary, pickHoverSummary, SUMMARY_SOURCE_LABELS } from "./sessionSummary";
import { findSessionTerminal } from "./terminals";

export type TreeNode =
  | { kind: "group"; group: SessionGroup }
  | { kind: "session"; pinned: PinnedSession; groupRef: GroupRef }
  | { kind: "resources"; sessionId: string; groupRef: GroupRef };

type SessionNode = Extract<TreeNode, { kind: "session" }>;
type GroupNode = Extract<TreeNode, { kind: "group" }>;
type ResourcesNode = Extract<TreeNode, { kind: "resources" }>;

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
    private readonly summaryService: SessionSummaryService,
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
    if (parentNode.kind === "session" && parentNode.pinned.terminal === undefined) {
      const sessionId = parentNode.pinned.sessionId;
      return this.registry.hasFoundResources(sessionId) ? [{ kind: "resources", sessionId, groupRef: parentNode.groupRef }] : [];
    }
    return [];
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (node.kind === "group") {
      return groupTreeItem(node.group, this.registry.isGroupCollapsed(this.collapseKey(node.group.ref)));
    }
    if (node.kind === "resources") {
      return resourcesTreeItem(node.sessionId, this.resourceLinks(node.sessionId), this.linkService.isFinding(node.sessionId));
    }
    const status = sessionStatusFor(this.registry, node.pinned.sessionId);
    if (node.pinned.terminal !== undefined) {
      return terminalTreeItem(node.pinned, node.pinned.terminal, status);
    }
    const meta = node.pinned.meta;
    const hasFoundResources = this.registry.hasFoundResources(node.pinned.sessionId);
    const summaryState: SummaryState = {
      summary: meta && pickHoverSummary(meta.recap, this.summaryService.summaryFor(meta.sessionId), meta.sizeBytes),
      isSummarizing: this.summaryService.isSummarizing(node.pinned.sessionId),
    };
    const isExpanded = this.registry.isSessionExpanded(node.pinned.sessionId);
    return sessionTreeItem(
      node.pinned,
      this.liveMonitor.get(node.pinned.sessionId),
      hasFoundResources,
      summaryState,
      isExpanded,
      this.compactMonitor.isCompacting(node.pinned.sessionId),
      status,
    );
  }

  private resourceLinks(sessionId: string): MarkedLink[] | undefined {
    const meta = this.sessionIndex.currentSessions.find((session) => session.sessionId === sessionId);
    return meta === undefined ? undefined : this.linkService.linksFor(meta);
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
    if (node.kind === "session") {
      await this.registry.setSessionExpanded(node.pinned.sessionId, isExpanded);
    } else if (node.kind === "group") {
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
    if (node.kind === "resources") {
      return this.sessionNode(node.sessionId);
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

function nodeSessionId(node: SessionNode | ResourcesNode): string {
  return node.kind === "session" ? node.pinned.sessionId : node.sessionId;
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

interface SummaryState {
  summary: HoverSummary | undefined;
  isSummarizing: boolean;
}


function sessionTreeItem(
  pinned: PinnedSession,
  liveSession: LiveSession | undefined,
  hasFoundResources: boolean,
  summaryState: SummaryState,
  isExpanded: boolean,
  isCompacting: boolean,
  status: MarkedStatus | undefined,
): vscode.TreeItem {
  const state = sessionState(pinned.sessionId, liveSession);
  // The menu still follows the running state; only the icon and tooltip say compacting.
  const iconState: SessionIconState = isCompacting && liveSession !== undefined ? "compacting" : state;
  const treeItem = new vscode.TreeItem(pinnedSessionTitle(pinned), expandableState(hasFoundResources, isExpanded));
  treeItem.id = `session:${pinned.sessionId}`;
  treeItem.resourceUri = sessionStatusUri(pinned.sessionId);
  treeItem.description = sessionDescription(pinned);
  treeItem.tooltip = sessionTooltip(pinned, sessionIconSpec(iconState).label, summaryState, status);
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
  const tooltip = new vscode.MarkdownString(
    `**${escapeMarkdown(pinnedSessionTitle(pinned))}**\n\nTerminal · ${isOpen ? "open" : "closed"} · \`${tildePath(terminalSession.cwd)}\``,
  );
  tooltip.supportThemeIcons = true;
  tooltip.appendMarkdown(statusMarkdown(status));
  treeItem.tooltip = tooltip;
  treeItem.contextValue = `terminal.${isOpen ? "open" : "closed"}`;
  treeItem.command = { command: "overseer.clickSession", title: "Open", arguments: [pinned.sessionId] };
  return treeItem;
}

function expandableState(hasChildren: boolean, isExpanded: boolean): vscode.TreeItemCollapsibleState {
  if (!hasChildren) {
    return vscode.TreeItemCollapsibleState.None;
  }
  return isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
}

function resourcesTreeItem(sessionId: string, links: MarkedLink[] | undefined, isFinding: boolean): vscode.TreeItem {
  const treeItem = new vscode.TreeItem("Associated Links", vscode.TreeItemCollapsibleState.None);
  treeItem.id = `resources:${sessionId}`;
  treeItem.iconPath = new vscode.ThemeIcon(isFinding ? "loading~spin" : "references");
  treeItem.description = resourcesDescription(links, isFinding);
  treeItem.contextValue = "resources";
  treeItem.tooltip = "Open this session's links";
  treeItem.command = { command: "overseer.openResources", title: "Open Links", arguments: [sessionId] };
  return treeItem;
}

function resourcesDescription(links: MarkedLink[] | undefined, isFinding: boolean): string {
  if (isFinding) {
    return "Finding…";
  }
  if (links === undefined || links.length === 0) {
    return "none found";
  }
  return linkCountBadge(links) || `${links.length} hidden`;
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

function statusMarkdown(status: MarkedStatus | undefined): string {
  if (status === undefined) {
    return "";
  }
  const reasonLine = status.reason ? `\n\nWhy: ${escapeMarkdown(status.reason)}` : "";
  return `\n\nStatus: $(${status.icon}) ${escapeMarkdown(status.name)}${reasonLine}`;
}

function sessionTooltip(
  pinned: PinnedSession,
  stateLabel: string,
  summaryState: SummaryState,
  status: MarkedStatus | undefined,
): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString();
  tooltip.isTrusted = { enabledCommands: ["overseer.summarizeSession"] };
  tooltip.supportThemeIcons = true;
  const meta = pinned.meta;
  tooltip.appendMarkdown(`**${escapeMarkdown(pinnedSessionTitle(pinned))}**\n\n`);
  if (meta === undefined) {
    tooltip.appendMarkdown(`${stateLabel} · \`${pinned.pending ? tildePath(pinned.pending.cwd) : pinned.sessionId}\``);
    tooltip.appendMarkdown(statusMarkdown(status));
    return tooltip;
  }
  tooltip.appendMarkdown(`${stateLabel} · last active ${formatAge(meta.lastActivityMs)}`);
  tooltip.appendMarkdown(`${statusMarkdown(status)}\n\n`);
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
  tooltip.appendMarkdown(`\n\n---\n\n${summaryMarkdown(pinned.sessionId, summaryState)}`);
  if (meta.firstPrompt && meta.firstPrompt !== displayTitle(meta)) {
    tooltip.appendMarkdown(`\n\n---\n\n**First prompt:** ${escapeMarkdown(meta.firstPrompt)}`);
  }
  if (meta.lastPrompt && meta.lastPrompt !== meta.firstPrompt) {
    tooltip.appendMarkdown(`\n\n**Last prompt:** ${escapeMarkdown(meta.lastPrompt)}`);
  }
  return tooltip;
}

function summaryMarkdown(sessionId: string, summaryState: SummaryState): string {
  const summary = summaryState.summary;
  const summarizeArgs = encodeURIComponent(JSON.stringify([sessionId]));
  const summarizeLink = `[Summarize with Haiku](command:overseer.summarizeSession?${summarizeArgs})`;
  if (summaryState.isSummarizing) {
    return "$(loading~spin) Summarizing with Haiku…";
  }
  if (summary === undefined) {
    return `No summary yet. ${summarizeLink}`;
  }
  let summaryHeader = `*${SUMMARY_SOURCE_LABELS[summary.source]} · ${formatAge(summary.writtenAtMs)}*`;
  if (summary.isStale) {
    summaryHeader += ` · *the session moved on since* · ${summarizeLink}`;
  }
  return `${summaryHeader}\n\n${escapeMarkdown(summary.text)}`;
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, "\\$&");
}
