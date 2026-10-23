import * as crypto from "crypto";
import * as path from "path";
import * as vscode from "vscode";
import { normalizeTicketKey } from "./agentTickets";
import { TRACKED_KIND_LABELS, untrackedKinds } from "./agentWork";
import { DeclarationMonitor } from "./declarationMonitor";
import { formatAge } from "./format";
import { SessionMeta } from "./indexer";
import { linkKey } from "./linkJudge";
import { LinkStatus } from "./linkStatus";
import { LinkStatusService } from "./linkStatusService";
import { MarkedLink, sessionPanelLinks, withParentGroups } from "./linkView";
import { LiveSessionMonitor } from "./liveSessions";
import { openInBrowser, openInVscode } from "./openUrl";
import { tildePath } from "./paths";
import { LinkMark, Registry } from "./registry";
import { OrderedResource, orderResources } from "./resourceOrder";
import { acceptedOrder, linkStatusColor, ResourceRow, resourceRow } from "./resourceRows";
import { readLinkSettings, SessionLinkService } from "./sessionLinks";
import { SessionFocusTracker } from "./sessionFocus";
import { PopulateSummary } from "./populateMerge";
import { SessionPopulator } from "./sessionPopulator";
import { linkRowTitle, metaLine, metaTitle, recheckSummaryText, shortLinkStatus, stateSentence } from "./sessionSidebarText";
import { SessionPreview } from "./sessionPreview";
import { previewRunState, SidebarRunKind, sidebarRunKind } from "./sessionPreviewModel";
import { statusColorId } from "./sessionStatuses";
import { sessionStatusFor } from "./sessionStatusView";
import { SessionSummaryService } from "./sessionSummaries";
import { pickHoverSummary, SUMMARY_SOURCE_LABELS } from "./sessionSummary";
import { StatusConfig } from "./statusConfig";
import { sessionIdOfTerminal } from "./terminals";

export const SESSION_PANEL_VIEW_ID = "overseer.session";
const PANEL_INTRODUCED_KEY = "overseer.sessionPanelIntroduced";

export interface SessionPanelDependencies {
  extensionUri: vscode.Uri;
  registry: Registry;
  linkService: SessionLinkService;
  linkStatusService: LinkStatusService;
  statusConfig: StatusConfig;
  liveMonitor: LiveSessionMonitor;
  sessionFocus: SessionFocusTracker;
  sessionPreview: SessionPreview;
  summaryService: SessionSummaryService;
  declarationMonitor: DeclarationMonitor;
  populator: SessionPopulator;
  findSessionMeta: (sessionId: string) => SessionMeta | undefined;
  sessionTitle: (sessionId: string) => string;
  globalState: vscode.Memento;
}

type RecheckState = { status: "running" } | { status: "done"; summary: PopulateSummary } | { status: "failed"; reason: string };

type RecheckLine = { status: "running" } | { status: "done"; text: string } | { status: "failed"; reason: string };

interface SessionDetails {
  sessionId: string;
  title: string;
  runKind: SidebarRunKind;
  stateLabel: string;
  resumeLabel: string;
  lastActive: string | undefined;
  cwd: string | undefined;
  branch: string | undefined;
  otherRepos: string[];
  metaLine: string;
  metaTitle: string;
  stateSentence: string;
  status: { name: string; icon: string; color: string; reason: string | undefined } | undefined;
  summary: { text: string; caption: string; isStale: boolean } | undefined;
  isSummarizing: boolean;
  hasTranscript: boolean;
  untracked: string[];
  recheck: RecheckLine | undefined;
}

interface PanelRow extends ResourceRow {
  shortStatus: string | undefined;
  hoverTitle: string;
}

type LinkFilter = "showIrrelevant" | "showRemoved";

interface PanelState {
  session: SessionDetails | undefined;
  workingOn: PanelRow[];
  alsoSeen: PanelRow[];
  filters: Record<LinkFilter, boolean>;
  isJiraEnabled: boolean;
  isFinding: boolean;
  canFind: boolean;
}

type PanelMessage =
  | { type: "ready" }
  | { type: "open"; key: string; target: "vscode" | "browser" }
  | { type: "copy"; key: string }
  | { type: "setMark"; key: string; mark: LinkMark | null }
  | { type: "moveStatus"; key: string }
  | { type: "reorder"; keys: string[] }
  | { type: "setFilter"; filter: LinkFilter; value: boolean }
  | { type: "pinByKey" }
  | { type: "findAgain" }
  | { type: "refreshWorkingOn" }
  | { type: "action"; action: string }
  | { type: "recheck" }
  | { type: "dismissRecheck" };

const LINK_MARKS = new Set<string>(["pinned", "removed"]);
const LINK_FILTERS: LinkFilter[] = ["showIrrelevant", "showRemoved"];
const NO_FILTERS: Record<LinkFilter, boolean> = { showIrrelevant: false, showRemoved: false };

// Each sidebar action runs the same command as the tree's context menu, given the session ID.
const ACTION_COMMANDS: Record<string, string> = {
  suspend: "overseer.suspendSession",
  compact: "overseer.compactSession",
  clear: "overseer.clearSession",
  model: "overseer.switchModel",
  cost: "overseer.costSession",
  command: "overseer.runSessionCommand",
  summarize: "overseer.summarizeSession",
  findLinks: "overseer.findResources",
  openRepo: "overseer.openRepoInScm",
  status: "overseer.setSessionStatus",
  rename: "overseer.renameSession",
};

// Shows the tickets of the focused session, beside it in the Secondary Side Bar.
export class SessionPanelProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private shownLinks: MarkedLink[] = [];
  private readonly recheckStates = new Map<string, RecheckState>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly dependencies: SessionPanelDependencies) {
    const postState = (): void => this.postState();
    this.disposables.push(
      vscode.window.onDidChangeActiveTerminal((terminal) => void this.introduceOnce(terminal)),
      dependencies.sessionFocus.onDidChange(postState),
      vscode.window.onDidCloseTerminal(postState),
      dependencies.registry.onDidChange(postState),
      dependencies.statusConfig.onDidChange(postState),
      dependencies.linkService.onDidChange(postState),
      dependencies.linkStatusService.onDidChange(postState),
      dependencies.liveMonitor.onDidChange(postState),
      dependencies.summaryService.onDidChange(postState),
      dependencies.declarationMonitor.onDidChange(postState),
      dependencies.populator.onDidChange(postState),
    );
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    void this.dependencies.globalState.update(PANEL_INTRODUCED_KEY, true);
    const mediaRoot = vscode.Uri.joinPath(this.dependencies.extensionUri, "media");
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [mediaRoot] };
    const codiconStylesheet = webviewView.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "codicons", "codicon.css"));
    webviewView.webview.html = panelHtml(crypto.randomBytes(16).toString("base64"), webviewView.webview.cspSource, codiconStylesheet.toString());
    webviewView.webview.onDidReceiveMessage((message: PanelMessage) => void this.receive(message), undefined, this.disposables);
    webviewView.onDidChangeVisibility(() => this.postState(), undefined, this.disposables);
  }

  // Opens the panel the first time a Claude terminal gets focus, then gives focus back so typing keeps going to Claude.
  private async introduceOnce(terminal: vscode.Terminal | undefined): Promise<void> {
    const { globalState } = this.dependencies;
    if (terminal === undefined || sessionIdOfTerminal(terminal) === undefined || globalState.get<boolean>(PANEL_INTRODUCED_KEY)) {
      return;
    }
    await globalState.update(PANEL_INTRODUCED_KEY, true);
    await vscode.commands.executeCommand(`${SESSION_PANEL_VIEW_ID}.focus`);
    terminal.show(false);
  }

  private postState(): void {
    if (this.view?.visible !== true) {
      return;
    }
    void this.view.webview.postMessage({ type: "state", state: this.panelState() });
  }

  private panelState(): PanelState {
    const sessionId = this.dependencies.sessionFocus.focusedSessionId();
    if (sessionId === undefined) {
      this.shownLinks = [];
      return { session: undefined, workingOn: [], alsoSeen: [], filters: NO_FILTERS, isJiraEnabled: false, isFinding: false, canFind: false };
    }
    const { registry, linkService, linkStatusService, findSessionMeta } = this.dependencies;
    const meta = findSessionMeta(sessionId);
    const visibleLinks = linkService.visibleLinksFor(sessionId, meta) ?? [];
    const linkMarks = registry.linkMarks(sessionId);
    const statusFor = (link: MarkedLink): LinkStatus | undefined => linkStatusService.statusFor(link);
    const { workingOn, alsoSeen } = withParentGroups(sessionPanelLinks(visibleLinks, linkMarks), statusFor, linkMarks);
    const hasSavedOrder = registry.linkOrder(sessionId).length > 0;
    const orderedWorkingOn = orderResources(workingOn, statusFor, hasSavedOrder);
    const orderedAlsoSeen = orderResources(alsoSeen, statusFor, hasSavedOrder);
    this.shownLinks = [...orderedWorkingOn, ...orderedAlsoSeen].map((resource) => resource.link);
    const linkSettings = readLinkSettings();
    return {
      session: this.sessionDetails(sessionId, meta),
      workingOn: orderedWorkingOn.map((resource) => this.rowFor(resource)),
      alsoSeen: orderedAlsoSeen.map((resource) => this.rowFor(resource)),
      filters: { showIrrelevant: linkSettings.showIrrelevant, showRemoved: linkSettings.showRemoved },
      isJiraEnabled: linkSettings.enabledKinds.has("ticket"),
      isFinding: linkService.isFinding(sessionId),
      canFind: meta !== undefined,
    };
  }

  private sessionDetails(sessionId: string, meta: SessionMeta | undefined): SessionDetails {
    const { registry, liveMonitor, sessionFocus, summaryService, declarationMonitor, populator, sessionTitle } = this.dependencies;
    const liveSession = liveMonitor.get(sessionId);
    const runKind = sidebarRunKind(sessionFocus.focusSource() === "terminal", liveSession);
    const isLive = runKind === "idle" || runKind === "busy";
    const { stateLabel, resumeLabel } = previewRunState(isLive ? undefined : liveSession);
    const status = sessionStatusFor(registry, sessionId);
    const summary = meta && pickHoverSummary(meta.recap, summaryService.summaryFor(sessionId), meta.sizeBytes);
    const untracked = untrackedKinds(declarationMonitor.sessionWork(sessionId), declarationMonitor.declaredTickets(sessionId).length);
    const lastActive = meta === undefined ? undefined : formatAge(meta.lastActivityMs);
    const cwd = meta === undefined ? undefined : tildePath(meta.resumeCwd ?? meta.startCwd);
    const branch = meta?.gitBranch || undefined;
    const otherRepos = (meta?.otherReposTouched ?? []).map((repoRoot) => path.basename(repoRoot));
    const isBackgroundAgent = !isLive && liveSession?.kind === "background" && liveSession.agentId !== undefined;
    return {
      sessionId,
      title: sessionTitle(sessionId),
      runKind,
      stateLabel: isLive ? (runKind === "busy" ? "Working" : "Idle") : stateLabel,
      resumeLabel,
      lastActive,
      cwd,
      branch,
      otherRepos,
      metaLine: metaLine(cwd, branch, otherRepos),
      metaTitle: metaTitle(cwd, branch),
      stateSentence: stateSentence({ runKind, lastActive, isBackgroundAgent }),
      status:
        status === undefined
          ? undefined
          : { name: status.name, icon: status.icon, color: `--vscode-${statusColorId(status.color).replace(/\./g, "-")}`, reason: status.reason },
      summary:
        summary === undefined
          ? undefined
          : { text: summary.text, caption: `${SUMMARY_SOURCE_LABELS[summary.source]} · ${formatAge(summary.writtenAtMs)}`, isStale: summary.isStale },
      isSummarizing: summaryService.isSummarizing(sessionId),
      hasTranscript: meta !== undefined,
      untracked: untracked.map((kind) => TRACKED_KIND_LABELS[kind]),
      recheck: populator.isPopulating(sessionId) ? { status: "running" } : this.recheckLine(sessionId),
    };
  }

  private recheckLine(sessionId: string): RecheckLine | undefined {
    const recheckState = this.recheckStates.get(sessionId);
    if (recheckState?.status === "done") {
      return { status: "done", text: recheckSummaryText(recheckState.summary) };
    }
    return recheckState;
  }

  private rowFor({ link, depth }: OrderedResource): PanelRow {
    const { linkStatusService, statusConfig } = this.dependencies;
    const status = linkStatusService.statusFor(link);
    const row = resourceRow(link, status, linkStatusColor(statusConfig, link, status), readLinkSettings().jiraBaseUrl, depth);
    return { ...row, shortStatus: shortLinkStatus(row.statusText), hoverTitle: linkRowTitle(row) };
  }

  private urlFor(key: string): string | undefined {
    const link = this.shownLink(key);
    return link === undefined ? undefined : resourceRow(link, undefined, undefined, readLinkSettings().jiraBaseUrl).url;
  }

  private shownLink(key: string): MarkedLink | undefined {
    return this.shownLinks.find((link) => linkKey(link) === key);
  }

  private async receive(message: PanelMessage): Promise<void> {
    const sessionId = this.dependencies.sessionFocus.focusedSessionId();
    if (message.type === "ready") {
      this.postState();
      return;
    }
    if (sessionId === undefined) {
      return;
    }
    const { registry } = this.dependencies;
    switch (message.type) {
      case "open": {
        const url = this.urlFor(message.key);
        if (url !== undefined) {
          await (message.target === "vscode" ? openInVscode(url) : openInBrowser(url));
        }
        return;
      }
      case "copy": {
        const link = this.shownLink(message.key);
        if (link !== undefined) {
          await vscode.env.clipboard.writeText(this.urlFor(message.key) ?? link.id);
        }
        return;
      }
      case "moveStatus": {
        const link = this.shownLink(message.key);
        if (link?.kind === "ticket") {
          await vscode.commands.executeCommand("overseer.moveTicketStatus", link.id);
        }
        return;
      }
      case "reorder": {
        const reorderedKeys = acceptedOrder(this.shownLinks.map(linkKey), message.keys);
        if (reorderedKeys !== undefined) {
          // Hidden links keep their saved place after the shown ones, so showing them again does not move them.
          const hiddenKeys = registry.linkOrder(sessionId).filter((key) => !reorderedKeys.includes(key));
          await registry.setLinkOrder(sessionId, [...reorderedKeys, ...hiddenKeys]);
        }
        return;
      }
      case "setFilter":
        if (LINK_FILTERS.includes(message.filter) && typeof message.value === "boolean") {
          await vscode.workspace.getConfiguration("overseer.links").update(message.filter, message.value, vscode.ConfigurationTarget.Global);
        }
        return;
      case "setMark":
        if (this.shownLink(message.key) !== undefined && (message.mark === null || LINK_MARKS.has(message.mark))) {
          await registry.setLinkMark(sessionId, [message.key], message.mark ?? undefined);
        }
        return;
      case "pinByKey": {
        const typedKey = await vscode.window.showInputBox({
          title: "Pin a ticket to this session",
          placeHolder: "PROJ-123",
          validateInput: (input) => (normalizeTicketKey(input) === undefined ? "Enter a Jira key like PROJ-123." : undefined),
        });
        const ticketKey = typedKey === undefined ? undefined : normalizeTicketKey(typedKey);
        if (ticketKey !== undefined) {
          await registry.setLinkMark(sessionId, [`ticket:${ticketKey}`], "pinned");
        }
        return;
      }
      case "refreshWorkingOn":
        this.refreshWorkingOn();
        return;
      case "findAgain":
        await vscode.commands.executeCommand("overseer.findResources", sessionId);
        return;
      case "action":
        if (message.action === "resume") {
          await this.resume(sessionId);
        } else if (Object.hasOwn(ACTION_COMMANDS, message.action)) {
          await vscode.commands.executeCommand(ACTION_COMMANDS[message.action], sessionId);
        }
        return;
      case "recheck":
        await this.recheck(sessionId);
        return;
      case "dismissRecheck":
        this.recheckStates.delete(sessionId);
        this.postState();
        return;
    }
  }

  private refreshWorkingOn(): void {
    this.dependencies.declarationMonitor.rescan();
    this.dependencies.linkStatusService.refresh(this.shownLinks);
  }

  // Find links runs after the Haiku pass so new artifacts and the judge's parents show too.
  private async recheck(sessionId: string): Promise<void> {
    const { findSessionMeta, populator } = this.dependencies;
    const meta = findSessionMeta(sessionId);
    if (meta === undefined || this.recheckStates.get(sessionId)?.status === "running") {
      return;
    }
    this.recheckStates.set(sessionId, { status: "running" });
    this.postState();
    try {
      const summary = await populator.populate(meta, { isRecheck: true });
      // The declarations are already saved, so a failed scan must not hide them.
      await Promise.resolve(vscode.commands.executeCommand("overseer.findResources", sessionId)).catch(() => undefined);
      this.recheckStates.set(sessionId, { status: "done", summary });
    } catch (error) {
      this.recheckStates.set(sessionId, { status: "failed", reason: error instanceof Error ? error.message : String(error) });
    }
    this.refreshWorkingOn();
    this.postState();
  }

  // Resuming the previewed session opens its terminal in the preview's place.
  private async resume(sessionId: string): Promise<void> {
    const { sessionPreview } = this.dependencies;
    if (sessionPreview.sessionId() === sessionId) {
      await sessionPreview.resume();
      return;
    }
    await vscode.commands.executeCommand("overseer.openSessionById", sessionId);
  }

  dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
  }
}

function panelHtml(nonce: string, cspSource: string, codiconStylesheet: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; font-src ${cspSource}; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Session</title>
<link rel="stylesheet" href="${codiconStylesheet}">
<style nonce="${nonce}">
  :root {
    color-scheme: light dark;
    --hairline: var(--vscode-sideBarSectionHeader-border, var(--vscode-widget-border, transparent));
    --outline: var(--vscode-button-border, var(--vscode-contrastBorder, var(--vscode-widget-border, var(--vscode-descriptionForeground))));
  }
  html, body, #root { height: 100%; }
  body {
    margin: 0;
    padding: 0;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
  }
  #root { display: flex; flex-direction: column; }
  button { font: inherit; color: inherit; background: none; border: none; padding: 0; cursor: pointer; }
  :focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .scroll { flex: 1; min-height: 0; overflow: auto; padding-bottom: 12px; }
  .scroll.centered { display: flex; align-items: center; justify-content: center; padding-bottom: 0; }
  .mono { font-family: var(--vscode-editor-font-family); }
  .ellipsis { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .header { padding: 14px 16px 0; }
  .title-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .title-line > .codicon { flex-shrink: 0; font-size: 14px; }
  h1 { flex: 1; min-width: 0; margin: 0; font-size: 14px; font-weight: 600; }
  .status-text { flex-shrink: 0; font-size: 11px; }
  .meta-line { margin: 4px 0 0 22px; font-size: 11px; color: var(--vscode-descriptionForeground); }
  .busy { color: var(--vscode-charts-blue); }
  .idle { color: var(--vscode-charts-green); }
  .paused { color: var(--vscode-icon-foreground); }
  .elsewhere { color: var(--vscode-charts-orange); }
  .next { margin: 16px 16px 0; }
  .state-sentence { margin: 0 0 6px; font-size: 11px; color: var(--vscode-descriptionForeground); }
  .state-sentence.elsewhere { color: var(--vscode-charts-orange); }
  .recap-text { display: block; width: 100%; text-align: left; font-size: 14px; line-height: 22px; text-wrap: pretty; }
  .recap-text.clamped { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
  .caption { margin: 6px 0 0; font-size: 11px; color: var(--vscode-disabledForeground); }
  .muted { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 12px; color: var(--vscode-descriptionForeground); }
  .main-actions { display: flex; gap: 8px; margin-top: 12px; }
  .button { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 32px; padding: 0 12px; border-radius: 2px; font-size: 13px; font-weight: 500; transition: background-color 80ms linear; }
  .button .codicon { font-size: 14px; }
  .button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .button.primary:hover { background: var(--vscode-button-hoverBackground); }
  .button.outline { border: 1px solid var(--outline); color: var(--vscode-foreground); }
  .button.outline:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
  .button.square { flex: none; width: 32px; padding: 0; }
  .button:disabled { opacity: 0.5; cursor: default; }
  .work { margin-top: 20px; padding-top: 12px; border-top: 1px solid var(--hairline); }
  .work-heading { display: flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px 0 16px; }
  .work-heading h2 { flex: 1; margin: 0; font-size: 12px; font-weight: 600; }
  .icon-button { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 4px; color: var(--vscode-descriptionForeground); }
  .icon-button:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
  .icon-button:disabled { opacity: 0.4; cursor: default; }
  .icon-button .codicon { font-size: 14px; }
  .list { list-style: none; margin: 0; padding: 0; }
  .link-row { position: relative; display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 16px; transition: background-color 80ms linear; }
  .link-row:hover { background: var(--vscode-list-hoverBackground); }
  .glyph { flex-shrink: 0; width: 14px; height: 14px; }
  .glyph:not([data-status]) { stroke: var(--vscode-descriptionForeground); }
  .key { flex-shrink: 0; font-family: var(--vscode-editor-font-family); font-size: 12px; color: var(--vscode-foreground); white-space: nowrap; text-decoration: none; }
  a.key { cursor: pointer; }
  a.key:hover { text-decoration: underline; }
  .label { flex: 1; min-width: 0; font-size: 12px; color: var(--vscode-descriptionForeground); }
  .short-status { flex-shrink: 0; font-size: 11px; color: var(--vscode-descriptionForeground); }
  .actions { display: none; flex-shrink: 0; margin: -4px -6px -4px 0; }
  .link-row:hover .actions, .link-row:focus-within .actions, .actions:has(.menu) { display: flex; }
  .link-row:hover .short-status, .link-row:focus-within .short-status, .link-row:has(.menu) .short-status { display: none; }
  .gripper { position: absolute; left: 1px; visibility: hidden; cursor: grab; font-size: 14px; color: var(--vscode-descriptionForeground); }
  .link-row:hover .gripper { visibility: visible; }
  .seen { height: 26px; padding-left: 34px; opacity: 0.8; }
  .seen .gripper { left: 16px; }
  .seen:hover, .seen:focus-within { opacity: 1; }
  .seen.dimmed { opacity: 0.5; }
  .seen.dimmed:hover, .seen.dimmed:focus-within { opacity: 1; }
  .parent-group { opacity: 0.5; }
  .parent-group:hover, .parent-group:focus-within { opacity: 1; }
  .removed .key { text-decoration: line-through; }
  .tag { flex-shrink: 0; font-size: 11px; font-style: italic; color: var(--vscode-descriptionForeground); }
  .seen:hover .tag, .seen:focus-within .tag { display: none; }
  .untracked { display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 16px; font-size: 12px; color: var(--vscode-descriptionForeground); }
  .untracked .codicon { flex-shrink: 0; font-size: 14px; }
  .untracked .text { flex: 1; min-width: 0; }
  .link-button { flex-shrink: 0; color: var(--vscode-textLink-foreground); }
  .link-button:hover { text-decoration: underline; }
  .empty-work { margin: 0 16px 4px; font-size: 12px; line-height: 18px; color: var(--vscode-descriptionForeground); }
  .disclosure-row { display: flex; align-items: center; margin-top: 4px; padding-right: 10px; }
  .disclosure { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; height: 28px; padding: 0 0 0 16px; font-size: 12px; text-align: left; color: var(--vscode-descriptionForeground); }
  .disclosure:hover:not(:disabled) { color: var(--vscode-foreground); }
  .disclosure:disabled { cursor: default; }
  .disclosure .codicon { flex-shrink: 0; font-size: 12px; transition: transform 100ms linear; }
  .disclosure[aria-expanded="true"] .codicon-chevron-right { transform: rotate(90deg); }
  .disclosure-tools { display: flex; visibility: hidden; }
  .disclosure-row:hover .disclosure-tools, .disclosure-row:focus-within .disclosure-tools, .disclosure-row.is-filtering .disclosure-tools { visibility: visible; }
  .filter-note { margin: 0; padding: 0 16px 4px 34px; font-size: 11px; color: var(--vscode-descriptionForeground); }
  .dragging { opacity: 0.4; }
  .drop-before { box-shadow: inset 0 2px 0 var(--vscode-focusBorder); }
  .drop-after { box-shadow: inset 0 -2px 0 var(--vscode-focusBorder); }
  .menu-anchor { position: relative; display: inline-flex; }
  .menu {
    position: absolute;
    right: 0;
    top: 24px;
    z-index: 10;
    min-width: 184px;
    padding: 4px 0;
    border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, transparent));
    border-radius: 4px;
    background: var(--vscode-menu-background);
    color: var(--vscode-menu-foreground);
  }
  .menu-item { display: flex; align-items: center; gap: 8px; width: 100%; height: 22px; padding: 0 8px; font-size: 13px; text-align: left; white-space: nowrap; }
  .menu-item:hover, .menu-item:focus-visible { background: var(--vscode-menu-selectionBackground); color: var(--vscode-menu-selectionForeground); outline: none; }
  .menu-item .codicon { font-size: 14px; }
  .menu-separator { height: 1px; margin: 4px 0; background: var(--vscode-menu-separatorBackground, var(--vscode-menu-border)); }
  .toolbar {
    flex-shrink: 0;
    padding: 8px 8px 10px;
    border-top: 1px solid var(--hairline);
    background: var(--vscode-sideBarSectionHeader-background, var(--vscode-editorWidget-background));
  }
  .group-label { margin: 0; padding: 2px 8px 4px; font-family: var(--vscode-editor-font-family); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--vscode-descriptionForeground); }
  .group-hint { margin-left: 6px; font-family: var(--vscode-font-family); font-size: 11px; letter-spacing: normal; text-transform: none; color: var(--vscode-disabledForeground); }
  .tile-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 2px; margin-bottom: 6px; }
  .tile-grid:last-child { margin-bottom: 0; }
  .tile { display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 0; padding: 6px 0 5px; border-radius: 4px; color: var(--vscode-icon-foreground); transition: background-color 80ms linear, color 80ms linear; }
  .tile:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-textLink-activeForeground); }
  .tile:disabled { opacity: 0.5; cursor: default; }
  .tile .codicon { font-size: 16px; }
  .tile span:last-child { max-width: 100%; padding: 0 2px; box-sizing: border-box; font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .empty { padding: 24px 20px; font-size: 13px; line-height: 20px; text-align: center; color: var(--vscode-descriptionForeground); }
  .empty p { margin: 4px 0 0; }
  .empty .lead { margin-top: 8px; color: var(--vscode-foreground); }
  .empty .codicon { font-size: 16px; }
  @media (prefers-reduced-motion: reduce) {
    .link-row, .button, .tile, .disclosure .codicon { transition: none; }
  }
</style>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const savedViewState = { isAlsoSeenExpanded: Boolean(vscode.getState()?.isAlsoSeenExpanded) };
  let isRecapExpanded = false;
  let shownSessionId = undefined;
  const RUN_ICONS = { idle: "circle-filled", busy: "loading", paused: "debug-pause", elsewhere: "broadcast" };
  const NESTED_ROW_INDENT_PX = 18;
  const ROW_GUTTER_PX = 16;
  const CLAUDE_ACTIONS = [
    ["compact", "fold", "Compact", "Compact"],
    ["clear", "clear-all", "Clear", "Clear"],
    ["model", "sparkle", "Model", "Model"],
    ["cost", "graph", "Cost", "Cost"],
    ["command", "terminal", "Run…", "Run command"],
  ];
  const SESSION_ACTIONS = [
    ["findLinks", "search", "Find links", "Find links"],
    ["openRepo", "source-control", "Repo", "Open repo"],
    ["status", "tag", "Status", "Set status"],
    ["rename", "edit", "Rename", "Rename"],
  ];
  const ACTIONS_WITHOUT_TRANSCRIPT = new Set(["rename", "status"]);
  let panelState = undefined;
  let openMenuId = undefined;
  let draggedRow = undefined;

  function element(tagName, className, text) {
    const created = document.createElement(tagName);
    if (className) {
      created.className = className;
    }
    if (text !== undefined) {
      created.textContent = text;
    }
    return created;
  }

  function codicon(iconName, title) {
    const icon = element("span", "codicon codicon-" + iconName);
    if (title) {
      icon.title = title;
    }
    return icon;
  }

  function spinner() {
    const icon = codicon("loading");
    icon.classList.add("codicon-modifier-spin");
    return icon;
  }

  function iconButton(iconName, label, onPress, isDisabled) {
    const button = element("button", "icon-button");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.disabled = Boolean(isDisabled);
    button.append(codicon(iconName));
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onPress();
    });
    return button;
  }

  function glyphElement(row) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "glyph");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    if (row.statusColor) {
      svg.setAttribute("stroke", row.statusColor);
      svg.setAttribute("data-status", "");
    }
    svg.innerHTML = row.glyph;
    return svg;
  }

  function send(message) {
    vscode.postMessage(message);
  }

  const MISSING_LABELS = { ticket: "Summary loads from Jira", pr: "Title loads from GitHub", artifact: "" };

  function keyElement(row) {
    if (row.url === undefined) {
      const plainKey = element("span", "key", row.displayId);
      if (row.kind === "ticket") {
        plainKey.title = "Set overseer.links.jira.baseUrl to open tickets";
      }
      return plainKey;
    }
    const link = element("a", "key", row.displayId);
    link.href = "#";
    link.title = "Open " + row.displayId;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      send({ type: "open", key: row.key, target: "browser" });
    });
    return link;
  }

  function menuItem(iconName, label, onPress) {
    const item = element("button", "menu-item");
    item.type = "button";
    item.setAttribute("role", "menuitem");
    item.append(codicon(iconName), element("span", "", label));
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      openMenuId = undefined;
      render();
      onPress();
    });
    return item;
  }

  function menuButton(menuId, iconName, label, buildItems) {
    const anchor = element("span", "menu-anchor");
    const button = iconButton(iconName, label, () => {
      openMenuId = openMenuId === menuId ? undefined : menuId;
      render();
    });
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", String(openMenuId === menuId));
    anchor.append(button);
    if (openMenuId === menuId) {
      const menu = element("div", "menu");
      menu.setAttribute("role", "menu");
      menu.append(...buildItems());
      anchor.append(menu);
    }
    return anchor;
  }

  // Open and Pin stay on the row; the rest goes in a menu so the key keeps its room at narrow widths.
  function rowActions(row, pinLabel) {
    const actions = element("div", "actions");
    if (row.mark === "removed") {
      actions.append(iconButton("discard", "Restore", () => send({ type: "setMark", key: row.key, mark: null })));
      return actions;
    }
    const isPinned = row.mark === "pinned";
    actions.append(
      iconButton("link-external", "Open in Browser", () => send({ type: "open", key: row.key, target: "browser" }), row.url === undefined),
      iconButton(isPinned ? "pinned-dirty" : "pin", isPinned ? "Unpin" : pinLabel, () =>
        send({ type: "setMark", key: row.key, mark: isPinned ? null : "pinned" }),
      ),
      menuButton("row:" + row.key, "ellipsis", "More Actions", () => {
        const items = [];
        if (row.url !== undefined) {
          items.push(menuItem("browser", "Open in VS Code", () => send({ type: "open", key: row.key, target: "vscode" })));
        }
        items.push(menuItem("copy", "Copy Link", () => send({ type: "copy", key: row.key })));
        if (row.kind === "ticket" && panelState.isJiraEnabled) {
          items.push(menuItem("arrow-swap", "Move to Status…", () => send({ type: "moveStatus", key: row.key })));
        }
        if (!row.isParentGroup) {
          items.push(element("div", "menu-separator"));
          items.push(menuItem("close", "Remove from This Session", () => send({ type: "setMark", key: row.key, mark: "removed" })));
        }
        return items;
      }),
    );
    return actions;
  }

  // Rows reorder only within their own section; the extension saves one order across both.
  function makeDraggable(item, row, sectionRows) {
    item.draggable = true;
    item.dataset.key = row.key;
    item.prepend(codicon("gripper", "Drag to Reorder"));
    item.firstChild.classList.add("gripper");
    item.addEventListener("dragstart", (event) => {
      draggedRow = { key: row.key, sectionRows };
      event.dataTransfer.effectAllowed = "move";
      item.classList.add("dragging");
    });
    item.addEventListener("dragend", () => {
      draggedRow = undefined;
      item.classList.remove("dragging");
      clearDropMarks();
    });
    item.addEventListener("dragover", (event) => {
      if (draggedRow === undefined || draggedRow.sectionRows !== sectionRows || draggedRow.key === row.key) {
        return;
      }
      event.preventDefault();
      const rowBounds = item.getBoundingClientRect();
      clearDropMarks();
      item.classList.add(event.clientY > rowBounds.top + rowBounds.height / 2 ? "drop-after" : "drop-before");
    });
    item.addEventListener("drop", (event) => {
      event.preventDefault();
      const isAfter = item.classList.contains("drop-after");
      clearDropMarks();
      if (draggedRow !== undefined) {
        moveRow(sectionRows, draggedRow.key, row.key, isAfter);
      }
    });
  }

  function clearDropMarks() {
    document.querySelectorAll(".drop-before, .drop-after").forEach((item) => item.classList.remove("drop-before", "drop-after"));
  }

  function moveRow(sectionRows, movedKey, targetKey, isAfter) {
    const movedRow = sectionRows.find((row) => row.key === movedKey);
    if (movedRow === undefined || movedKey === targetKey) {
      return;
    }
    const reorderedRows = sectionRows.filter((row) => row.key !== movedKey);
    reorderedRows.splice(reorderedRows.findIndex((row) => row.key === targetKey) + (isAfter ? 1 : 0), 0, movedRow);
    sectionRows.splice(0, sectionRows.length, ...reorderedRows);
    render();
    send({ type: "reorder", keys: [...panelState.workingOn, ...panelState.alsoSeen].map((row) => row.key) });
  }

  function workingOnItem(row) {
    const classNames = ["link-row", row.mark === "removed" ? "removed" : "", row.isParentGroup ? "parent-group" : ""].filter(Boolean).join(" ");
    const item = element("li", classNames);
    item.style.paddingLeft = ROW_GUTTER_PX + row.depth * NESTED_ROW_INDENT_PX + "px";
    item.title = row.hoverTitle;
    item.append(glyphElement(row), keyElement(row), element("span", "label ellipsis", row.label || MISSING_LABELS[row.kind]));
    if (row.shortStatus) {
      const shortStatus = element("span", "short-status", row.shortStatus);
      if (row.statusColor) {
        shortStatus.style.color = row.statusColor;
      }
      item.append(shortStatus);
    }
    item.append(rowActions(row, row.isParentGroup ? "Pin as Working On" : "Pin"));
    makeDraggable(item, row, panelState.workingOn);
    return item;
  }

  function alsoSeenItem(row) {
    const classNames = ["link-row seen", row.isDimmed ? "dimmed" : "", row.mark === "removed" ? "removed" : ""].filter(Boolean).join(" ");
    const item = element("li", classNames);
    item.title = row.hoverTitle;
    item.append(glyphElement(row), keyElement(row), element("span", "label ellipsis", row.label || ""));
    if (row.mark === "removed" || row.role === "irrelevant") {
      item.append(element("span", "tag", row.mark === "removed" ? "removed" : "passing"));
    }
    item.append(rowActions(row, "Pin as Working On"));
    makeDraggable(item, row, panelState.alsoSeen);
    return item;
  }

  function filterButton() {
    const { showIrrelevant, showRemoved } = panelState.filters;
    const filterItem = (filter, label) =>
      menuItem(panelState.filters[filter] ? "check" : "blank", label, () =>
        send({ type: "setFilter", filter, value: !panelState.filters[filter] }),
      );
    return menuButton("filter", showIrrelevant || showRemoved ? "filter-filled" : "filter", "Filter", () => [
      filterItem("showIrrelevant", "Passing mentions"),
      filterItem("showRemoved", "Removed"),
    ]);
  }

  function emptyNote(iconName, lead, body) {
    const note = element("div", "empty");
    note.append(codicon(iconName), element("p", "lead", lead), element("p", "", body));
    return note;
  }

  function textButton(className, iconName, label, onPress) {
    const button = element("button", className);
    button.type = "button";
    if (iconName) {
      button.append(codicon(iconName));
    }
    button.append(element("span", "", label));
    button.addEventListener("click", onPress);
    return button;
  }

  function runAction(action) {
    send({ type: "action", action });
  }

  function sessionHeader(session) {
    const header = element("header", "header");
    const titleLine = element("div", "title-line");
    const runIcon = codicon(RUN_ICONS[session.runKind], session.stateLabel);
    runIcon.classList.add(session.runKind);
    if (session.runKind === "busy") {
      runIcon.classList.add("codicon-modifier-spin");
    }
    const title = element("h1", "ellipsis", session.title);
    title.title = session.title;
    titleLine.append(runIcon, title);
    if (session.status) {
      const statusText = element("span", "status-text mono", session.status.name);
      statusText.style.color = "var(" + session.status.color + ")";
      statusText.title = session.status.reason ? "Why: " + session.status.reason : session.status.name;
      titleLine.append(statusText);
    }
    header.append(titleLine);
    if (session.metaLine) {
      const meta = element("p", "meta-line mono ellipsis", session.metaLine);
      meta.title = session.metaTitle;
      header.append(meta);
    }
    return header;
  }

  function recapNodes(session) {
    if (session.isSummarizing) {
      const line = element("p", "muted");
      line.append(spinner(), document.createTextNode("Summarizing with Haiku…"));
      return [line];
    }
    if (session.summary === undefined) {
      return [element("p", "muted", "No summary yet.")];
    }
    const text = textButton(isRecapExpanded ? "recap-text" : "recap-text clamped", undefined, session.summary.text, () => {
      isRecapExpanded = !isRecapExpanded;
      render();
    });
    text.title = isRecapExpanded ? "Show less" : "Show all";
    const caption = session.summary.caption + (session.summary.isStale ? " · the session moved on" : "");
    return [text, element("p", "caption", caption)];
  }

  function mainActions(session) {
    const row = element("div", "main-actions");
    if (session.runKind === "paused" || session.runKind === "elsewhere") {
      const iconName = session.runKind === "elsewhere" ? "repo-forked" : "play";
      row.append(textButton("button primary", iconName, session.resumeLabel, () => runAction("resume")));
    } else {
      row.append(textButton("button outline", "debug-pause", "Suspend", () => runAction("suspend")));
    }
    const summarize = element("button", "button outline square");
    summarize.type = "button";
    summarize.title = session.hasTranscript ? "Summarize with Haiku" : "No transcript yet";
    summarize.setAttribute("aria-label", "Summarize with Haiku");
    summarize.disabled = session.isSummarizing || !session.hasTranscript;
    summarize.append(codicon("sparkle"));
    summarize.addEventListener("click", () => runAction("summarize"));
    row.append(summarize);
    return row;
  }

  function nextStep(session) {
    const block = element("section", "next");
    const sentence = element("p", session.runKind === "elsewhere" ? "state-sentence elsewhere" : "state-sentence", session.stateSentence);
    if (session.runKind === "elsewhere") {
      sentence.title = session.stateLabel;
    }
    block.append(sentence, ...recapNodes(session), mainActions(session));
    return block;
  }

  function untrackedLine(session) {
    if (session.untracked.length === 0 || session.recheck?.status === "running") {
      return undefined;
    }
    const text = session.untracked.join(", ") + " not tracked";
    const line = element("div", "untracked");
    const label = element("span", "text ellipsis", text);
    label.title = text;
    line.append(codicon("hubot"), label, textButton("link-button", undefined, "Fill in", () => send({ type: "recheck" })));
    return line;
  }

  function recheckLine(recheck) {
    if (recheck === undefined) {
      return undefined;
    }
    const line = element("div", "untracked");
    if (recheck.status === "running") {
      line.append(spinner(), element("span", "text ellipsis", "Haiku is reading the whole transcript…"));
      return line;
    }
    if (recheck.status === "failed") {
      const errorIcon = codicon("error");
      errorIcon.style.color = "var(--vscode-errorForeground)";
      const reason = element("span", "text ellipsis", recheck.reason);
      reason.title = recheck.reason;
      line.append(errorIcon, reason, textButton("link-button", undefined, "Retry", () => send({ type: "recheck" })));
      return line;
    }
    const summary = element("span", "text ellipsis", recheck.text);
    summary.title = recheck.text;
    line.append(codicon("check"), summary, iconButton("close", "Dismiss", () => send({ type: "dismissRecheck" })));
    return line;
  }

  function recheckButton(session) {
    const isRechecking = session.recheck?.status === "running";
    const label = session.hasTranscript ? "Recheck with Haiku" : "No transcript yet";
    const button = iconButton(isRechecking ? "loading" : "sparkle", label, () => send({ type: "recheck" }), isRechecking || !session.hasTranscript);
    if (isRechecking) {
      button.firstChild.classList.add("codicon-modifier-spin");
    }
    return button;
  }

  function alsoSeenDisclosure() {
    const { showIrrelevant, showRemoved } = panelState.filters;
    const count = panelState.alsoSeen.length;
    if (count === 0 && !panelState.canFind && !panelState.isFinding) {
      return [];
    }
    const row = element("div", "disclosure-row");
    row.classList.toggle("is-filtering", showIrrelevant || showRemoved || openMenuId === "filter");
    let toggle;
    if (panelState.isFinding && count === 0) {
      toggle = element("button", "disclosure");
      toggle.disabled = true;
      toggle.append(spinner(), element("span", "ellipsis", "Scanning the transcript…"));
    } else if (count === 0) {
      toggle = textButton("disclosure", "search", "Find links in the transcript", () => send({ type: "findAgain" }));
    } else {
      toggle = textButton("disclosure", "chevron-right", count + " more in the transcript", () => {
        savedViewState.isAlsoSeenExpanded = !savedViewState.isAlsoSeenExpanded;
        vscode.setState(savedViewState);
        render();
      });
      toggle.setAttribute("aria-expanded", String(savedViewState.isAlsoSeenExpanded));
    }
    toggle.type = "button";
    const findLabel = panelState.isFinding ? "Scanning the Transcript…" : "Scan the Transcript Again";
    const tools = element("div", "disclosure-tools");
    tools.append(filterButton(), iconButton("refresh", findLabel, () => send({ type: "findAgain" }), panelState.isFinding || !panelState.canFind));
    row.append(toggle, tools);

    const nodes = [row];
    const isOpen = savedViewState.isAlsoSeenExpanded && count > 0;
    if (isOpen && (showIrrelevant || showRemoved)) {
      const shownExtras = [showIrrelevant && "passing mentions", showRemoved && "removed"].filter(Boolean).join(" and ");
      nodes.push(element("p", "filter-note", "Showing " + shownExtras));
    }
    if (isOpen) {
      const list = element("ul", "list");
      list.append(...panelState.alsoSeen.map(alsoSeenItem));
      nodes.push(list);
    }
    return nodes;
  }

  function workSection(session) {
    const work = element("section", "work");
    const heading = element("div", "work-heading");
    heading.append(
      element("h2", "", "Working on"),
      recheckButton(session),
      iconButton("refresh", "Refresh Statuses and Declarations", () => send({ type: "refreshWorkingOn" })),
      iconButton("add", "Pin a Ticket by Key", () => send({ type: "pinByKey" })),
    );
    work.append(...[heading, recheckLine(session.recheck)].filter(Boolean));
    if (panelState.workingOn.length > 0) {
      const list = element("ul", "list");
      list.append(...panelState.workingOn.map(workingOnItem));
      work.append(list);
    } else {
      work.append(element("p", "empty-work", "Nothing yet. The agent adds tickets and PRs as it works."));
    }
    work.append(...[untrackedLine(session), ...alsoSeenDisclosure()].filter(Boolean));
    return work;
  }

  function actionTile([action, iconName, shortLabel, fullLabel], disabledReason) {
    const tile = textButton("tile", iconName, shortLabel, () => runAction(action));
    tile.disabled = disabledReason !== undefined;
    tile.title = disabledReason ?? fullLabel;
    tile.setAttribute("aria-label", fullLabel);
    return tile;
  }

  function tileGrid(actions, disabledReasonFor) {
    const grid = element("div", "tile-grid");
    grid.append(...actions.map((action) => actionTile(action, disabledReasonFor(action[0]))));
    return grid;
  }

  function toolbar(session) {
    const footer = element("footer", "toolbar");
    const isLive = session.runKind === "idle" || session.runKind === "busy";
    if (isLive) {
      const isBusy = session.runKind === "busy";
      const busyReason = isBusy ? "Wait until Claude is idle. Typed input is lost while it works." : undefined;
      const claudeLabel = element("p", "group-label", "Claude");
      if (isBusy) {
        claudeLabel.append(element("span", "group-hint", "waits until idle"));
      }
      footer.append(claudeLabel, tileGrid(CLAUDE_ACTIONS, () => busyReason));
    }
    footer.append(
      element("p", "group-label", "Session"),
      tileGrid(SESSION_ACTIONS, (action) => (session.hasTranscript || ACTIONS_WITHOUT_TRANSCRIPT.has(action) ? undefined : "No transcript yet")),
    );
    return footer;
  }

  function render() {
    const root = document.getElementById("root");
    root.replaceChildren();
    if (panelState === undefined) {
      return;
    }
    const scroll = element("div", "scroll");
    root.append(scroll);
    const session = panelState.session;
    if (session === undefined) {
      scroll.classList.add("centered");
      scroll.append(emptyNote("terminal", "No session in focus", "Click a Claude terminal tab, or a paused session in the tree."));
      return;
    }
    if (session.sessionId !== shownSessionId) {
      shownSessionId = session.sessionId;
      isRecapExpanded = false;
    }
    scroll.append(sessionHeader(session), nextStep(session), workSection(session));
    root.append(toolbar(session));
  }

  document.addEventListener("click", () => {
    if (openMenuId !== undefined) {
      openMenuId = undefined;
      render();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && openMenuId !== undefined) {
      openMenuId = undefined;
      render();
    }
  });

  window.addEventListener("message", (event) => {
    if (event.data.type === "state") {
      panelState = event.data.state;
      render();
    }
  });
  send({ type: "ready" });
</script>
</body>
</html>`;
}
