import * as crypto from "crypto";
import * as vscode from "vscode";
import { LiveSessionMonitor } from "./liveSessions";
import { tildePath } from "./paths";
import { Registry } from "./registry";
import { deleteSessionFiles, findSessionFiles, SessionFiles } from "./sessionDeletion";
import {
  deletionCandidates,
  HistoryQuery,
  historyRow,
  HistoryRow,
  HistoryScope,
  matchingSessionIds,
  newestFirst,
} from "./sessionHistory";
import { SessionIndex } from "./sessionIndex";
import { statusColorId } from "./sessionStatuses";
import { sessionStatusFor } from "./sessionStatusView";

export interface HistoryPanelDependencies {
  extensionUri: vscode.Uri;
  sessionIndex: SessionIndex;
  liveMonitor: LiveSessionMonitor;
  registry: Registry;
  claudeHome: string;
}

interface PendingDeletion {
  previewId: number;
  sessionFiles: SessionFiles[];
}

type PanelMessage =
  | { type: "ready" }
  | { type: "query"; requestId: number; searchText: string; scope: HistoryScope; repoName: string | null; olderThanDays: number | null }
  | { type: "previewDelete"; sessionIds: string[]; isPurge: boolean }
  | { type: "confirmDelete"; previewId: number }
  | { type: "cancelDelete" }
  | { type: "open"; sessionId: string }
  | { type: "togglePin"; sessionId: string }
  | { type: "copyId"; sessionId: string }
  | { type: "openTranscript"; sessionId: string }
  | { type: "openPr"; sessionId: string }
  | { type: "refresh" };

const HISTORY_SCOPES: HistoryScope[] = ["all", "pinned", "live"];
const STATE_POST_DELAY_MS = 300;
const BYTES_PER_MB = 1024 * 1024;

// One panel per window; the open command brings it forward.
export class HistoryPanel {
  private static openPanel: HistoryPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private rows: HistoryRow[] = [];
  private statePostTimer: NodeJS.Timeout | undefined;
  private pendingDeletion: PendingDeletion | undefined;
  private nextPreviewId = 1;

  static show(dependencies: HistoryPanelDependencies): void {
    if (HistoryPanel.openPanel !== undefined) {
      HistoryPanel.openPanel.panel.reveal();
      return;
    }
    const mediaRoot = vscode.Uri.joinPath(dependencies.extensionUri, "media");
    const panel = vscode.window.createWebviewPanel("overseer.history", "Session History", vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [mediaRoot],
    });
    HistoryPanel.openPanel = new HistoryPanel(panel, dependencies);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly dependencies: HistoryPanelDependencies,
  ) {
    const codiconStylesheet = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(dependencies.extensionUri, "media", "codicons", "codicon.css"),
    );
    panel.webview.html = panelHtml(crypto.randomBytes(16).toString("base64"), panel.webview.cspSource, codiconStylesheet.toString());
    const { sessionIndex, liveMonitor, registry } = dependencies;
    this.disposables.push(
      panel.webview.onDidReceiveMessage((message: PanelMessage) => void this.receive(message)),
      sessionIndex.onDidChange(() => this.schedulePostState()),
      liveMonitor.onDidChange(() => this.schedulePostState()),
      registry.onDidChange(() => this.schedulePostState()),
    );
    panel.onDidDispose(() => {
      HistoryPanel.openPanel = undefined;
      clearTimeout(this.statePostTimer);
      this.disposables.forEach((disposable) => disposable.dispose());
    });
  }

  private buildRows(): HistoryRow[] {
    const { sessionIndex, liveMonitor, registry } = this.dependencies;
    const labels = registry.labels();
    const rows = sessionIndex.currentSessions.map((meta) => {
      const liveSession = liveMonitor.get(meta.sessionId);
      const markedStatus = sessionStatusFor(registry, meta.sessionId);
      return historyRow(meta, {
        label: labels[meta.sessionId],
        isPinned: registry.isPinned(meta.sessionId),
        liveState: liveSession === undefined ? undefined : liveSession.status === "busy" ? "busy" : "idle",
        status: markedStatus && {
          name: markedStatus.name,
          icon: markedStatus.icon,
          colorVariable: `--vscode-${statusColorId(markedStatus.color).replace(/\./g, "-")}`,
          reason: markedStatus.reason,
        },
      });
    });
    return newestFirst(rows);
  }

  // Index, live, and registry changes arrive in bursts, so they post one state after the burst.
  private schedulePostState(): void {
    clearTimeout(this.statePostTimer);
    this.statePostTimer = setTimeout(() => this.postState(), STATE_POST_DELAY_MS);
  }

  private postState(): void {
    this.rows = this.buildRows();
    void this.panel.webview.postMessage({
      type: "state",
      rows: this.rows,
      isRefreshing: this.dependencies.sessionIndex.isRefreshing,
    });
  }

  private async refreshSources(): Promise<void> {
    const { sessionIndex, liveMonitor } = this.dependencies;
    await Promise.all([sessionIndex.refresh(), liveMonitor.refresh()]);
    this.postState();
  }

  private findMeta(sessionId: string) {
    return this.dependencies.sessionIndex.currentSessions.find((session) => session.sessionId === sessionId);
  }

  // The webview gets the file list to show; the paths to delete stay here, so the webview can only confirm or cancel.
  private async previewDeletion(sessionIds: string[], isPurge: boolean): Promise<void> {
    const { claudeHome, liveMonitor } = this.dependencies;
    await liveMonitor.refresh();
    this.rows = this.buildRows();
    const candidates = deletionCandidates(this.rows, sessionIds, isPurge);
    const rowsById = new Map(this.rows.map((row) => [row.sessionId, row]));
    const sessionFiles: SessionFiles[] = [];
    for (const sessionId of candidates.deletableIds) {
      const meta = this.findMeta(sessionId);
      if (meta !== undefined) {
        sessionFiles.push(await findSessionFiles(claudeHome, sessionId, meta.transcriptFile));
      }
    }
    const previewId = this.nextPreviewId++;
    this.pendingDeletion = { previewId, sessionFiles };
    void this.panel.webview.postMessage({
      type: "deletePreview",
      previewId,
      isPurge,
      pinnedCount: candidates.pinnedIds.length,
      liveCount: candidates.liveIds.length,
      claudeHome: tildePath(claudeHome),
      sessions: sessionFiles.map((files) => ({
        sessionId: files.sessionId,
        title: rowsById.get(files.sessionId)?.title ?? files.sessionId,
        lastActivityMs: rowsById.get(files.sessionId)?.lastActivityMs ?? 0,
        sizeBytes: files.sizeBytes,
        paths: files.paths.map(tildePath),
      })),
    });
  }

  private async confirmDeletion(previewId: number): Promise<void> {
    const { claudeHome, liveMonitor, registry, sessionIndex } = this.dependencies;
    const pendingDeletion = this.pendingDeletion;
    this.pendingDeletion = undefined;
    if (pendingDeletion === undefined || pendingDeletion.previewId !== previewId) {
      return;
    }
    const liveSessions = await liveMonitor.refresh();
    const stillIdleFiles = pendingDeletion.sessionFiles.filter((files) => !liveSessions.has(files.sessionId));
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Overseer: deleting ${stillIdleFiles.length} sessions…` },
      () => deleteSessionFiles(claudeHome, stillIdleFiles),
    );
    await registry.forgetSessions(result.deletedIds);
    await sessionIndex.refresh();
    void this.panel.webview.postMessage({ type: "deleteDone" });

    const deletedBytes = stillIdleFiles
      .filter((files) => result.deletedIds.includes(files.sessionId))
      .reduce((total, files) => total + files.sizeBytes, 0);
    const skippedCount = pendingDeletion.sessionFiles.length - stillIdleFiles.length;
    const summaryParts = [
      `deleted ${result.deletedIds.length} ${result.deletedIds.length === 1 ? "session" : "sessions"} (${(deletedBytes / BYTES_PER_MB).toFixed(1)} MB)`,
    ];
    if (skippedCount > 0) {
      summaryParts.push(`skipped ${skippedCount} that started running`);
    }
    if (result.failures.length > 0) {
      summaryParts.push(`${result.failures.length} failed: ${result.failures[0].error}`);
    }
    const summary = `Overseer: ${summaryParts.join(", ")}.`;
    if (result.failures.length > 0) {
      void vscode.window.showWarningMessage(summary);
    } else {
      void vscode.window.showInformationMessage(summary);
    }
  }

  private async receive(message: PanelMessage): Promise<void> {
    const { registry } = this.dependencies;
    switch (message.type) {
      case "ready":
        this.postState();
        await this.refreshSources();
        return;
      case "refresh":
        await this.refreshSources();
        return;
      case "query": {
        if (!HISTORY_SCOPES.includes(message.scope)) {
          return;
        }
        const historyQuery: HistoryQuery = {
          searchText: String(message.searchText),
          scope: message.scope,
          repoName: message.repoName ?? undefined,
          olderThanDays: typeof message.olderThanDays === "number" ? message.olderThanDays : undefined,
          nowMs: Date.now(),
        };
        const sessionIds = matchingSessionIds(this.rows, historyQuery);
        void this.panel.webview.postMessage({ type: "matches", requestId: message.requestId, sessionIds });
        return;
      }
      case "previewDelete":
        await this.previewDeletion(message.sessionIds, message.isPurge);
        return;
      case "confirmDelete":
        await this.confirmDeletion(message.previewId);
        return;
      case "cancelDelete":
        this.pendingDeletion = undefined;
        return;
      case "open":
        await vscode.commands.executeCommand("overseer.openSessionById", message.sessionId);
        return;
      case "togglePin":
        if (registry.isPinned(message.sessionId)) {
          await registry.unpin(message.sessionId);
        } else {
          await registry.pin(message.sessionId);
        }
        return;
      case "copyId":
        await vscode.env.clipboard.writeText(message.sessionId);
        void vscode.window.showInformationMessage("Overseer: session ID copied.");
        return;
      case "openTranscript": {
        const meta = this.findMeta(message.sessionId);
        if (meta !== undefined) {
          await vscode.window.showTextDocument(vscode.Uri.file(meta.transcriptFile), { preview: true });
        }
        return;
      }
      case "openPr": {
        const prUrl = this.findMeta(message.sessionId)?.prUrl;
        if (prUrl !== undefined) {
          await vscode.env.openExternal(vscode.Uri.parse(prUrl));
        }
        return;
      }
    }
  }
}

function panelHtml(nonce: string, cspSource: string, codiconStylesheet: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${cspSource}; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Session History</title>
<link rel="stylesheet" href="${codiconStylesheet}">
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
  }
  .muted { color: var(--vscode-descriptionForeground); }
  .mono { font-family: var(--vscode-editor-font-family); }
  :focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  button {
    font: inherit;
    height: 24px;
    padding: 0 12px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 1px solid var(--vscode-button-border, transparent);
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground);
    cursor: pointer;
  }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  button.icon-button { width: 24px; padding: 0; justify-content: center; border: none; background: none; color: var(--vscode-icon-foreground); }
  button.icon-button:hover { background: var(--vscode-toolbar-hoverBackground); }
  input[type="search"], select {
    font: inherit;
    height: 24px;
    padding: 0 6px;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, transparent));
  }
  select { max-width: 200px; color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); border-color: var(--vscode-dropdown-border); }

  .toolbar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
  }
  .search { flex: 1; min-width: 160px; position: relative; display: flex; align-items: center; }
  .search .codicon { position: absolute; left: 6px; color: var(--vscode-descriptionForeground); pointer-events: none; }
  .search input { width: 100%; padding-left: 24px; }
  .scope { display: inline-flex; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); }
  .scope button { border: none; background: none; color: var(--vscode-descriptionForeground); }
  .scope button:hover { background: var(--vscode-list-hoverBackground); color: var(--vscode-foreground); }
  .scope button[aria-checked="true"] { background: var(--vscode-list-inactiveSelectionBackground); color: var(--vscode-foreground); font-weight: 600; }
  .count { white-space: nowrap; font-variant-numeric: tabular-nums; }

  .panes { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(280px, 2fr) 3fr; }
  .list { overflow-y: auto; border-right: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); }
  .list:focus { outline: none; }
  .item { height: 48px; padding: 6px 12px 6px 8px; display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; grid-template-rows: 20px 16px; column-gap: 8px; cursor: pointer; }
  .item:hover { background: var(--vscode-list-hoverBackground); }
  .item[aria-selected="true"] { background: var(--vscode-list-inactiveSelectionBackground); color: var(--vscode-list-inactiveSelectionForeground, inherit); }
  .list:focus-within .item[aria-selected="true"] { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .list:focus-within .item[aria-selected="true"] .muted { color: inherit; opacity: 0.8; }
  .item .lead { grid-row: 1 / 3; align-self: center; display: flex; justify-content: center; }
  .item .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 20px; }
  .item .age { line-height: 20px; font-size: 0.9em; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .item .meta { grid-column: 2 / 4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.9em; line-height: 16px; }
  .item .pin { font-size: 12px; margin-left: 4px; vertical-align: -1px; }
  .live { color: var(--vscode-charts-green); }
  .list .empty { padding: 16px; }

  .detail { overflow-y: auto; padding: 16px 24px 24px; }
  .detail h1 { margin: 0 0 12px; font-size: 1.4em; font-weight: 600; line-height: 1.3; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
  .facts { display: grid; grid-template-columns: 120px minmax(0, 1fr); column-gap: 12px; margin: 0; padding: 12px 0; border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); }
  .facts dt, .facts dd { min-height: 24px; display: flex; align-items: center; margin: 0; }
  .facts dt { color: var(--vscode-descriptionForeground); }
  .facts dd { gap: 6px; flex-wrap: wrap; overflow-wrap: anywhere; }
  .facts a { color: var(--vscode-textLink-foreground); text-decoration: none; cursor: pointer; }
  .facts a:hover { color: var(--vscode-textLink-activeForeground); text-decoration: underline; }
  .chip { padding: 0 6px; line-height: 18px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); }
  .prose h2 { margin: 16px 0 6px; font-size: 0.9em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); }
  .prose p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; }
  .detail .empty { margin-top: 48px; text-align: center; }

  button.danger { color: var(--vscode-editor-background); background: var(--vscode-errorForeground); }
  button.danger:hover { opacity: 0.9; background: var(--vscode-errorForeground); }
  button:disabled { opacity: 0.5; cursor: default; }
  .confirm { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 24px 24px; }
  .confirm[hidden], .panes[hidden] { display: none; }
  .confirm h1 { margin: 0 0 4px; font-size: 1.4em; font-weight: 600; overflow-wrap: anywhere; }
  .confirm .warning { margin: 0 0 16px; color: var(--vscode-errorForeground); }
  .confirm h2 { margin: 16px 0 6px; font-size: 0.9em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); }
  .confirm ul { margin: 0; padding-left: 20px; line-height: 1.6; }
  .doomed { max-height: 320px; overflow-y: auto; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); }
  .doomed-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; column-gap: 12px; padding: 4px 8px; min-height: 28px; align-items: center; }
  .doomed-row + .doomed-row { border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); }
  .doomed-row .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .doomed-row .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .typed { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
  .typed input { width: 96px; font: inherit; height: 24px; padding: 0 6px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, transparent)); }
  .confirm-actions { display: flex; gap: 8px; margin-top: 16px; }

  @media (max-width: 719px) {
    .toolbar { flex-wrap: wrap; }
    .search { flex-basis: 100%; }
    .panes { grid-template-columns: 1fr; grid-template-rows: minmax(0, 1fr) minmax(0, 1fr); }
    .list { border-right: none; border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); }
  }
</style>
</head>
<body>
<header class="toolbar">
  <label class="search">
    <i class="codicon codicon-search" aria-hidden="true"></i>
    <input type="search" id="search" placeholder="Search title, prompts, recap, branch, or ID. repo:&lt;name&gt; matches any repo it touched." aria-label="Search sessions" spellcheck="false">
  </label>
  <div class="scope" role="radiogroup" aria-label="Show">
    <button role="radio" data-scope="all" aria-checked="true">All</button>
    <button role="radio" data-scope="pinned" aria-checked="false">Pinned</button>
    <button role="radio" data-scope="live" aria-checked="false">Live</button>
  </div>
  <select id="repo" aria-label="Repo"><option value="">All repos</option></select>
  <select id="age" aria-label="Age">
    <option value="">Any age</option>
    <option value="7">Idle 7+ days</option>
    <option value="30">Idle 30+ days</option>
    <option value="90">Idle 90+ days</option>
    <option value="180">Idle 180+ days</option>
    <option value="365">Idle 1+ year</option>
  </select>
  <span id="count" class="count muted"></span>
  <button id="purge" title="Delete every session in the list, except pinned and running ones"><i class="codicon codicon-trash"></i>Purge…</button>
  <button class="icon-button" id="refresh" title="Refresh the session index" aria-label="Refresh the session index"><i class="codicon codicon-refresh"></i></button>
</header>
<div class="panes">
  <div id="list" class="list" role="listbox" tabindex="0" aria-label="Sessions"></div>
  <article id="detail" class="detail" aria-live="polite"></article>
</div>
<section id="confirm" class="confirm" hidden aria-live="polite"></section>
<script nonce="${nonce}">
  const vscodeApi = acquireVsCodeApi();
  const QUERY_DELAY_MS = 80;
  const MS_PER_MINUTE = 60000;
  const MS_PER_HOUR = 60 * MS_PER_MINUTE;
  const MS_PER_DAY = 24 * MS_PER_HOUR;
  const SHORT_HASH_LENGTH = 7;

  const searchInput = document.getElementById("search");
  const repoSelect = document.getElementById("repo");
  const ageSelect = document.getElementById("age");
  const purgeButton = document.getElementById("purge");
  const panes = document.querySelector(".panes");
  const confirmScreen = document.getElementById("confirm");
  const list = document.getElementById("list");
  const detail = document.getElementById("detail");
  const countLabel = document.getElementById("count");
  const scopeButtons = [...document.querySelectorAll(".scope button")];

  const savedView = vscodeApi.getState() || {};
  let rowsById = new Map();
  let itemsById = new Map();
  let shownIds = [];
  let selectedId = savedView.selectedId;
  let scope = savedView.scope || "all";
  let isRefreshing = false;
  let latestRequestId = 0;
  let queryTimer;
  searchInput.value = savedView.searchText || "";
  ageSelect.value = savedView.olderThanDays || "";

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

  function codicon(iconName, extraClass) {
    const [glyphName, modifier] = iconName.split("~");
    const icon = element("i", "codicon codicon-" + glyphName + (modifier === "spin" ? " codicon-modifier-spin" : "") + (extraClass ? " " + extraClass : ""));
    icon.setAttribute("aria-hidden", "true");
    return icon;
  }

  function formatAge(timestampMs) {
    const elapsedMs = Math.max(0, Date.now() - timestampMs);
    if (elapsedMs < MS_PER_MINUTE) return "just now";
    if (elapsedMs < MS_PER_HOUR) return Math.floor(elapsedMs / MS_PER_MINUTE) + "m ago";
    if (elapsedMs < MS_PER_DAY) return Math.floor(elapsedMs / MS_PER_HOUR) + "h ago";
    return Math.floor(elapsedMs / MS_PER_DAY) + "d ago";
  }

  function formatSize(sizeBytes) {
    if (sizeBytes < 1024) return sizeBytes + " B";
    if (sizeBytes < 1024 * 1024) return (sizeBytes / 1024).toFixed(0) + " KB";
    return (sizeBytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function saveView() {
    vscodeApi.setState({ selectedId, scope, searchText: searchInput.value, repoName: repoSelect.value, olderThanDays: ageSelect.value });
  }

  function leadIcon(row) {
    if (row.liveState === "busy") return codicon("loading~spin", "live");
    if (row.liveState === "idle") return codicon("pulse", "live");
    if (row.status) {
      const icon = codicon(row.status.icon);
      icon.style.color = "var(" + row.status.colorVariable + ")";
      return icon;
    }
    return codicon("comment-discussion", "muted");
  }

  function metaLine(row) {
    const parts = [row.repoName];
    if (row.branch) parts.push(row.branch);
    if (row.repoNames.length > 1) parts.push("+" + (row.repoNames.length - 1) + (row.repoNames.length === 2 ? " repo" : " repos"));
    if (row.liveState) parts.unshift(row.liveState === "busy" ? "working" : "running");
    return parts.join("  ·  ");
  }

  function listItem(row) {
    const item = element("div", "item");
    item.setAttribute("role", "option");
    item.id = "session-" + row.sessionId;
    item.dataset.sessionId = row.sessionId;
    const lead = element("span", "lead");
    lead.append(leadIcon(row));
    const title = element("span", "title", row.title);
    if (row.isPinned) title.append(codicon("pinned", "pin muted"));
    item.append(lead, title, element("span", "age muted", row.liveState ? "" : formatAge(row.lastActivityMs)), element("span", "meta muted", metaLine(row)));
    item.addEventListener("click", () => select(row.sessionId, false));
    item.addEventListener("dblclick", () => post("open", row.sessionId));
    return item;
  }

  function post(type, sessionId) {
    vscodeApi.postMessage({ type, sessionId });
  }

  function actionButton(iconName, label, onClick, isPrimary) {
    const button = element("button", isPrimary ? "primary" : "");
    button.append(codicon(iconName), document.createTextNode(label));
    button.addEventListener("click", onClick);
    return button;
  }

  function fact(facts, label, value) {
    facts.append(element("dt", "", label));
    const valueCell = element("dd");
    if (typeof value === "string") {
      valueCell.textContent = value;
    } else {
      valueCell.append(...value);
    }
    facts.append(valueCell);
  }

  function link(text, onClick) {
    const anchor = element("a", "", text);
    anchor.tabIndex = 0;
    anchor.addEventListener("click", onClick);
    anchor.addEventListener("keydown", (event) => event.key === "Enter" && onClick());
    return anchor;
  }

  function stateValue(row) {
    const parts = [];
    if (row.liveState) {
      const liveLabel = element("span", "live");
      liveLabel.append(codicon(row.liveState === "busy" ? "loading~spin" : "pulse"), document.createTextNode(row.liveState === "busy" ? " Working" : " Running"));
      parts.push(liveLabel);
    }
    if (row.status) {
      const statusLabel = element("span");
      const icon = codicon(row.status.icon);
      icon.style.color = "var(" + row.status.colorVariable + ")";
      statusLabel.append(icon, document.createTextNode(" " + row.status.name + (row.status.reason ? " — " + row.status.reason : "")));
      parts.push(statusLabel);
    }
    if (row.isPinned) parts.push(element("span", "chip", "Pinned"));
    if (parts.length === 0) parts.push(element("span", "muted", "Not running"));
    return parts;
  }

  function proseBlock(heading, text) {
    const block = element("section", "prose");
    block.append(element("h2", "", heading), element("p", "", text));
    return block;
  }

  function renderDetail() {
    const row = rowsById.get(selectedId);
    if (row === undefined) {
      detail.replaceChildren(element("p", "empty muted", shownIds.length === 0 ? "" : "Pick a session to see its details."));
      return;
    }
    const actions = element("div", "actions");
    actions.append(
      actionButton(row.liveState ? "terminal" : "play", "Open", () => post("open", row.sessionId), true),
      actionButton(row.isPinned ? "pinned" : "pin", row.isPinned ? "Unpin" : "Pin to Sidebar", () => post("togglePin", row.sessionId)),
      actionButton("copy", "Copy ID", () => post("copyId", row.sessionId)),
      actionButton("file", "Open Transcript", () => post("openTranscript", row.sessionId)),
    );
    if (!row.liveState) {
      actions.append(actionButton("trash", "Delete…", () => requestDeletion([row.sessionId], false)));
    }
    const facts = element("dl", "facts");
    fact(facts, "State", stateValue(row));
    fact(facts, "Last active", formatAge(row.lastActivityMs) + "  ·  " + new Date(row.lastActivityMs).toLocaleString());
    fact(facts, "Folder", [element("span", "mono", row.folder)]);
    if (row.branch) fact(facts, "Branch", [element("span", "mono", row.branch)]);
    fact(facts, "Repos", row.repoNames.map((repoName) => element("span", "chip", repoName)));
    if (row.prUrl) fact(facts, "Pull request", [link(row.prUrl.replace(/^https:\\/\\/github\\.com\\//, ""), () => post("openPr", row.sessionId))]);
    if (row.commitHashes.length > 0) {
      fact(facts, "Commits", row.commitHashes.map((hash) => element("span", "mono chip", hash.slice(0, SHORT_HASH_LENGTH))));
    }
    fact(facts, "Transcript", formatSize(row.sizeBytes));
    fact(facts, "Session ID", [element("span", "mono", row.sessionId)]);
    const blocks = [element("h1", "", row.title), actions, facts];
    if (row.recap) blocks.push(proseBlock("Recap", row.recap));
    if (row.firstPrompt && row.firstPrompt !== row.title) blocks.push(proseBlock("First prompt", row.firstPrompt));
    if (row.lastPrompt && row.lastPrompt !== row.firstPrompt) blocks.push(proseBlock("Last prompt", row.lastPrompt));
    detail.replaceChildren(...blocks);
    detail.scrollTop = 0;
  }

  function select(sessionId, shouldScroll) {
    itemsById.get(selectedId)?.setAttribute("aria-selected", "false");
    selectedId = sessionId;
    const item = itemsById.get(sessionId);
    if (item) {
      item.setAttribute("aria-selected", "true");
      list.setAttribute("aria-activedescendant", item.id);
      if (shouldScroll) item.scrollIntoView({ block: "nearest" });
    }
    saveView();
    renderDetail();
  }

  function renderList() {
    const items = shownIds.map((sessionId) => itemsById.get(sessionId)).filter(Boolean);
    if (items.length === 0) {
      const emptyText = isRefreshing && rowsById.size === 0 ? "Indexing sessions…" : "No sessions match.";
      list.replaceChildren(element("p", "empty muted", emptyText));
    } else {
      list.replaceChildren(...items);
    }
    purgeButton.disabled = shownIds.length === 0;
    countLabel.textContent = shownIds.length.toLocaleString() + " of " + rowsById.size.toLocaleString();
    const nextId = shownIds.includes(selectedId) ? selectedId : shownIds[0];
    select(nextId, true);
  }

  function renderRepoOptions(rows) {
    const sessionCounts = new Map();
    for (const row of rows) {
      for (const repoName of new Set(row.repoNames)) {
        sessionCounts.set(repoName, (sessionCounts.get(repoName) || 0) + 1);
      }
    }
    const pickedRepo = repoSelect.value || savedView.repoName || "";
    const options = [...sessionCounts.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([repoName, sessionCount]) => {
        const option = element("option", "", repoName + " (" + sessionCount + ")");
        option.value = repoName;
        return option;
      });
    const allOption = element("option", "", "All repos");
    allOption.value = "";
    repoSelect.replaceChildren(allOption, ...options);
    repoSelect.value = sessionCounts.has(pickedRepo) ? pickedRepo : "";
  }

  function sendQuery() {
    latestRequestId += 1;
    vscodeApi.postMessage({
      type: "query",
      requestId: latestRequestId,
      searchText: searchInput.value,
      scope,
      repoName: repoSelect.value || null,
      olderThanDays: ageSelect.value ? Number(ageSelect.value) : null,
    });
    saveView();
  }

  function scheduleQuery() {
    clearTimeout(queryTimer);
    queryTimer = setTimeout(sendQuery, QUERY_DELAY_MS);
  }

  function setScope(nextScope) {
    scope = nextScope;
    scopeButtons.forEach((button) => button.setAttribute("aria-checked", String(button.dataset.scope === scope)));
    sendQuery();
  }

  function moveSelection(offset) {
    if (shownIds.length === 0) return;
    const currentIndex = shownIds.indexOf(selectedId);
    const nextIndex = Math.min(shownIds.length - 1, Math.max(0, currentIndex + offset));
    select(shownIds[nextIndex], true);
  }

  const PAGE_ROW_COUNT = 10;
  function navigate(event) {
    const offsets = { ArrowDown: 1, ArrowUp: -1, PageDown: PAGE_ROW_COUNT, PageUp: -PAGE_ROW_COUNT };
    if (event.key in offsets) {
      event.preventDefault();
      moveSelection(offsets[event.key]);
    } else if (event.key === "Enter" && selectedId) {
      event.preventDefault();
      post("open", selectedId);
    }
  }

  function requestDeletion(sessionIds, isPurge) {
    vscodeApi.postMessage({ type: "previewDelete", sessionIds, isPurge });
  }

  function showConfirm(isShown) {
    confirmScreen.hidden = !isShown;
    panes.hidden = isShown;
    document.querySelector(".toolbar").inert = isShown;
    if (!isShown) {
      confirmScreen.replaceChildren();
      list.focus();
    }
  }

  function cancelDeletion() {
    vscodeApi.postMessage({ type: "cancelDelete" });
    showConfirm(false);
  }

  function plural(count, singular, pluralForm) {
    return count.toLocaleString() + " " + (count === 1 ? singular : pluralForm);
  }

  function removedLocations(preview) {
    const home = preview.claudeHome;
    return [
      "The transcript: " + home + "/projects/<folder>/<id>.jsonl",
      "Subagent transcripts and tool output: " + home + "/projects/<folder>/<id>/",
      "File edit backups: " + home + "/file-history/<id>/",
      "Shell environment: " + home + "/session-env/<id>/",
      "The session's prompts in " + home + "/history.jsonl, which feeds the up-arrow prompt history",
      "Overseer's pin, label, group, status, and link marks",
    ];
  }

  function renderDeletePreview(preview) {
    const sessionCount = preview.sessions.length;
    const totalBytes = preview.sessions.reduce((total, session) => total + session.sizeBytes, 0);
    const blocks = [];
    if (sessionCount === 0) {
      blocks.push(element("h1", "", "Nothing to delete"));
    } else if (preview.isPurge) {
      blocks.push(element("h1", "", "Purge " + plural(sessionCount, "session", "sessions") + " permanently?"));
    } else {
      blocks.push(element("h1", "", "Delete \u201c" + preview.sessions[0].title + "\u201d permanently?"));
    }
    if (sessionCount > 0) {
      blocks.push(element("p", "warning", "This removes " + formatSize(totalBytes) + " from this computer. It can't be undone."));
    }
    const skippedParts = [];
    if (preview.liveCount > 0) skippedParts.push(plural(preview.liveCount, "running session", "running sessions"));
    if (preview.pinnedCount > 0) skippedParts.push(plural(preview.pinnedCount, "pinned session", "pinned sessions"));
    if (skippedParts.length > 0) {
      blocks.push(element("p", "muted", "Skips " + skippedParts.join(" and ") + ". Stop or unpin a session to include it."));
    }
    if (sessionCount > 0) {
      blocks.push(element("h2", "", "Removes, for each session"));
      const locationList = element("ul");
      locationList.append(...removedLocations(preview).map((location) => element("li", "", location)));
      blocks.push(locationList);
      blocks.push(element("h2", "", plural(sessionCount, "session", "sessions")));
      const doomedList = element("div", "doomed");
      doomedList.append(
        ...preview.sessions.map((session) => {
          const doomedRow = element("div", "doomed-row");
          doomedRow.title = session.paths.join("\\n");
          doomedRow.append(
            element("span", "title", session.title),
            element("span", "num muted", formatAge(session.lastActivityMs)),
            element("span", "num muted", formatSize(session.sizeBytes)),
          );
          return doomedRow;
        }),
      );
      blocks.push(doomedList);
    }

    const actions = element("div", "confirm-actions");
    const cancelButton = element("button", "", sessionCount === 0 ? "Back" : "Cancel");
    cancelButton.addEventListener("click", cancelDeletion);
    if (sessionCount > 0) {
      const deleteButton = element("button", "danger");
      deleteButton.append(codicon("trash"), document.createTextNode(preview.isPurge ? " Purge permanently" : " Delete permanently"));
      deleteButton.addEventListener("click", () => {
        deleteButton.disabled = true;
        cancelButton.disabled = true;
        vscodeApi.postMessage({ type: "confirmDelete", previewId: preview.previewId });
      });
      // A purge of more than one session asks for the count typed out, so a stray Enter can't run it.
      if (preview.isPurge && sessionCount > 1) {
        const typed = element("label", "typed");
        const countField = element("input");
        countField.type = "text";
        countField.inputMode = "numeric";
        countField.setAttribute("aria-label", "Type the session count to confirm");
        typed.append(document.createTextNode("Type " + sessionCount + " to confirm:"), countField);
        blocks.push(typed);
        deleteButton.disabled = true;
        countField.addEventListener("input", () => {
          deleteButton.disabled = countField.value.trim() !== String(sessionCount);
        });
        setTimeout(() => countField.focus(), 0);
      } else {
        setTimeout(() => cancelButton.focus(), 0);
      }
      actions.append(deleteButton, cancelButton);
    } else {
      actions.append(cancelButton);
      setTimeout(() => cancelButton.focus(), 0);
    }
    blocks.push(actions);
    confirmScreen.replaceChildren(...blocks);
    showConfirm(true);
  }

  purgeButton.addEventListener("click", () => requestDeletion(shownIds, true));
  ageSelect.addEventListener("change", sendQuery);
  confirmScreen.addEventListener("keydown", (event) => {
    if (event.key === "Escape") cancelDeletion();
  });

  searchInput.addEventListener("input", scheduleQuery);
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter") navigate(event);
  });
  list.addEventListener("keydown", navigate);
  repoSelect.addEventListener("change", sendQuery);
  scopeButtons.forEach((button) => button.addEventListener("click", () => setScope(button.dataset.scope)));
  document.getElementById("refresh").addEventListener("click", () => vscodeApi.postMessage({ type: "refresh" }));
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement !== searchInput) {
      event.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "state") {
      isRefreshing = message.isRefreshing;
      rowsById = new Map(message.rows.map((row) => [row.sessionId, row]));
      itemsById = new Map(message.rows.map((row) => [row.sessionId, listItem(row)]));
      renderRepoOptions(message.rows);
      sendQuery();
      return;
    }
    if (message.type === "deletePreview") {
      renderDeletePreview(message);
      return;
    }
    if (message.type === "deleteDone") {
      showConfirm(false);
      return;
    }
    if (message.type === "matches" && message.requestId === latestRequestId) {
      shownIds = message.sessionIds;
      renderList();
    }
  });

  scopeButtons.forEach((button) => button.setAttribute("aria-checked", String(button.dataset.scope === scope)));
  list.replaceChildren(element("p", "empty muted", "Indexing sessions…"));
  searchInput.focus();
  vscodeApi.postMessage({ type: "ready" });
</script>
</body>
</html>`;
}
