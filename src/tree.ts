import * as path from "path";
import * as vscode from "vscode";
import { formatAge } from "./format";
import { buildGroups, PinnedSession, pinnedSessionTitle, SessionGroup } from "./grouping";
import { displayTitle, SessionMeta } from "./indexer";
import { linkKey } from "./linkJudge";
import { projectKeyOf } from "./jira";
import { LinkStatus, statusGlyph } from "./linkStatus";
import { LinkStatusService } from "./linkStatusService";
import { linkCountBadge, linkDisplayId, linkUrl, MarkedLink, staticLinkIconName } from "./linkView";
import { LiveSession } from "./liveParse";
import { LiveSessionMonitor } from "./liveSessions";
import { tildePath } from "./paths";
import { GroupRef, Registry } from "./registry";
import { moveBeside } from "./reorder";
import { otherReposLabel } from "./repoFilter";
import { SessionIconState, sessionIconName, sessionIconSpec } from "./sessionIcons";
import { SessionIndex } from "./sessionIndex";
import { readLinkSettings, SessionLinkService } from "./sessionLinks";
import { SessionSummaryService } from "./sessionSummaries";
import { HoverSummary, pickHoverSummary } from "./sessionSummary";
import { StatusConfig } from "./statusConfig";
import { StatusIconWriter } from "./statusIcons";
import { findSessionTerminal } from "./terminals";

export type TreeNode =
  | { kind: "group"; group: SessionGroup }
  | { kind: "session"; pinned: PinnedSession; groupRef: GroupRef }
  | { kind: "resources"; sessionId: string; groupRef: GroupRef }
  | { kind: "link"; link: MarkedLink; sessionId: string; groupRef: GroupRef };

type SessionNode = Extract<TreeNode, { kind: "session" }>;
type GroupNode = Extract<TreeNode, { kind: "group" }>;
type ResourcesNode = Extract<TreeNode, { kind: "resources" }>;
type LinkNode = Extract<TreeNode, { kind: "link" }>;
type SessionChildNode = SessionNode | ResourcesNode | LinkNode;

interface DraggedSession {
  sessionId: string;
  groupRef: GroupRef;
}

interface DraggedLink {
  sessionId: string;
  linkKey: string;
}

interface DragPayload {
  draggedSessions: DraggedSession[];
  draggedGroupRefs: GroupRef[];
  draggedLinks: DraggedLink[];
}

const TREE_DRAG_MIME = "application/vnd.code.tree.overseer.sessions";
const RESOURCES_EXPANSION_PREFIX = "resources:";

// The resources row saves its expansion beside the session's, under its own key.
export function resourcesExpansionKey(sessionId: string): string {
  return `${RESOURCES_EXPANSION_PREFIX}${sessionId}`;
}

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
    private readonly statusConfig: StatusConfig,
    private readonly statusIconWriter: StatusIconWriter,
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
    if (parentNode.kind === "session") {
      const sessionId = parentNode.pinned.sessionId;
      return this.registry.hasFoundResources(sessionId) ? [{ kind: "resources", sessionId, groupRef: parentNode.groupRef }] : [];
    }
    if (parentNode.kind === "resources") {
      return (this.resourceLinks(parentNode.sessionId) ?? []).map((link) => ({
        kind: "link",
        link,
        sessionId: parentNode.sessionId,
        groupRef: parentNode.groupRef,
      }));
    }
    return [];
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (node.kind === "group") {
      return groupTreeItem(node.group, this.registry.isGroupCollapsed(node.group.ref));
    }
    if (node.kind === "link") {
      const status = this.linkStatusService.statusFor(node.link);
      return linkTreeItem(node.link, node.sessionId, status, this.linkIconPath(node.link, status));
    }
    if (node.kind === "resources") {
      return resourcesTreeItem(
        node.sessionId,
        this.resourceLinks(node.sessionId),
        this.linkService.isFinding(node.sessionId),
        this.registry.isSessionExpanded(resourcesExpansionKey(node.sessionId)),
      );
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
    const draggedLinks = sourceNodes
      .filter((node): node is LinkNode => node.kind === "link")
      .map((node) => ({ sessionId: node.sessionId, linkKey: linkKey(node.link) }));
    const payload: DragPayload = { draggedSessions, draggedGroupRefs, draggedLinks };
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
    } else if (payload.draggedLinks.length > 0) {
      await this.dropLinks(payload.draggedLinks, targetNode);
    }
  }

  // Links reorder only within their own session; a drop on the Associated Links row moves them to the top.
  private async dropLinks(draggedLinks: DraggedLink[], targetNode: TreeNode | undefined): Promise<void> {
    if (targetNode === undefined || targetNode.kind === "group" || targetNode.kind === "session") {
      return;
    }
    const targetSessionId = nodeSessionId(targetNode);
    const meta = this.sessionIndex.currentSessions.find((session) => session.sessionId === targetSessionId);
    if (meta === undefined) {
      return;
    }
    const draggedLinkKeys = draggedLinks
      .filter((dragged) => dragged.sessionId === targetSessionId)
      .map((dragged) => dragged.linkKey);
    if (draggedLinkKeys.length === 0) {
      return;
    }
    const displayedLinkKeys = (this.linkService.linksFor(meta) ?? []).map(linkKey);
    const reorderedLinkKeys =
      targetNode.kind === "resources"
        ? [...draggedLinkKeys, ...displayedLinkKeys.filter((key) => !draggedLinkKeys.includes(key))]
        : moveBeside(displayedLinkKeys, draggedLinkKeys, linkKey(targetNode.link));
    await this.registry.setLinkOrder(targetSessionId, reorderedLinkKeys);
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

  private linkIconPath(link: MarkedLink, status: LinkStatus | undefined): vscode.TreeItem["iconPath"] {
    const staticIconName = staticLinkIconName(link, status);
    if (staticIconName !== undefined || status === undefined || link.kind === "artifact") {
      const iconName = staticIconName ?? link.kind;
      return {
        light: vscode.Uri.joinPath(this.extensionUri, "media", "links", `${iconName}-light.svg`),
        dark: vscode.Uri.joinPath(this.extensionUri, "media", "links", `${iconName}-dark.svg`),
      };
    }
    const color =
      link.kind === "pr"
        ? this.statusConfig.prColor(status.colorKey)
        : this.statusConfig.jiraColor(projectKeyOf(link.id) ?? "", status.colorKey);
    const iconFile = this.statusIconWriter.iconFile(statusGlyph(link.kind, status), color);
    return iconFile === undefined ? new vscode.ThemeIcon("circle-filled") : vscode.Uri.file(iconFile);
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
      linkedTicketKeys: this.linkService.ownedTicketKeys(
        pinnedSessionIds.filter((sessionId) => this.registry.hasFoundResources(sessionId)),
      ),
    });
  }

  dispose(): void {
    this.treeChangeEmitter.dispose();
  }
}

function nodeGroupRef(node: TreeNode): GroupRef {
  return node.kind === "group" ? node.group.ref : node.groupRef;
}

function nodeSessionId(node: SessionChildNode): string {
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

type SessionState = Exclude<SessionIconState, "duplicate">;

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

const SUMMARY_SOURCE_LABELS: Record<HoverSummary["source"], string> = {
  recap: "Claude Code recap",
  haiku: "Haiku summary",
};

function sessionTreeItem(
  pinned: PinnedSession,
  liveSession: LiveSession | undefined,
  hasFoundResources: boolean,
  summaryState: SummaryState,
  isExpanded: boolean,
): vscode.TreeItem {
  const state = sessionState(pinned.sessionId, liveSession);
  const treeItem = new vscode.TreeItem(pinnedSessionTitle(pinned), expandableState(hasFoundResources, isExpanded));
  treeItem.id = `session:${pinned.sessionId}`;
  treeItem.description = sessionDescription(pinned);
  treeItem.tooltip = sessionTooltip(pinned, sessionIconSpec(state).label, summaryState);
  treeItem.iconPath = sessionStateIcon(state);
  treeItem.contextValue = `session.${state}`;
  const copyCount = liveSession?.processCount ?? 0;
  if (copyCount > 1) {
    treeItem.iconPath = sessionStateIcon("duplicate");
    treeItem.description = `${copyCount} copies running · ${treeItem.description}`;
  }
  treeItem.command = { command: "overseer.clickSession", title: "Open", arguments: [pinned.sessionId] };
  return treeItem;
}

function expandableState(hasChildren: boolean, isExpanded: boolean): vscode.TreeItemCollapsibleState {
  if (!hasChildren) {
    return vscode.TreeItemCollapsibleState.None;
  }
  return isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
}

function resourcesTreeItem(
  sessionId: string,
  links: MarkedLink[] | undefined,
  isFinding: boolean,
  isExpanded: boolean,
): vscode.TreeItem {
  const hasLinks = links !== undefined && links.length > 0;
  const treeItem = new vscode.TreeItem("Associated Links", expandableState(hasLinks, isExpanded));
  treeItem.id = `resources:${sessionId}`;
  treeItem.iconPath = new vscode.ThemeIcon(isFinding ? "loading~spin" : "references");
  treeItem.description = resourcesDescription(links, isFinding);
  treeItem.contextValue = "resources";
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

const LINK_KIND_NAMES: Record<MarkedLink["kind"], string> = {
  pr: "Pull request",
  ticket: "Jira ticket",
  artifact: "Artifact",
};

function linkTreeItem(
  link: MarkedLink,
  sessionId: string,
  status: LinkStatus | undefined,
  iconPath: vscode.TreeItem["iconPath"],
): vscode.TreeItem {
  const displayId = linkDisplayId(link);
  const treeItem = new vscode.TreeItem(link.label ?? displayId, vscode.TreeItemCollapsibleState.None);
  treeItem.id = `link:${sessionId}:${link.kind}:${link.id}`;
  treeItem.description = [
    status?.text ?? "",
    link.mark ?? "",
    link.label === undefined ? "" : displayId,
    link.role === "owned" ? "" : link.role,
  ]
    .filter((part) => part !== "")
    .join(" · ");
  treeItem.iconPath = iconPath;
  treeItem.contextValue = `link.${link.kind}.${link.mark ?? "unmarked"}`;
  treeItem.tooltip = linkTooltip(link, status);
  treeItem.command = { command: "overseer.openLink", title: "Open Link", arguments: [link] };
  return treeItem;
}

function linkTooltip(link: MarkedLink, status: LinkStatus | undefined): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString();
  tooltip.appendMarkdown(`**${escapeMarkdown(link.label ?? linkDisplayId(link))}**\n\n`);
  const roleSource = link.judged ? "judged" : "from transcript signals";
  tooltip.appendMarkdown(`${LINK_KIND_NAMES[link.kind]} · ${link.role} (${roleSource})`);
  if (!link.stillRelevant) {
    tooltip.appendMarkdown(" · no longer active");
  }
  if (link.mark !== undefined) {
    tooltip.appendMarkdown(` · ${link.mark} by you`);
  }
  if (status !== undefined) {
    const projectKey = link.kind === "ticket" ? projectKeyOf(link.id) : undefined;
    const projectSuffix = projectKey === undefined ? "" : ` · project ${projectKey}`;
    tooltip.appendMarkdown(`\n\nStatus: **${escapeMarkdown(status.text)}**${projectSuffix}`);
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
