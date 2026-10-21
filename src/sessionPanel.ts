import * as crypto from "crypto";
import * as vscode from "vscode";
import { normalizeTicketKey } from "./agentTickets";
import { SessionMeta } from "./indexer";
import { linkKey } from "./linkJudge";
import { LinkStatusService } from "./linkStatusService";
import { MarkedLink, sessionPanelTickets } from "./linkView";
import { LiveSessionMonitor } from "./liveSessions";
import { openInBrowser } from "./openUrl";
import { LinkMark, Registry } from "./registry";
import { linkStatusColor, sessionSubtitle } from "./resourcesPanel";
import { ResourceRow, resourceRow } from "./resourceRows";
import { readLinkSettings, SessionLinkService } from "./sessionLinks";
import { SessionFocusTracker } from "./sessionFocus";
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
  findSessionMeta: (sessionId: string) => SessionMeta | undefined;
  sessionTitle: (sessionId: string) => string;
  globalState: vscode.Memento;
}

interface SessionHeader {
  title: string;
  subtitle: string;
  isBusy: boolean;
}

interface PanelState {
  session: SessionHeader | undefined;
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
  | { type: "findAgain" };

const LINK_MARKS = new Set<string>(["pinned", "removed"]);

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
    const { registry, linkService, liveMonitor, findSessionMeta, sessionTitle } = this.dependencies;
    const meta = findSessionMeta(sessionId);
    const visibleLinks = linkService.visibleLinksFor(sessionId, meta) ?? [];
    const { workingOn, alsoSeen } = sessionPanelTickets(visibleLinks, registry.linkMarks(sessionId));
    this.shownLinks = [...workingOn, ...alsoSeen];
    return {
      session: {
        title: sessionTitle(sessionId),
        subtitle: meta === undefined ? "" : sessionSubtitle(meta),
        isBusy: liveMonitor.get(sessionId)?.status === "busy",
      },
      workingOn: workingOn.map((link) => this.rowFor(link)),
      alsoSeen: alsoSeen.map((link) => this.rowFor(link)),
      isFinding: linkService.isFinding(sessionId),
      canFind: meta !== undefined,
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
    }
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
  .busy { color: var(--vscode-charts-blue); }
  .idle { color: var(--vscode-descriptionForeground); }
  .subtitle { display: flex; align-items: center; gap: 4px; margin: 4px 0 0; font-size: 12px; color: var(--vscode-descriptionForeground); min-width: 0; }
  .subtitle span:last-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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
  const savedViewState = vscode.getState() ?? { isWorkingOnExpanded: true, isAlsoSeenExpanded: false };
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
    toggle.append(codicon("chevron-right"), document.createTextNode(title), element("span", "count", String(count)));
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

  function sessionHeader(session) {
    const header = element("header", "header");
    const titleLine = element("div", "title-line");
    const liveIcon = session.isBusy ? codicon("loading", "Busy") : codicon("circle-filled", "Idle");
    liveIcon.classList.add(session.isBusy ? "busy" : "idle");
    if (session.isBusy) {
      liveIcon.classList.add("codicon-modifier-spin");
    }
    titleLine.append(liveIcon, element("h1", "", session.title));
    header.append(titleLine);
    if (session.subtitle) {
      const subtitle = element("p", "subtitle");
      subtitle.append(codicon("git-branch"), element("span", "", session.subtitle));
      header.append(subtitle);
    }
    return header;
  }

  function render() {
    const root = document.getElementById("root");
    root.replaceChildren();
    if (panelState === undefined) {
      return;
    }
    if (panelState.session === undefined) {
      root.append(emptyNote("terminal", "No Claude session in focus", "Click a Claude terminal tab to see its tickets here."));
      return;
    }
    root.append(sessionHeader(panelState.session));

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
