import * as path from "path";
import * as vscode from "vscode";
import { formatAge } from "./format";
import { buildGroups, PinnedSession, pinnedSessionTitle, SessionGroup } from "./grouping";
import { displayTitle, SessionMeta } from "./indexer";
import { ResolvedLink } from "./linkJudge";
import { LinkStatus } from "./linkStatus";
import { LinkStatusService } from "./linkStatusService";
import { linkCountBadge, linkDisplayId, linkIconName, linkUrl } from "./linkView";
import { LiveSession } from "./liveParse";
import { LiveSessionMonitor } from "./liveSessions";
import { tildePath } from "./paths";
import { GroupRef, Registry } from "./registry";
import { moveBeside } from "./reorder";
import { otherReposLabel } from "./repoFilter";
import { SessionIndex } from "./sessionIndex";
import { readLinkSettings, SessionLinkService } from "./sessionLinks";
import { SessionSummaryService } from "./sessionSummaries";
import { HoverSummary, pickHoverSummary } from "./sessionSummary";
import { findSessionTerminal } from "./terminals";

export type TreeNode =
  | { kind: "group"; group: SessionGroup }
  | { kind: "session"; pinned: PinnedSession; groupRef: GroupRef }
  | { kind: "link"; link: ResolvedLink; sessionId: string; groupRef: GroupRef };

type SessionNode = Extract<TreeNode, { kind: "session" }>;
type GroupNode = Extract<TreeNode, { kind: "group" }>;
type LinkNode = Extract<TreeNode, { kind: "link" }>;

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
    private readonly sessionIndex: SessionIndex,
    private readonly liveMonitor: LiveSessionMonitor,
    private readonly registry: Registry,
    private readonly linkService: SessionLinkService,
    private readonly linkStatusService: LinkStatusService,
    private readonly extensionUri: vscode.Uri,
    private readonly summaryService: SessionSummaryService,
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
    if (parentNode.kind === "session" && parentNode.pinned.meta !== undefined) {
      this.linkService.noteExpanded(parentNode.pinned.meta);
      const links = this.linkService.linksFor(parentNode.pinned.meta) ?? [];
      return links.map((link) => ({
        kind: "link",
        link,
        sessionId: parentNode.pinned.sessionId,
        groupRef: parentNode.groupRef,
      }));
    }
    return [];
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (node.kind === "group") {
      return groupTreeItem(node.group);
    }
    if (node.kind === "link") {
      return linkTreeItem(this.extensionUri, node.link, node.sessionId, this.linkStatusService.statusFor(node.link));
    }
    const meta = node.pinned.meta;
    const links = meta === undefined ? [] : this.linkService.linksFor(meta);
    const summaryState: SummaryState = {
      summary: meta && pickHoverSummary(meta.recap, this.summaryService.summaryFor(meta.sessionId), meta.sizeBytes),
      isSummarizing: this.summaryService.isSummarizing(node.pinned.sessionId),
    };
    return sessionTreeItem(node.pinned, this.liveMonitor.get(node.pinned.sessionId), links, summaryState);
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
    await this.registry.setGroupOrder(moveBeside(displayedGroupRefs, draggedGroupRefs, targetGroupRef));
  }

  private currentGroups(): SessionGroup[] {
    const sessionsById = new Map<string, SessionMeta>(
      this.sessionIndex.currentSessions.map((meta) => [meta.sessionId, meta]),
    );
    const pinnedSessionIds = this.registry.pinnedSessionIds();
    return buildGroups({
      pinnedSessionIds,
      sessionsById,
      userGroups: this.registry.userGroups(),
      assignments: this.registry.assignments(),
      labels: this.registry.labels(),
      pendingSessions: this.registry.pendingSessions(),
      groupOrder: this.registry.groupOrder(),
      sessionOrder: this.registry.sessionOrder(),
      linkedTicketKeys: this.linkService.ownedTicketKeys(pinnedSessionIds),
    });
  }

  dispose(): void {
    this.treeChangeEmitter.dispose();
  }
}

function nodeGroupRef(node: TreeNode): GroupRef {
  return node.kind === "group" ? node.group.ref : node.groupRef;
}

function nodeSessionId(node: SessionNode | LinkNode): string {
  return node.kind === "session" ? node.pinned.sessionId : node.sessionId;
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

interface SummaryState {
  summary: HoverSummary | undefined;
  isSummarizing: boolean;
}

const SUMMARY_SOURCE_LABELS: Record<HoverSummary["source"], string> = {
  recap: "Claude Code recap",
  haiku: "Haiku summary",
};

function sessionTreeItem(
  pinned: PinnedSession,
  liveSession: LiveSession | undefined,
  links: ResolvedLink[] | undefined,
  summaryState: SummaryState,
): vscode.TreeItem {
  const state = sessionState(pinned.sessionId, liveSession);
  const treeItem = new vscode.TreeItem(pinnedSessionTitle(pinned), sessionCollapsibleState(links));
  treeItem.id = `session:${pinned.sessionId}`;
  treeItem.description = [linkCountBadge(links ?? []), sessionDescription(pinned)]
    .filter((part) => part !== "")
    .join(" · ");
  treeItem.tooltip = sessionTooltip(pinned, SESSION_STATE_LABELS[state], summaryState);
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

// Unscanned sessions stay expandable so a click can reveal links once the scan lands.
function sessionCollapsibleState(links: ResolvedLink[] | undefined): vscode.TreeItemCollapsibleState {
  const hasNoLinks = links !== undefined && links.length === 0;
  if (hasNoLinks || readLinkSettings().enabledKinds.size === 0) {
    return vscode.TreeItemCollapsibleState.None;
  }
  return vscode.TreeItemCollapsibleState.Collapsed;
}

const LINK_KIND_NAMES: Record<ResolvedLink["kind"], string> = {
  pr: "Pull request",
  ticket: "Jira ticket",
  artifact: "Artifact",
};

function linkIconPath(extensionUri: vscode.Uri, link: ResolvedLink, status: LinkStatus | undefined) {
  const iconName = linkIconName(link, status);
  return {
    light: vscode.Uri.joinPath(extensionUri, "media", "links", `${iconName}-light.svg`),
    dark: vscode.Uri.joinPath(extensionUri, "media", "links", `${iconName}-dark.svg`),
  };
}

function linkTreeItem(
  extensionUri: vscode.Uri,
  link: ResolvedLink,
  sessionId: string,
  status: LinkStatus | undefined,
): vscode.TreeItem {
  const displayId = linkDisplayId(link);
  const treeItem = new vscode.TreeItem(link.label ?? displayId, vscode.TreeItemCollapsibleState.None);
  treeItem.id = `link:${sessionId}:${link.kind}:${link.id}`;
  treeItem.description = [
    status?.text ?? "",
    link.label === undefined ? "" : displayId,
    link.role === "owned" ? "" : link.role,
  ]
    .filter((part) => part !== "")
    .join(" · ");
  treeItem.iconPath = linkIconPath(extensionUri, link, status);
  treeItem.contextValue = `link.${link.kind}`;
  treeItem.tooltip = linkTooltip(link, status);
  treeItem.command = { command: "overseer.openLink", title: "Open Link", arguments: [link] };
  return treeItem;
}

function linkTooltip(link: ResolvedLink, status: LinkStatus | undefined): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString();
  tooltip.appendMarkdown(`**${escapeMarkdown(link.label ?? linkDisplayId(link))}**\n\n`);
  const roleSource = link.judged ? "judged" : "from transcript signals";
  tooltip.appendMarkdown(`${LINK_KIND_NAMES[link.kind]} · ${link.role} (${roleSource})`);
  if (!link.stillRelevant) {
    tooltip.appendMarkdown(" · no longer active");
  }
  if (status !== undefined) {
    tooltip.appendMarkdown(`\n\nStatus: ${escapeMarkdown(status.text)}`);
  }
  const url = linkUrl(link, readLinkSettings().jiraBaseUrl);
  tooltip.appendMarkdown(url === undefined ? "\n\nSet `overseer.links.jira.baseUrl` to open tickets." : `\n\n${url}`);
  return tooltip;
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

function sessionTooltip(pinned: PinnedSession, stateLabel: string, summaryState: SummaryState): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString();
  tooltip.isTrusted = { enabledCommands: ["overseer.summarizeSession"] };
  tooltip.supportThemeIcons = true;
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
