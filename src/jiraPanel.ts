import * as crypto from "crypto";
import * as vscode from "vscode";
import { FilterTerm, parseFilter } from "./jiraFilter";
import { JiraQuery, readJiraQueries } from "./jiraQueries";
import { JiraService } from "./jiraService";
import { firstLine, isQueryDue, QueryRunState, queryIdentity, reconcileQueryStates, sectionView } from "./jiraTicketsView";
import { openInBrowser } from "./openUrl";

export const JIRA_PANEL_VIEW_ID = "overseer.jira";
const QUERIES_SETTING = "overseer.jira.queries";
const POLL_TICK_MS = 30_000;
const WEB_URL_PATTERN = /^https?:\/\//;

type PanelMessage =
  | { type: "ready"; filterText?: unknown }
  | { type: "filter"; text: unknown }
  | { type: "refresh"; queryIndex: number }
  | { type: "refreshAll" }
  | { type: "open"; url: string }
  | { type: "editQueries" };

export class JiraPanelProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private viewDisposables: vscode.Disposable[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private states: QueryRunState[] = [];
  private readonly queuedIdentities: string[] = [];
  private isDraining = false;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private currentUserName: string | undefined;
  private isCurrentUserNameLoading = false;
  private filterText = "";
  private filterTerms: FilterTerm[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly jiraService: JiraService,
  ) {
    this.states = reconcileQueryStates([], readConfiguredQueries());
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(QUERIES_SETTING) || event.affectsConfiguration("overseer.jira.mcpServer")) {
          this.reloadQueries(event.affectsConfiguration("overseer.jira.mcpServer"));
        }
      }),
    );
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.disposeView();
    this.view = webviewView;
    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, "media");
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [mediaRoot] };
    const codiconStylesheet = webviewView.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "codicons", "codicon.css"));
    webviewView.webview.html = panelHtml(crypto.randomBytes(16).toString("base64"), webviewView.webview.cspSource, codiconStylesheet.toString());
    this.viewDisposables.push(
      webviewView.webview.onDidReceiveMessage((message: PanelMessage) => void this.receive(message)),
      webviewView.onDidChangeVisibility(() => this.syncVisibility()),
      webviewView.onDidDispose(() => this.disposeView()),
    );
    this.syncVisibility();
  }

  refreshAll(): void {
    this.states.forEach((state) => this.enqueue(queryIdentity(state.query)));
  }

  dispose(): void {
    this.disposeView();
    this.disposables.forEach((disposable) => disposable.dispose());
  }

  private isVisible(): boolean {
    return this.view?.visible === true && vscode.workspace.getConfiguration("overseer.views").get<boolean>("jira", false);
  }

  private syncVisibility(): void {
    if (!this.isVisible()) {
      this.stopPolling();
      return;
    }
    if (this.pollTimer === undefined) {
      this.pollTimer = setInterval(() => this.pollTick(), POLL_TICK_MS);
    }
    this.pollTick();
  }

  private pollTick(): void {
    void this.loadCurrentUserName();
    const nowMs = Date.now();
    this.states
      .filter((state) => isQueryDue(state.lastCheckedMs, state.query.intervalMinutes, nowMs))
      .forEach((state) => this.enqueue(queryIdentity(state.query)));
    this.postState();
    void this.drain();
  }

  private async loadCurrentUserName(): Promise<void> {
    if (this.currentUserName !== undefined || this.isCurrentUserNameLoading) {
      return;
    }
    this.isCurrentUserNameLoading = true;
    try {
      this.currentUserName = await this.jiraService.currentUserName();
    } finally {
      this.isCurrentUserNameLoading = false;
    }
    if (this.currentUserName !== undefined) {
      this.postState();
    }
  }

  private stopPolling(): void {
    if (this.pollTimer !== undefined) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private reloadQueries(isServerChanged: boolean): void {
    this.states = reconcileQueryStates(this.states, readConfiguredQueries());
    if (isServerChanged) {
      this.refreshAll();
    }
    if (this.isVisible()) {
      this.pollTick();
    }
  }

  private enqueue(identity: string): void {
    const isRunning = this.statesFor(identity).some((state) => state.isRunning);
    if (!isRunning && !this.queuedIdentities.includes(identity)) {
      this.queuedIdentities.push(identity);
    }
    void this.drain();
  }

  // One query at a time, so many queries on short intervals can't flood the one MCP server process.
  private async drain(): Promise<void> {
    if (this.isDraining) {
      return;
    }
    this.isDraining = true;
    try {
      while (this.isVisible() && this.queuedIdentities.length > 0) {
        const identity = this.queuedIdentities.shift() as string;
        await this.runQuery(identity);
      }
    } finally {
      this.isDraining = false;
    }
  }

  private async runQuery(identity: string): Promise<void> {
    const query = this.statesFor(identity)[0]?.query;
    if (query === undefined) {
      return;
    }
    this.updateStates(identity, (state) => ({ ...state, isRunning: true }));
    try {
      const { issues, hasMore } = await this.jiraService.search(query.jql, query.fields);
      this.updateStates(identity, (state) => {
        const { error: _clearedError, ...rest } = state;
        return { ...rest, issues, hasMore, isRunning: false, lastCheckedMs: Date.now() };
      });
    } catch (error) {
      this.updateStates(identity, (state) => ({ ...state, error: firstLine(error), isRunning: false, lastCheckedMs: Date.now() }));
    }
  }

  private statesFor(identity: string): QueryRunState[] {
    return this.states.filter((state) => queryIdentity(state.query) === identity);
  }

  // The settings can change while a query runs, so results land on whatever states match it now.
  private updateStates(identity: string, update: (state: QueryRunState) => QueryRunState): void {
    this.states = this.states.map((state) => (queryIdentity(state.query) === identity ? update(state) : state));
    this.postState();
  }

  private postState(): void {
    if (this.view?.visible !== true) {
      return;
    }
    const nowMs = Date.now();
    const sections = this.states.map((state, queryIndex) =>
      sectionView(state, queryIndex, nowMs, this.currentUserName, this.filterTerms),
    );
    const isFiltering = this.filterTerms.length > 0;
    void this.view.webview.postMessage({ type: "state", state: { sections, filterText: this.filterText, isFiltering } });
  }

  private setFilter(text: unknown): void {
    this.filterText = typeof text === "string" ? text : "";
    this.filterTerms = parseFilter(this.filterText);
  }

  private async receive(message: PanelMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        this.setFilter(message.filterText);
        this.syncVisibility();
        this.postState();
        return;
      case "refresh": {
        const state = this.states[message.queryIndex];
        if (state !== undefined) {
          this.enqueue(queryIdentity(state.query));
        }
        return;
      }
      case "filter":
        this.setFilter(message.text);
        this.postState();
        return;
      case "refreshAll":
        this.refreshAll();
        return;
      case "open":
        if (typeof message.url === "string" && WEB_URL_PATTERN.test(message.url)) {
          await openInBrowser(message.url);
        }
        return;
      case "editQueries":
        await editQueries();
        return;
    }
  }

  private disposeView(): void {
    this.stopPolling();
    this.viewDisposables.forEach((disposable) => disposable.dispose());
    this.viewDisposables = [];
    this.view = undefined;
  }
}

export function registerJiraPanelCommands(provider: JiraPanelProvider): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("overseer.jira.refresh", () => provider.refreshAll()),
    vscode.commands.registerCommand("overseer.jira.editQueries", editQueries),
  ];
}

async function editQueries(): Promise<void> {
  try {
    await vscode.commands.executeCommand("workbench.action.openSettingsJson", { revealSetting: { key: QUERIES_SETTING, edit: true } });
  } catch {
    await vscode.commands.executeCommand("workbench.action.openSettings", QUERIES_SETTING);
  }
}

function readConfiguredQueries(): JiraQuery[] {
  return readJiraQueries(vscode.workspace.getConfiguration().get<unknown>(QUERIES_SETTING));
}

function panelHtml(nonce: string, cspSource: string, codiconStylesheet: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; font-src ${cspSource}; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Jira Tickets</title>
<link rel="stylesheet" href="${codiconStylesheet}">
<style nonce="${nonce}">
  :root {
    color-scheme: light dark;
    --s1: 4px;
    --s2: 8px;
    --s3: 12px;
    --s4: 16px;
    --row-height: 28px;
    --header-height: 26px;
    --filter-input-height: 24px;
    --filter-bar-height: calc(var(--filter-input-height) + 2 * var(--s2));
    --icon-size: 14px;
    --mono: var(--vscode-editor-font-family);
    --muted: var(--vscode-descriptionForeground);
    --hairline: var(--vscode-sideBarSectionHeader-border, var(--vscode-widget-border, transparent));
    --outline: var(--vscode-button-border, var(--vscode-contrastBorder, var(--vscode-widget-border, var(--vscode-descriptionForeground))));
  }
  html, body, #root { height: 100%; overflow-x: hidden; }
  body {
    margin: 0;
    padding: 0;
    font-family: var(--vscode-font-family);
    font-size: 13px;
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
  }
  button { font: inherit; color: inherit; background: none; border: none; padding: 0; cursor: pointer; }
  :focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  #root { overflow-y: auto; padding-bottom: var(--s3); box-sizing: border-box; }
  .ellipsis { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .section.quiet { opacity: 0.6; }
  .section.quiet:hover, .section.quiet:focus-within { opacity: 1; }
  .filter-bar { position: sticky; top: 0; z-index: 2; padding: var(--s2) var(--s3); background: var(--vscode-sideBar-background); }
  .filter-bar[hidden] { display: none; }
  .filter-box { position: relative; display: flex; align-items: center; height: var(--filter-input-height); }
  .filter-box > .codicon-filter { position: absolute; left: 6px; font-size: var(--icon-size); color: var(--muted); pointer-events: none; }
  .filter-input { width: 100%; height: 100%; box-sizing: border-box; padding: 0 26px 0 24px; border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; font: inherit; font-size: 12px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); }
  .filter-input::placeholder { color: var(--vscode-input-placeholderForeground, var(--muted)); }
  .filter-input:focus { outline: none; border-color: var(--vscode-focusBorder); }
  .filter-box .icon-button { position: absolute; right: 1px; width: 20px; height: 20px; }
  .filter-box .icon-button[hidden] { display: none; }
  .filter-chip { color: inherit; font: inherit; text-decoration: none; }
  .filter-chip:hover { text-decoration: underline; }
  .no-match { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s1); margin: 0; padding: var(--s2) var(--s4); font-size: 12px; color: var(--muted); }
  .link-button { color: var(--vscode-textLink-foreground); }
  .link-button:hover { text-decoration: underline; }
  .section-header { position: sticky; top: var(--filter-bar-height); z-index: 1; display: flex; align-items: center; gap: var(--s1); height: var(--header-height); padding: 0 var(--s2) 0 var(--s4); box-sizing: border-box; border-top: 1px solid var(--vscode-sideBarSectionHeader-border, var(--hairline)); background: var(--vscode-sideBarSectionHeader-background, var(--vscode-sideBar-background)); color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground)); cursor: pointer; transition: background-color 80ms linear; }
  .section-header:hover { background: var(--vscode-list-hoverBackground); }
  .chevron { flex-shrink: 0; display: inline-flex; color: var(--muted); }
  .chevron .codicon { font-size: var(--icon-size); transition: transform 120ms ease-out; }
  .section.expanded .chevron .codicon { transform: rotate(90deg); }
  .section-name { flex: 1; min-width: 0; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
  .count { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 16px; padding: 0 var(--s1); box-sizing: border-box; border-radius: 8px; font-family: var(--mono); font-size: 10px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .count.loading, .section.quiet .count { background: transparent; color: var(--muted); }
  .count .codicon { font-size: var(--icon-size); }
  .section-actions { display: none; flex-shrink: 0; }
  .section-header:hover .section-actions, .section-header:focus-within .section-actions { display: flex; }
  .section-header:hover .count, .section-header:focus-within .count { display: none; }
  .icon-button { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 4px; color: var(--muted); transition: background-color 80ms linear; }
  .icon-button:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
  .icon-button .codicon { font-size: var(--icon-size); }
  .rows.stale { opacity: 0.6; }
  .row { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: var(--s2) var(--s3) var(--s2) var(--s4); border-bottom: 1px solid var(--hairline); cursor: pointer; transition: background-color 80ms linear; }
  .row:last-child { border-bottom: none; }
  .row:hover { background: var(--vscode-list-hoverBackground); }
  .row-top { display: flex; align-items: center; gap: var(--s2); min-width: 0; }
  .key { flex-shrink: 0; font-family: var(--mono); font-size: 11px; font-weight: 600; white-space: nowrap; color: var(--vscode-textLink-foreground); }
  .status { --status-color: var(--muted); flex: 0 1 auto; min-width: 0; height: 18px; padding: 0 6px; box-sizing: border-box; border: 1px solid color-mix(in srgb, var(--status-color) 35%, transparent); border-radius: 9px; font-family: var(--mono); font-size: 10.5px; line-height: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--status-color); background: color-mix(in srgb, var(--status-color) 16%, transparent); }
  .spacer { flex: 1; min-width: 0; }
  .age { flex-shrink: 0; font-family: var(--mono); font-size: 11px; white-space: nowrap; text-align: right; color: var(--muted); }
  .summary { min-width: 0; font-size: 13px; line-height: 18px; color: var(--vscode-foreground); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
  .details { display: flex; flex-wrap: wrap; align-items: center; min-width: 0; font-size: 11px; line-height: 16px; color: var(--muted); }
  .detail { display: inline-flex; align-items: center; gap: 3px; min-width: 0; overflow-wrap: anywhere; }
  .detail .codicon { flex-shrink: 0; font-size: 11px; }
  .detail.attention { color: var(--vscode-charts-orange); font-weight: 600; }
  .detail.muted { color: var(--muted); }
  .detail-separator { flex-shrink: 0; white-space: pre; }
  .error { display: flex; align-items: flex-start; gap: var(--s1); padding: 2px var(--s4) var(--s1) var(--s4); font-size: 12px; line-height: 16px; }
  .error .codicon { flex-shrink: 0; margin-top: 1px; font-size: var(--icon-size); color: var(--vscode-errorForeground); }
  .error-text { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; overflow-wrap: anywhere; }
  .note { margin: 0; padding: var(--s2) var(--s4); font-size: 12px; color: var(--muted); }
  .more { margin: 0; padding: var(--s1) var(--s4) var(--s2); font-size: 11px; color: var(--muted); }
  .more a { color: var(--vscode-textLink-foreground); text-decoration: none; cursor: pointer; }
  .more a:hover { text-decoration: underline; }
  .empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--s3); height: 100%; padding: var(--s4); box-sizing: border-box; font-size: 13px; color: var(--muted); }
  .button { display: inline-flex; align-items: center; justify-content: center; gap: var(--s2); height: var(--row-height); padding: 0 var(--s3); border: 1px solid var(--outline); border-radius: 2px; font-size: 13px; font-weight: 500; color: var(--vscode-foreground); transition: background-color 80ms linear; }
  .button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .button .codicon { font-size: var(--icon-size); }
  @media (prefers-reduced-motion: reduce) {
    .row, .section-header, .button, .icon-button, .chevron .codicon { transition: none; }
    .codicon-modifier-spin { animation: none; }
  }
</style>
</head>
<body>
<div id="root"><div class="filter-bar" id="filter-bar" hidden></div><div id="sections"></div></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const FILTER_DEBOUNCE_MS = 150;
  const FILTER_PLACEHOLDER = "Filter — text or fix:, sprint:, assignee:, status:";
  const savedViewState = readSavedViewState();
  let panelState = undefined;
  let filterTimer = undefined;
  // Toggles made while filtering last only until the filter clears, so the saved choices come back.
  let collapsedWhileFiltering = {};
  const filterInput = element("input", "filter-input");
  const clearFilterButton = iconButton("close", "Clear Filter", () => {
    applyFilter("");
    filterInput.focus();
  });

  // Collapse choices are kept per query name; a section with no choice uses its default.
  function readSavedViewState() {
    const saved = vscode.getState();
    const collapsedByName = saved && typeof saved.collapsedByName === "object" && saved.collapsedByName !== null ? saved.collapsedByName : {};
    const filterText = saved && typeof saved.filterText === "string" ? saved.filterText : "";
    return { collapsedByName, filterText };
  }

  function isFiltering() {
    return panelState !== undefined && panelState.isFiltering === true;
  }

  function isCollapsed(section) {
    if (isFiltering()) {
      const filteringChoice = collapsedWhileFiltering[section.name];
      return typeof filteringChoice === "boolean" ? filteringChoice : false;
    }
    const choice = savedViewState.collapsedByName[section.name];
    return typeof choice === "boolean" ? choice : section.isQuiet;
  }

  function setCollapsed(section, collapsed) {
    if (isFiltering()) {
      collapsedWhileFiltering[section.name] = collapsed;
    } else {
      savedViewState.collapsedByName[section.name] = collapsed;
      vscode.setState(savedViewState);
    }
    render();
  }

  function buildFilterBar() {
    const box = element("div", "filter-box");
    filterInput.type = "text";
    filterInput.placeholder = FILTER_PLACEHOLDER;
    filterInput.setAttribute("aria-label", "Filter tickets");
    filterInput.spellcheck = false;
    filterInput.value = savedViewState.filterText;
    filterInput.addEventListener("input", () => {
      saveFilterText(filterInput.value);
      clearTimeout(filterTimer);
      filterTimer = setTimeout(() => postFilter(filterInput.value), FILTER_DEBOUNCE_MS);
    });
    filterInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && filterInput.value !== "") {
        event.preventDefault();
        applyFilter("");
      }
    });
    box.append(codicon("filter"), filterInput, clearFilterButton);
    document.getElementById("filter-bar").append(box);
    syncClearButton();
  }

  function saveFilterText(text) {
    savedViewState.filterText = text;
    vscode.setState(savedViewState);
    syncClearButton();
  }

  function syncClearButton() {
    clearFilterButton.hidden = filterInput.value === "";
  }

  function postFilter(text) {
    vscode.postMessage({ type: "filter", text });
  }

  function applyFilter(text) {
    clearTimeout(filterTimer);
    filterInput.value = text;
    saveFilterText(text);
    postFilter(text);
  }

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

  function codicon(iconName) {
    return element("span", "codicon codicon-" + iconName);
  }

  function iconButton(iconName, title, onClick) {
    const button = element("button", "icon-button");
    button.title = title;
    button.setAttribute("aria-label", title);
    button.append(codicon(iconName));
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  function openUrl(url) {
    vscode.postMessage({ type: "open", url });
  }

  function render() {
    const root = document.getElementById("root");
    const sections = document.getElementById("sections");
    const scrollTop = root.scrollTop;
    sections.replaceChildren();
    if (panelState === undefined) {
      return;
    }
    document.getElementById("filter-bar").hidden = panelState.sections.length === 0;
    if (panelState.sections.length === 0) {
      sections.append(emptyView());
      return;
    }
    const visibleSections = panelState.sections.filter((section) => !section.hiddenByFilter);
    if (visibleSections.length === 0) {
      sections.append(noMatchView());
    }
    visibleSections.forEach((section) => sections.append(sectionElement(section)));
    root.scrollTop = scrollTop;
  }

  function noMatchView() {
    const note = element("p", "no-match", "No tickets match " + panelState.filterText.trim());
    const clear = element("button", "link-button", "Clear filter");
    clear.addEventListener("click", () => {
      applyFilter("");
      filterInput.focus();
    });
    note.append(clear);
    return note;
  }

  function filterChipButton(chip, className) {
    const button = element("button", className, chip.text);
    button.title = chip.title;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      applyFilter(chip.filterText);
    });
    button.addEventListener("keydown", (event) => event.stopPropagation());
    return button;
  }

  function emptyView() {
    const empty = element("div", "empty");
    empty.append(element("span", undefined, "No queries"));
    const button = element("button", "button");
    button.append(codicon("gear"), element("span", undefined, "Edit Queries"));
    button.addEventListener("click", () => vscode.postMessage({ type: "editQueries" }));
    empty.append(button);
    return empty;
  }

  function sectionElement(section) {
    const collapsed = isCollapsed(section);
    const wrapper = element("section", "section" + (collapsed ? "" : " expanded") + (section.isQuiet ? " quiet" : ""));
    wrapper.append(sectionHeader(section, collapsed));
    if (!collapsed) {
      wrapper.append(...sectionBody(section));
    }
    return wrapper;
  }

  function sectionHeader(section, collapsed) {
    const header = element("div", "section-header");
    header.tabIndex = 0;
    header.title = section.headerTitle;
    header.setAttribute("role", "button");
    header.setAttribute("aria-expanded", String(!collapsed));
    const chevron = element("span", "chevron");
    chevron.append(codicon("chevron-right"));
    const count = element("span", "count" + (section.isLoading ? " loading" : ""));
    if (section.isLoading) {
      count.append(codicon("sync codicon-modifier-spin"));
    } else {
      count.textContent = section.countText;
    }
    const actions = element("span", "section-actions");
    actions.append(iconButton("sync", "Refresh", () => vscode.postMessage({ type: "refresh", queryIndex: section.queryIndex })));
    if (section.searchUrl) {
      actions.append(iconButton("link-external", "Open in Jira", () => openUrl(section.searchUrl)));
    }
    header.append(chevron, element("span", "section-name ellipsis", section.name), count, actions);
    const toggle = () => setCollapsed(section, !collapsed);
    header.addEventListener("click", toggle);
    header.addEventListener("keydown", (event) => {
      if (event.target === header && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        toggle();
      }
    });
    return header;
  }

  function sectionBody(section) {
    const parts = [];
    if (section.error) {
      const error = element("div", "error");
      error.append(codicon("error"), element("span", "error-text", section.error));
      parts.push(error);
    }
    if (section.rows.length > 0) {
      parts.push(rowList(section));
    } else if (!section.isLoading && !section.error) {
      parts.push(element("p", "note", "No tickets"));
    }
    if (section.hasMore && section.searchUrl) {
      const more = element("p", "more", "Showing " + section.shownCount + " · ");
      const link = element("a", undefined, "Open all in Jira");
      link.tabIndex = 0;
      link.addEventListener("click", () => openUrl(section.searchUrl));
      link.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          openUrl(section.searchUrl);
        }
      });
      more.append(link);
      parts.push(more);
    }
    return parts;
  }

  function rowList(section) {
    const list = element("div", "rows" + (section.error ? " stale" : ""));
    section.rows.forEach((row) => list.append(rowElement(row)));
    return list;
  }

  function rowElement(row) {
    const rowElement = element("div", "row");
    rowElement.tabIndex = 0;
    rowElement.title = row.title;
    rowElement.setAttribute("role", "link");
    rowElement.append(rowTop(row));
    if (row.summary) {
      rowElement.append(element("div", "summary", row.summary));
    }
    if (row.details.length > 0) {
      rowElement.append(detailsLine(row.details));
    }
    if (row.url) {
      rowElement.addEventListener("click", () => openUrl(row.url));
      rowElement.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openUrl(row.url);
        }
      });
    }
    return rowElement;
  }

  function rowTop(row) {
    const top = element("div", "row-top");
    top.append(element("span", "key", row.key));
    if (row.status) {
      const status = row.statusFilterChip ? filterChipButton(row.statusFilterChip, "status filter-chip") : element("span", "status", row.status);
      if (!row.statusFilterChip) {
        status.title = "status: " + row.status;
      }
      if (row.statusColor) {
        status.style.setProperty("--status-color", row.statusColor);
      }
      top.append(status);
    }
    top.append(element("span", "spacer"));
    if (row.age) {
      const age = element("span", "age", row.age);
      age.title = row.ageTitle;
      top.append(age);
    }
    return top;
  }

  function detailsLine(details) {
    const line = element("div", "details");
    details.forEach((detail, index) => {
      if (index > 0) {
        line.append(element("span", "detail-separator", " · "));
      }
      const item = element("span", "detail" + (detail.tone ? " " + detail.tone : ""));
      item.title = detail.title;
      if (detail.icon) {
        item.append(codicon(detail.icon));
      }
      item.append(...detailText(detail));
      line.append(item);
    });
    return line;
  }

  function detailText(detail) {
    if (!detail.filterChips || detail.filterChips.length === 0) {
      return [element("span", undefined, detail.text)];
    }
    const parts = [];
    detail.filterChips.forEach((chip, index) => {
      if (index > 0) {
        parts.push(element("span", undefined, ", "));
      }
      parts.push(filterChipButton(chip, "filter-chip"));
    });
    return parts;
  }

  window.addEventListener("message", (event) => {
    if (event.data && event.data.type === "state") {
      panelState = event.data.state;
      if (!isFiltering()) {
        collapsedWhileFiltering = {};
      }
      render();
    }
  });
  buildFilterBar();
  vscode.postMessage({ type: "ready", filterText: savedViewState.filterText });
</script>
</body>
</html>`;
}
