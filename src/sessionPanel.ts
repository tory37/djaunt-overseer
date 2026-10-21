import * as crypto from "crypto";
import * as path from "path";
import * as vscode from "vscode";
import { normalizeTicketKey } from "./agentTickets";
import { TRACKED_KIND_LABELS, untrackedKinds } from "./agentWork";
import { DeclarationMonitor } from "./declarationMonitor";
import { formatAge } from "./format";
import { SessionMeta } from "./indexer";
import { linkKey } from "./linkJudge";
import { LinkStatusService } from "./linkStatusService";
import { MarkedLink, sessionPanelTickets } from "./linkView";
import { LiveSessionMonitor } from "./liveSessions";
import { openInBrowser } from "./openUrl";
import { tildePath } from "./paths";
import { LinkMark, Registry } from "./registry";
import { linkStatusColor } from "./resourcesPanel";
import { ResourceRow, resourceRow } from "./resourceRows";
import { readLinkSettings, SessionLinkService } from "./sessionLinks";
import { SessionFocusTracker } from "./sessionFocus";
import { SessionPopulator } from "./sessionPopulator";
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

interface SessionDetails {
  title: string;
  runKind: SidebarRunKind;
  stateLabel: string;
  resumeLabel: string;
  lastActive: string | undefined;
  cwd: string | undefined;
  branch: string | undefined;
  otherRepos: string[];
  status: { name: string; icon: string; color: string; reason: string | undefined } | undefined;
  summary: { text: string; caption: string; isStale: boolean } | undefined;
  isSummarizing: boolean;
  hasTranscript: boolean;
  untracked: string[];
  isPopulating: boolean;
}

interface PanelState {
  session: SessionDetails | undefined;
  workingOn: ResourceRow[];
  alsoSeen: ResourceRow[];
  isFinding: boolean;
  canFind: boolean;
}

type PanelMessage =
  | { type: "ready" }
  | { type: "open"; key: string }
  | { type: "setMark"; key: string; mark: LinkMark | null }
  | { type: "pinByKey" }
  | { type: "findAgain" }
  | { type: "action"; action: string }
  | { type: "populate" };

const LINK_MARKS = new Set<string>(["pinned", "removed"]);

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
      return { session: undefined, workingOn: [], alsoSeen: [], isFinding: false, canFind: false };
    }
    const { registry, linkService, findSessionMeta } = this.dependencies;
    const meta = findSessionMeta(sessionId);
    const visibleLinks = linkService.visibleLinksFor(sessionId, meta) ?? [];
    const { workingOn, alsoSeen } = sessionPanelTickets(visibleLinks, registry.linkMarks(sessionId));
    this.shownLinks = [...workingOn, ...alsoSeen];
    return {
      session: this.sessionDetails(sessionId, meta),
      workingOn: workingOn.map((link) => this.rowFor(link)),
      alsoSeen: alsoSeen.map((link) => this.rowFor(link)),
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
    return {
      title: sessionTitle(sessionId),
      runKind,
      stateLabel: isLive ? (runKind === "busy" ? "Working" : "Idle") : stateLabel,
      resumeLabel,
      lastActive: meta === undefined ? undefined : formatAge(meta.lastActivityMs),
      cwd: meta === undefined ? undefined : tildePath(meta.resumeCwd ?? meta.startCwd),
      branch: meta?.gitBranch || undefined,
      otherRepos: (meta?.otherReposTouched ?? []).map((repoRoot) => path.basename(repoRoot)),
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
      isPopulating: populator.isPopulating(sessionId),
    };
  }

  private rowFor(link: MarkedLink): ResourceRow {
    const { linkStatusService, statusConfig } = this.dependencies;
    const status = linkStatusService.statusFor(link);
    return resourceRow(link, status, linkStatusColor(statusConfig, link, status), readLinkSettings().jiraBaseUrl);
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
        const link = this.shownLink(message.key);
        const url = link === undefined ? undefined : resourceRow(link, undefined, undefined, readLinkSettings().jiraBaseUrl).url;
        if (url !== undefined) {
          await openInBrowser(url);
        }
        return;
      }
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
      case "populate": {
        const meta = this.dependencies.findSessionMeta(sessionId);
        if (meta !== undefined) {
          await this.dependencies.populator.populate(meta);
        }
        return;
      }
    }
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
  :root { color-scheme: light dark; }
  body {
    margin: 0;
    padding: 0;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
  }
  button { font: inherit; color: inherit; background: none; border: none; padding: 0; cursor: pointer; }
  :focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .header { padding: 12px 12px 8px; }
  .title-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
  h1 { flex: 1; margin: 0; font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .title-tools { visibility: hidden; margin: -4px 0; }
  .header:hover .title-tools, .header:focus-within .title-tools { visibility: visible; }
  .busy { color: var(--vscode-charts-blue); }
  .idle { color: var(--vscode-charts-green); }
  .paused { color: var(--vscode-descriptionForeground); }
  .elsewhere { color: var(--vscode-charts-orange); }
  .state-line { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin: 4px 0 0; font-size: 12px; color: var(--vscode-descriptionForeground); }
  .state-line .elsewhere { color: var(--vscode-charts-orange); }
  .place { display: flex; align-items: center; gap: 4px; margin: 4px 0 0; font-size: 12px; color: var(--vscode-descriptionForeground); min-width: 0; }
  .places { margin-top: 8px; }
  .places .place:first-child { margin-top: 0; }
  .place .codicon { font-size: 12px; flex-shrink: 0; }
  .place span:last-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mono { font-family: var(--vscode-editor-font-family); }
  .status-tag { display: inline-flex; align-items: center; gap: 4px; margin-top: 8px; height: 16px; padding: 0 4px; border: 1px solid currentColor; border-radius: 2px; font-size: 11px; line-height: 1; }
  .status-tag .codicon { font-size: 11px; }
  .status-tag span:last-child { color: var(--vscode-foreground); }
  .recap { padding: 0 12px 12px; }
  .caption { margin: 0; font-size: 11px; font-style: italic; color: var(--vscode-descriptionForeground); }
  .recap-text { display: block; width: 100%; margin-top: 4px; text-align: left; font-size: 13px; line-height: 20px; }
  .recap-text.clamped { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .muted { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 12px; color: var(--vscode-descriptionForeground); }
  .link-button { color: var(--vscode-textLink-foreground); }
  .link-button:hover { text-decoration: underline; }
  .main-actions { display: flex; gap: 8px; padding: 0 12px 12px; }
  .button { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 28px; padding: 0 12px; border-radius: 2px; font-size: 13px; transition: background-color 80ms linear; }
  .button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .button.primary:hover { background: var(--vscode-button-hoverBackground); }
  .button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .button.inline { flex: none; }
  .button .codicon { font-size: 14px; }
  .populate { margin: 0 12px 12px; padding: 8px; border: 1px solid var(--vscode-editorWidget-border, transparent); border-radius: 2px; background: var(--vscode-editorWidget-background); }
  .populate p { display: flex; align-items: flex-start; gap: 8px; margin: 0; font-size: 12px; line-height: 16px; }
  .populate p .codicon { font-size: 14px; color: var(--vscode-descriptionForeground); }
  .populate .hint { margin-top: 4px; padding-left: 22px; color: var(--vscode-descriptionForeground); }
  .populate .populate-tools { display: flex; margin-top: 8px; padding-left: 22px; }
  .action-group { margin: 0; padding: 4px 8px; font-size: 11px; color: var(--vscode-descriptionForeground); }
  .action-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 4px; padding: 0 4px; }
  @media (min-width: 360px) { .action-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  .action-grid:last-child { padding-bottom: 8px; }
  .action { display: flex; align-items: center; gap: 8px; height: 22px; padding: 0 8px; border-radius: 2px; font-size: 13px; text-align: left; min-width: 0; transition: background-color 80ms linear; }
  .action:hover { background: var(--vscode-list-hoverBackground); }
  .action:disabled { opacity: 0.5; cursor: default; background: none; }
  .action .codicon { font-size: 14px; flex-shrink: 0; }
  .action span:last-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .section-header {
    display: flex;
    align-items: center;
    height: 24px;
    padding: 0 8px 0 4px;
    border-top: 1px solid var(--vscode-sideBarSectionHeader-border, transparent);
  }
  .section-toggle {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    text-align: left;
  }
  .section-toggle .codicon { font-size: 14px; transition: transform 100ms linear; }
  .section-toggle[aria-expanded="true"] .codicon { transform: rotate(90deg); }
  .count {
    margin-left: 4px;
    padding: 0 6px;
    border-radius: 8px;
    font-size: 10px;
    font-weight: 400;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
  }
  .section-tools { display: flex; visibility: hidden; }
  .section-header:hover .section-tools, .section-header:focus-within .section-tools { visibility: visible; }
  .list { list-style: none; margin: 0; padding: 0; }
  .ticket {
    position: relative;
    padding: 8px 12px;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, transparent);
    transition: background-color 80ms linear;
  }
  .ticket:last-child { border-bottom: none; }
  .ticket:hover, .seen:hover { background: var(--vscode-list-hoverBackground); }
  .key-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .key {
    font-family: var(--vscode-editor-font-family);
    font-size: 12px;
    color: var(--vscode-textLink-foreground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .key.plain { color: var(--vscode-foreground); }
  a.key { text-decoration: none; cursor: pointer; }
  a.key:hover { text-decoration: underline; }
  .pill {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 16px;
    padding: 0 4px;
    border: 1px solid var(--vscode-descriptionForeground);
    border-radius: 2px;
    font-size: 11px;
    line-height: 1;
  }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--vscode-descriptionForeground); }
  .spacer { flex: 1; }
  .glyph { flex-shrink: 0; width: 14px; height: 14px; }
  .glyph:not([data-status]) { stroke: var(--vscode-descriptionForeground); }
  .summary {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin: 4px 0 0;
    font-size: 13px;
    line-height: 20px;
  }
  .summary.missing { color: var(--vscode-descriptionForeground); font-style: italic; }
  .note { display: flex; align-items: flex-start; gap: 4px; margin: 4px 0 0; font-size: 12px; line-height: 16px; color: var(--vscode-descriptionForeground); }
  .note span:last-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .note .codicon { font-size: 12px; margin-top: 2px; }
  .pin-mark { color: var(--vscode-descriptionForeground); }
  .actions { display: none; margin: -4px 0; }
  .ticket:hover .actions, .ticket:focus-within .actions, .seen:hover .actions, .seen:focus-within .actions { display: flex; }
  .ticket:hover .pin-mark, .ticket:focus-within .pin-mark { display: none; }
  .icon-button { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 4px; }
  .icon-button:hover { background: var(--vscode-toolbar-hoverBackground); }
  .icon-button:disabled { opacity: 0.4; cursor: default; }
  .icon-button .codicon { font-size: 14px; }
  .seen { display: flex; align-items: center; gap: 8px; height: 22px; padding: 0 8px 0 28px; transition: background-color 80ms linear; }
  .seen .summary-inline { flex: 1; min-width: 0; font-size: 13px; color: var(--vscode-descriptionForeground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .seen-list { padding-bottom: 8px; }
  .empty { padding: 24px 20px; font-size: 13px; line-height: 20px; color: var(--vscode-descriptionForeground); }
  .empty p { margin: 4px 0 0; }
  .empty .lead { margin-top: 8px; color: var(--vscode-foreground); }
  .empty .codicon { font-size: 16px; }
  @media (prefers-reduced-motion: reduce) {
    .ticket, .seen, .section-toggle .codicon { transition: none; }
  }
</style>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const savedViewState = { isWorkingOnExpanded: true, isAlsoSeenExpanded: false, isActionsExpanded: true, ...vscode.getState() };
  let isRecapExpanded = false;
  const RUN_ICONS = { idle: "circle-filled", busy: "loading", paused: "debug-pause", elsewhere: "broadcast" };
  const CLAUDE_ACTIONS = [
    ["compact", "fold", "Compact"],
    ["clear", "clear-all", "Clear"],
    ["model", "sparkle", "Model"],
    ["cost", "graph", "Cost"],
    ["command", "terminal", "Run command"],
  ];
  const SESSION_ACTIONS = [
    ["summarize", "note", "Summarize"],
    ["findLinks", "search", "Find links"],
    ["openRepo", "source-control", "Open repo"],
    ["status", "tag", "Set status"],
    ["rename", "edit", "Rename"],
  ];
  let panelState = undefined;

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

  function statusPill(row) {
    const pill = element("span", "pill");
    const dot = element("span", "dot");
    if (row.statusColor) {
      pill.style.borderColor = row.statusColor;
      dot.style.background = row.statusColor;
    }
    pill.append(dot, element("span", "", row.statusText));
    return pill;
  }

  function send(message) {
    vscode.postMessage(message);
  }

  function keyElement(row, className) {
    if (row.url === undefined) {
      const plainKey = element("span", className + " plain", row.displayId);
      plainKey.title = "Set overseer.links.jira.baseUrl to open tickets";
      return plainKey;
    }
    const link = element("a", className, row.displayId);
    link.href = "#";
    link.title = "Open " + row.displayId;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      send({ type: "open", key: row.key });
    });
    return link;
  }

  function workingOnItem(row) {
    const item = element("li", "ticket");
    const keyLine = element("div", "key-line");
    keyLine.append(glyphElement(row), keyElement(row, "key"));
    if (row.statusText) {
      keyLine.append(statusPill(row));
    }
    keyLine.append(element("span", "spacer"));
    const isPinned = row.mark === "pinned";
    if (isPinned) {
      keyLine.append(codicon("pinned", "Pinned by you"));
      keyLine.lastChild.classList.add("pin-mark");
    }
    const actions = element("div", "actions");
    actions.append(
      iconButton("link-external", "Open in Browser", () => send({ type: "open", key: row.key }), row.url === undefined),
      iconButton(isPinned ? "pinned-dirty" : "pin", isPinned ? "Unpin" : "Pin", () =>
        send({ type: "setMark", key: row.key, mark: isPinned ? null : "pinned" }),
      ),
      iconButton("close", "Remove from This Session", () => send({ type: "setMark", key: row.key, mark: "removed" })),
    );
    keyLine.append(actions);
    item.append(keyLine);

    const summary = element("p", row.label ? "summary" : "summary missing", row.label || "Summary loads from Jira");
    item.append(summary);
    if (row.agentNote) {
      const note = element("p", "note");
      note.append(codicon("hubot", "Declared by the agent"), element("span", "", row.agentNote));
      item.append(note);
    } else if (isPinned) {
      item.append(element("p", "note", "Pinned by you"));
    }
    return item;
  }

  function alsoSeenItem(row) {
    const item = element("li", "seen");
    item.append(glyphElement(row), keyElement(row, "key plain"), element("span", "summary-inline", row.label || ""));
    const actions = element("div", "actions");
    actions.append(
      iconButton("pin", "Pin as Working On", () => send({ type: "setMark", key: row.key, mark: "pinned" })),
      iconButton("close", "Remove", () => send({ type: "setMark", key: row.key, mark: "removed" })),
    );
    item.append(actions);
    return item;
  }

  function emptyNote(iconName, lead, body) {
    const note = element("div", "empty");
    note.append(codicon(iconName), element("p", "lead", lead), element("p", "", body));
    return note;
  }

  function sectionHeader(title, count, stateField, tools) {
    const header = element("div", "section-header");
    const toggle = element("button", "section-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(savedViewState[stateField]));
    toggle.append(codicon("chevron-right"), document.createTextNode(title));
    if (count !== undefined) {
      toggle.append(element("span", "count", String(count)));
    }
    toggle.addEventListener("click", () => {
      savedViewState[stateField] = !savedViewState[stateField];
      vscode.setState(savedViewState);
      render();
    });
    const toolbar = element("div", "section-tools");
    toolbar.append(...tools);
    header.append(toggle, toolbar);
    return header;
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

  function placeLine(iconName, text, isMono, title) {
    const line = element("p", "place");
    line.title = title ?? text;
    line.append(codicon(iconName), element("span", isMono ? "mono" : "", text));
    return line;
  }

  function sessionHeader(session) {
    const header = element("header", "header");
    const titleLine = element("div", "title-line");
    const runIcon = codicon(RUN_ICONS[session.runKind], session.stateLabel);
    runIcon.classList.add(session.runKind);
    if (session.runKind === "busy") {
      runIcon.classList.add("codicon-modifier-spin");
    }
    const title = element("h1", "", session.title);
    title.title = session.title;
    const titleTools = element("div", "title-tools");
    titleTools.append(iconButton("edit", "Rename", () => runAction("rename")));
    titleLine.append(runIcon, title, titleTools);
    header.append(titleLine);

    const stateLine = element("p", "state-line");
    const isLive = session.runKind === "idle" || session.runKind === "busy";
    stateLine.append(element("span", session.runKind === "elsewhere" ? "elsewhere" : "", session.stateLabel));
    if (isLive) {
      stateLine.append(element("span", "", "·"), element("span", "", "active now"));
    } else if (session.lastActive) {
      stateLine.append(element("span", "", "·"), element("span", "", "last active " + session.lastActive));
    }
    header.append(stateLine);

    const places = element("div", "places");
    if (session.cwd) {
      places.append(placeLine("folder", session.cwd, true));
    }
    if (session.branch) {
      places.append(placeLine("git-branch", session.branch, true));
    }
    if (session.otherRepos.length > 0) {
      places.append(placeLine("repo", "also " + session.otherRepos.join(", "), false));
    }
    if (places.childElementCount > 0) {
      header.append(places);
    }
    if (session.status) {
      const tag = element("span", "status-tag");
      tag.style.color = "var(" + session.status.color + ")";
      tag.title = session.status.reason ? "Why: " + session.status.reason : session.status.name;
      tag.append(codicon(session.status.icon), element("span", "", session.status.name));
      header.append(tag);
    }
    return header;
  }

  function recapBlock(session) {
    const block = element("div", "recap");
    if (session.isSummarizing) {
      const line = element("p", "muted");
      line.append(codicon("loading"), document.createTextNode("Summarizing with Haiku…"));
      line.firstChild.classList.add("codicon-modifier-spin");
      block.append(line);
      return block;
    }
    if (session.summary === undefined) {
      if (!session.hasTranscript) {
        return undefined;
      }
      const line = element("p", "muted", "No summary yet.");
      line.append(textButton("link-button", undefined, "Summarize with Haiku", () => runAction("summarize")));
      block.append(line);
      return block;
    }
    const caption = session.summary.caption + (session.summary.isStale ? " · the session moved on" : "");
    const text = textButton(isRecapExpanded ? "recap-text" : "recap-text clamped", undefined, session.summary.text, () => {
      isRecapExpanded = !isRecapExpanded;
      render();
    });
    text.title = isRecapExpanded ? "Show less" : "Show all";
    block.append(element("p", "caption", caption), text);
    return block;
  }

  function mainActions(session) {
    const row = element("div", "main-actions");
    if (session.runKind === "paused" || session.runKind === "elsewhere") {
      const iconName = session.runKind === "elsewhere" ? "repo-forked" : "play";
      row.append(textButton("button primary", iconName, session.resumeLabel, () => runAction("resume")));
    } else {
      row.append(textButton("button secondary", "debug-pause", "Suspend", () => runAction("suspend")));
    }
    return row;
  }

  function populateBanner(session) {
    if (session.untracked.length === 0 && !session.isPopulating) {
      return undefined;
    }
    const banner = element("div", "populate");
    const lead = element("p");
    lead.append(codicon("hubot"), element("span", "", session.isPopulating ? "Haiku is reading this session…" : "Not tracked yet: " + session.untracked.join(", ") + "."));
    banner.append(lead);
    const tools = element("div", "populate-tools");
    if (session.isPopulating) {
      const running = element("p", "muted");
      running.append(codicon("loading"), document.createTextNode("Populating"));
      running.firstChild.classList.add("codicon-modifier-spin");
      tools.append(running);
    } else {
      banner.append(element("p", "hint", "Haiku can read the session and fill them in. Costs cents."));
      tools.append(textButton("button secondary inline", "sparkle", "Populate all", () => send({ type: "populate" })));
    }
    banner.append(tools);
    return banner;
  }

  function actionTile([action, iconName, label], disabledReason) {
    const tile = textButton("action", iconName, label, () => runAction(action));
    tile.disabled = disabledReason !== undefined;
    tile.title = disabledReason ?? label;
    return tile;
  }

  function actionsSection(session) {
    const nodes = [sectionHeader("Actions", undefined, "isActionsExpanded", [])];
    if (!savedViewState.isActionsExpanded) {
      return nodes;
    }
    const isLive = session.runKind === "idle" || session.runKind === "busy";
    if (isLive) {
      const isBusy = session.runKind === "busy";
      const busyReason = isBusy ? "Wait until Claude is idle. Typed input is lost while it works." : undefined;
      const claudeGrid = element("div", "action-grid");
      claudeGrid.append(...CLAUDE_ACTIONS.map((action) => actionTile(action, busyReason)));
      nodes.push(element("p", "action-group", isBusy ? "Claude · wait until idle" : "Claude"), claudeGrid, element("p", "action-group", "Session"));
    }
    const sessionGrid = element("div", "action-grid");
    sessionGrid.append(
      ...SESSION_ACTIONS.map((action) => actionTile(action, session.hasTranscript || action[0] === "rename" || action[0] === "status" ? undefined : "No transcript yet")),
    );
    nodes.push(sessionGrid);
    return nodes;
  }

  function render() {
    const root = document.getElementById("root");
    root.replaceChildren();
    if (panelState === undefined) {
      return;
    }
    if (panelState.session === undefined) {
      root.append(emptyNote("terminal", "No session in focus", "Click a Claude terminal tab, or a paused session in the tree."));
      return;
    }
    const session = panelState.session;
    root.append(
      ...[sessionHeader(session), recapBlock(session), mainActions(session), populateBanner(session), ...actionsSection(session)].filter(Boolean),
    );

    root.append(
      sectionHeader("Working on", panelState.workingOn.length, "isWorkingOnExpanded", [
        iconButton("add", "Pin a Ticket by Key", () => send({ type: "pinByKey" })),
      ]),
    );
    if (savedViewState.isWorkingOnExpanded) {
      if (panelState.workingOn.length > 0) {
        const list = element("ul", "list");
        list.append(...panelState.workingOn.map(workingOnItem));
        root.append(list);
      } else {
        root.append(
          emptyNote("hubot", "No tickets yet", "The agent declares a ticket when it starts work on it. You can also pin one from Also seen."),
        );
      }
    }

    const findLabel = panelState.isFinding ? "Scanning the Transcript…" : "Scan the Transcript Again";
    root.append(
      sectionHeader("Also seen", panelState.alsoSeen.length, "isAlsoSeenExpanded", [
        iconButton("refresh", findLabel, () => send({ type: "findAgain" }), panelState.isFinding || !panelState.canFind),
      ]),
    );
    if (savedViewState.isAlsoSeenExpanded && panelState.alsoSeen.length > 0) {
      const list = element("ul", "list seen-list");
      list.append(...panelState.alsoSeen.map(alsoSeenItem));
      root.append(list);
    }
  }

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
