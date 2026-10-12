import * as crypto from "crypto";
import * as path from "path";
import * as vscode from "vscode";
import { SessionMeta } from "./indexer";
import { projectKeyOf } from "./jira";
import { linkKey } from "./linkJudge";
import { LinkStatus } from "./linkStatus";
import { LinkStatusService } from "./linkStatusService";
import { MarkedLink } from "./linkView";
import { openInBrowser, openInVscode } from "./openUrl";
import { LinkMark, Registry } from "./registry";
import { acceptedOrder, ResourceRow, resourceRow } from "./resourceRows";
import { readLinkSettings, SessionLinkService } from "./sessionLinks";
import { StatusConfig } from "./statusConfig";

export interface ResourcesPanelDependencies {
  extensionUri: vscode.Uri;
  registry: Registry;
  linkService: SessionLinkService;
  linkStatusService: LinkStatusService;
  statusConfig: StatusConfig;
  findSessionMeta: (sessionId: string) => SessionMeta | undefined;
  sessionTitle: (sessionId: string) => string;
}

type LinkFilter = "showIrrelevant" | "showRemoved";

interface PanelState {
  title: string;
  subtitle: string;
  isFinding: boolean;
  isJiraEnabled: boolean;
  filters: Record<LinkFilter, boolean>;
  rows: ResourceRow[];
}

type PanelMessage =
  | { type: "ready" }
  | { type: "open"; key: string; target: "vscode" | "browser" }
  | { type: "copy"; key: string }
  | { type: "setMark"; key: string; mark: LinkMark | null }
  | { type: "moveStatus"; key: string }
  | { type: "reorder"; keys: string[] }
  | { type: "findAgain" }
  | { type: "setFilter"; filter: LinkFilter; value: boolean };

const LINK_FILTERS: LinkFilter[] = ["showIrrelevant", "showRemoved"];
const LINK_MARKS = new Set<string>(["pinned", "removed"]);
const MAX_TAB_TITLE_LENGTH = 40;

// One panel per session; opening a session's links again brings its panel forward.
export class ResourcesPanel {
  private static readonly openPanels = new Map<string, ResourcesPanel>();
  private readonly disposables: vscode.Disposable[] = [];
  private shownLinks: MarkedLink[] = [];

  static show(dependencies: ResourcesPanelDependencies, sessionId: string): void {
    const openPanel = ResourcesPanel.openPanels.get(sessionId);
    if (openPanel !== undefined) {
      openPanel.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "overseer.resources",
      tabTitle(dependencies.sessionTitle(sessionId)),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(dependencies.extensionUri, "media")],
      },
    );
    ResourcesPanel.openPanels.set(sessionId, new ResourcesPanel(panel, dependencies, sessionId));
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly dependencies: ResourcesPanelDependencies,
    private readonly sessionId: string,
  ) {
    const codiconStylesheet = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(dependencies.extensionUri, "media", "codicons", "codicon.css"),
    );
    panel.webview.html = panelHtml(crypto.randomBytes(16).toString("base64"), panel.webview.cspSource, codiconStylesheet.toString());
    const postState = (): void => this.postState();
    this.disposables.push(
      panel.webview.onDidReceiveMessage((message: PanelMessage) => void this.receive(message)),
      dependencies.registry.onDidChange(postState),
      dependencies.statusConfig.onDidChange(postState),
      dependencies.linkService.onDidChange(postState),
      dependencies.linkStatusService.onDidChange(postState),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("overseer.links")) {
          postState();
        }
      }),
    );
    panel.onDidDispose(() => {
      ResourcesPanel.openPanels.delete(sessionId);
      this.disposables.forEach((disposable) => disposable.dispose());
    });
  }

  private postState(): void {
    void this.panel.webview.postMessage({ type: "state", state: this.panelState() });
  }

  private panelState(): PanelState {
    const { linkService, linkStatusService, findSessionMeta, sessionTitle } = this.dependencies;
    const meta = findSessionMeta(this.sessionId);
    const linkSettings = readLinkSettings();
    this.shownLinks = meta === undefined ? [] : (linkService.linksFor(meta) ?? []);
    const rows = this.shownLinks.map((link) => {
      const status = linkStatusService.statusFor(link);
      return resourceRow(link, status, this.statusColor(link, status), linkSettings.jiraBaseUrl);
    });
    const title = sessionTitle(this.sessionId);
    this.panel.title = tabTitle(title);
    return {
      title,
      subtitle: meta === undefined ? "" : sessionSubtitle(meta),
      isFinding: linkService.isFinding(this.sessionId),
      isJiraEnabled: linkSettings.enabledKinds.has("ticket"),
      filters: { showIrrelevant: linkSettings.showIrrelevant, showRemoved: linkSettings.showRemoved },
      rows,
    };
  }

  private statusColor(link: MarkedLink, status: LinkStatus | undefined): string | undefined {
    if (status === undefined) {
      return undefined;
    }
    const { statusConfig } = this.dependencies;
    return link.kind === "pr"
      ? statusConfig.prColor(status.colorKey)
      : statusConfig.jiraColor(projectKeyOf(link.id) ?? "", status.colorKey);
  }

  private shownLink(key: string): MarkedLink | undefined {
    return this.shownLinks.find((link) => linkKey(link) === key);
  }

  private async receive(message: PanelMessage): Promise<void> {
    const { registry } = this.dependencies;
    switch (message.type) {
      case "ready":
        this.postState();
        return;
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
      case "setMark":
        if (this.shownLink(message.key) !== undefined && (message.mark === null || LINK_MARKS.has(message.mark))) {
          await registry.setLinkMark(this.sessionId, [message.key], message.mark ?? undefined);
        }
        return;
      case "moveStatus": {
        const link = this.shownLink(message.key);
        if (link?.kind === "ticket") {
          await vscode.commands.executeCommand("overseer.moveTicketStatus", link.id);
        }
        return;
      }
      case "reorder": {
        const shownKeys = this.shownLinks.map(linkKey);
        const reorderedKeys = acceptedOrder(shownKeys, message.keys);
        if (reorderedKeys !== undefined) {
          // Hidden links keep their saved place after the shown ones, so showing them again does not move them.
          const hiddenKeys = registry.linkOrder(this.sessionId).filter((key) => !reorderedKeys.includes(key));
          await registry.setLinkOrder(this.sessionId, [...reorderedKeys, ...hiddenKeys]);
        }
        return;
      }
      case "findAgain":
        await vscode.commands.executeCommand("overseer.findResources", this.sessionId);
        return;
      case "setFilter":
        if (LINK_FILTERS.includes(message.filter) && typeof message.value === "boolean") {
          await vscode.workspace
            .getConfiguration("overseer.links")
            .update(message.filter, message.value, vscode.ConfigurationTarget.Global);
        }
        return;
    }
  }

  private urlFor(key: string): string | undefined {
    const link = this.shownLink(key);
    if (link === undefined) {
      return undefined;
    }
    return resourceRow(link, undefined, undefined, readLinkSettings().jiraBaseUrl).url;
  }
}

function tabTitle(sessionTitle: string): string {
  const shortTitle =
    sessionTitle.length > MAX_TAB_TITLE_LENGTH ? `${sessionTitle.slice(0, MAX_TAB_TITLE_LENGTH - 1)}…` : sessionTitle;
  return `Links: ${shortTitle}`;
}

function sessionSubtitle(meta: SessionMeta): string {
  const repoName = path.basename(meta.resumeCwd ?? meta.startCwd);
  return [repoName, meta.gitBranch].filter((part) => part !== undefined && part !== "").join(" · ");
}

function panelHtml(nonce: string, cspSource: string, codiconStylesheet: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; font-src ${cspSource}; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Session links</title>
<link rel="stylesheet" href="${codiconStylesheet}">
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  body {
    margin: 0;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
  }
  .bar {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
    padding: 16px 24px 12px;
    background: var(--vscode-editor-background);
    border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
  }
  .titles { flex: 1; min-width: 0; }
  h1 { margin: 0; font-size: 1.3em; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub { margin: 4px 0 0; color: var(--vscode-descriptionForeground); }
  .tools { display: flex; align-items: center; gap: 16px; }
  .toggle { display: flex; align-items: center; gap: 4px; height: 24px; color: var(--vscode-descriptionForeground); cursor: pointer; }
  .toggle:hover { color: var(--vscode-foreground); }
  input[type="checkbox"] { margin: 0; accent-color: var(--vscode-focusBorder); }
  button {
    font: inherit;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 12px;
    border: 1px solid var(--vscode-button-border, transparent);
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground);
    cursor: pointer;
  }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button:disabled { opacity: 0.4; cursor: default; }
  :focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .progress { position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; overflow: hidden; }
  .progress::after {
    content: "";
    position: absolute;
    width: 30%;
    height: 100%;
    background: var(--vscode-progressBar-background);
    animation: slide 1.2s ease-in-out infinite;
  }
  @keyframes slide { from { left: -30%; } to { left: 100%; } }
  main { padding: 8px 16px 24px; }
  .list { list-style: none; margin: 0; padding: 0; outline: none; }
  .row {
    position: relative;
    display: grid;
    grid-template-columns: 16px 16px 11em minmax(0, 1fr) auto 144px;
    align-items: center;
    column-gap: 8px;
    height: 32px;
    padding: 0 8px;
    cursor: default;
    transition: background-color 80ms linear;
  }
  .row.depth-1 { padding-left: 28px; }
  .row.depth-2 { padding-left: 48px; }
  .row.depth-3 { padding-left: 68px; }
  .row:hover { background: var(--vscode-list-hoverBackground); }
  .list:focus-within .row.selected {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }
  .row.selected { background: var(--vscode-list-inactiveSelectionBackground); }
  .row.dim > :not(.actions) { opacity: 0.5; }
  .row.dragging { opacity: 0.4; }
  .row.drop-before::before, .row.drop-after::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--vscode-focusBorder);
  }
  .row.drop-before::before { top: -1px; }
  .row.drop-after::after { bottom: -1px; }
  .grip { color: var(--vscode-descriptionForeground); visibility: hidden; cursor: grab; }
  .row:hover .grip, .row.selected .grip { visibility: visible; }
  .glyph { width: 16px; height: 16px; }
  .glyph:not([data-status]) { stroke: var(--vscode-descriptionForeground); }
  .glyph.kind-artifact:not([data-status]) { stroke: var(--vscode-terminal-ansiCyan); }
  .id {
    font-family: var(--vscode-editor-font-family);
    font-size: 0.92em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .label.missing { color: var(--vscode-descriptionForeground); font-style: italic; }
  .meta { display: flex; align-items: center; gap: 8px; color: var(--vscode-descriptionForeground); white-space: nowrap; }
  .row.selected .meta { color: inherit; }
  .meta .codicon { font-size: 14px; }
  .actions { display: flex; justify-content: flex-end; visibility: hidden; }
  .row:hover .actions, .row.selected .actions, .row:focus-within .actions { visibility: visible; }
  .icon-button {
    width: 24px;
    height: 24px;
    padding: 0;
    justify-content: center;
    border: none;
    color: inherit;
    background: none;
  }
  .icon-button:hover { background: var(--vscode-toolbar-hoverBackground); }
  .empty { margin: 24px 8px; color: var(--vscode-descriptionForeground); }
  @media (max-width: 599px) {
    .row { grid-template-columns: 16px 16px 8em minmax(0, 1fr) 144px; }
    .meta { display: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .progress::after { animation: none; width: 100%; left: 0; }
    .row { transition: none; }
  }
</style>
</head>
<body>
<header class="bar">
  <div class="titles">
    <h1 id="title"></h1>
    <p class="sub" id="subtitle"></p>
  </div>
  <div class="tools">
    <label class="toggle" title="Links the judge saw only in passing"><input type="checkbox" id="filter-showIrrelevant"> Passing</label>
    <label class="toggle" title="Links you removed"><input type="checkbox" id="filter-showRemoved"> Removed</label>
    <button id="find-again"><span class="codicon codicon-refresh" id="find-icon"></span> Find again</button>
  </div>
  <div class="progress" id="progress" hidden></div>
</header>
<main>
  <ul class="list" id="list" role="listbox" aria-label="Links" tabindex="0"></ul>
  <p class="empty" id="empty" hidden></p>
</main>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const listElement = document.getElementById("list");
  const emptyElement = document.getElementById("empty");
  let panelState;
  let selectedKey = vscode.getState()?.selectedKey;
  let draggedKey;

  const ROLE_TAGS = { owned: "", touched: "touched", irrelevant: "passing" };

  function iconButton(iconName, label, onPress, isDisabled) {
    const button = document.createElement("button");
    button.className = "icon-button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.disabled = Boolean(isDisabled);
    const icon = document.createElement("span");
    icon.className = "codicon codicon-" + iconName;
    button.append(icon);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onPress();
    });
    return button;
  }

  function glyphElement(row) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "glyph kind-" + row.kind);
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

  function textSpan(className, text) {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = text;
    return span;
  }

  function actionsFor(row) {
    const actions = document.createElement("span");
    actions.className = "actions";
    const send = (message) => () => vscode.postMessage({ ...message, key: row.key });
    const noUrl = row.url === undefined;
    const openHint = noUrl ? "Set overseer.links.jira.baseUrl to open tickets" : undefined;
    actions.append(
      iconButton("browser", openHint ?? "Open in VS Code", send({ type: "open", target: "vscode" }), noUrl),
      iconButton("link-external", openHint ?? "Open in Browser", send({ type: "open", target: "browser" }), noUrl),
      iconButton("copy", "Copy Link", send({ type: "copy" })),
    );
    if (row.kind === "ticket" && panelState.isJiraEnabled) {
      actions.append(iconButton("arrow-swap", "Move to Status…", send({ type: "moveStatus" })));
    }
    if (row.mark === "pinned") {
      actions.append(iconButton("pinned", "Unpin", send({ type: "setMark", mark: null })));
    } else {
      actions.append(iconButton("pin", "Pin to Top", send({ type: "setMark", mark: "pinned" })));
    }
    if (row.mark === "removed") {
      actions.append(iconButton("discard", "Restore", send({ type: "setMark", mark: null })));
    } else {
      actions.append(iconButton("close", "Remove", send({ type: "setMark", mark: "removed" })));
    }
    return actions;
  }

  function metaFor(row) {
    const meta = document.createElement("span");
    meta.className = "meta";
    if (row.mark === "pinned") {
      const pinIcon = document.createElement("span");
      pinIcon.className = "codicon codicon-pinned";
      pinIcon.title = "Pinned";
      meta.append(pinIcon);
    }
    const parts = [row.statusText, ROLE_TAGS[row.role], row.mark === "removed" ? "removed" : ""].filter(Boolean);
    if (parts.length > 0) {
      meta.append(document.createTextNode(parts.join(" · ")));
    }
    return meta;
  }

  function rowElement(row) {
    const item = document.createElement("li");
    item.className = "row depth-" + Math.min(row.depth, 3);
    item.classList.toggle("dim", row.isDimmed);
    item.classList.toggle("selected", row.key === selectedKey);
    item.dataset.key = row.key;
    item.draggable = true;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", String(row.key === selectedKey));
    const grip = document.createElement("span");
    grip.className = "grip codicon codicon-gripper";
    const idText = textSpan("id", row.displayId);
    idText.title = row.displayId;
    const labelText = textSpan(row.label ? "label" : "label missing", row.label || "No title yet");
    labelText.title = row.label || "";
    item.append(grip, glyphElement(row), idText, labelText, metaFor(row), actionsFor(row));
    item.addEventListener("click", () => select(row.key));
    item.addEventListener("dragstart", (event) => {
      draggedKey = row.key;
      event.dataTransfer.effectAllowed = "move";
      item.classList.add("dragging");
    });
    item.addEventListener("dragend", () => {
      draggedKey = undefined;
      item.classList.remove("dragging");
      clearDropMarks();
    });
    item.addEventListener("dragover", (event) => {
      if (draggedKey === undefined || draggedKey === row.key) {
        return;
      }
      event.preventDefault();
      const rowBounds = item.getBoundingClientRect();
      const isAfter = event.clientY > rowBounds.top + rowBounds.height / 2;
      clearDropMarks();
      item.classList.add(isAfter ? "drop-after" : "drop-before");
    });
    item.addEventListener("drop", (event) => {
      event.preventDefault();
      const isAfter = item.classList.contains("drop-after");
      clearDropMarks();
      moveRow(draggedKey, row.key, isAfter);
    });
    return item;
  }

  function clearDropMarks() {
    listElement.querySelectorAll(".drop-before, .drop-after").forEach((element) => {
      element.classList.remove("drop-before", "drop-after");
    });
  }

  function moveRow(movedKey, targetKey, isAfter) {
    if (movedKey === undefined || movedKey === targetKey) {
      return;
    }
    const keys = panelState.rows.map((row) => row.key).filter((key) => key !== movedKey);
    const targetIndex = keys.indexOf(targetKey) + (isAfter ? 1 : 0);
    keys.splice(targetIndex, 0, movedKey);
    const rowsByKey = new Map(panelState.rows.map((row) => [row.key, row]));
    panelState.rows = keys.map((key) => rowsByKey.get(key));
    render();
    vscode.postMessage({ type: "reorder", keys });
  }

  function select(key) {
    selectedKey = key;
    vscode.setState({ selectedKey });
    listElement.querySelectorAll(".row").forEach((element) => {
      const isSelected = element.dataset.key === key;
      element.classList.toggle("selected", isSelected);
      element.setAttribute("aria-selected", String(isSelected));
    });
    listElement.querySelector(".row.selected")?.scrollIntoView({ block: "nearest" });
  }

  function render() {
    document.getElementById("title").textContent = panelState.title;
    const countText = panelState.rows.length === 1 ? "1 link" : panelState.rows.length + " links";
    document.getElementById("subtitle").textContent = [panelState.subtitle, countText].filter(Boolean).join(" · ");
    document.getElementById("progress").hidden = !panelState.isFinding;
    document.getElementById("find-again").disabled = panelState.isFinding;
    document.getElementById("find-icon").className =
      "codicon " + (panelState.isFinding ? "codicon-loading codicon-modifier-spin" : "codicon-refresh");
    for (const filter of ["showIrrelevant", "showRemoved"]) {
      document.getElementById("filter-" + filter).checked = panelState.filters[filter];
    }
    listElement.replaceChildren(...panelState.rows.map(rowElement));
    emptyElement.hidden = panelState.rows.length > 0;
    emptyElement.textContent = panelState.isFinding
      ? "Finding resources…"
      : "No links found. Find again picks up links added since the last run.";
  }

  listElement.addEventListener("keydown", (event) => {
    const keys = panelState.rows.map((row) => row.key);
    if (keys.length === 0) {
      return;
    }
    const currentIndex = keys.indexOf(selectedKey);
    const nextIndexByKey = {
      ArrowDown: Math.min(currentIndex + 1, keys.length - 1),
      ArrowUp: Math.max(currentIndex - 1, 0),
      Home: 0,
      End: keys.length - 1,
    };
    const nextIndex = nextIndexByKey[event.key];
    if (nextIndex !== undefined && event.target === listElement) {
      event.preventDefault();
      select(keys[nextIndex]);
    }
  });

  document.getElementById("find-again").addEventListener("click", () => vscode.postMessage({ type: "findAgain" }));
  for (const filter of ["showIrrelevant", "showRemoved"]) {
    document.getElementById("filter-" + filter).addEventListener("change", (event) => {
      vscode.postMessage({ type: "setFilter", filter, value: event.target.checked });
    });
  }

  window.addEventListener("message", (event) => {
    if (event.data.type === "state") {
      panelState = event.data.state;
      render();
    }
  });
  vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
}
