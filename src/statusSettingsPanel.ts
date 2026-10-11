import * as crypto from "crypto";
import * as vscode from "vscode";
import { PR_STATUS_KEYS, PrStatusKey, statusGlyph, ticketStatus } from "./linkStatus";
import { StatusConfig } from "./statusConfig";
import { statusGlyphMarkup } from "./statusIcons";

interface StatusRow {
  name: string;
  color: string;
  glyph: string;
}

interface PanelState {
  projects: Array<{ key: string; isEnabled: boolean; statuses: StatusRow[] }>;
  prStatuses: StatusRow[];
}

type PanelMessage =
  | { type: "setProjectEnabled"; projectKey: string; isEnabled: boolean }
  | { type: "setJiraColor"; projectKey: string; statusName: string; color: string }
  | { type: "setPrColor"; statusKey: PrStatusKey; color: string }
  | { type: "resetJiraColors" }
  | { type: "resetPrColors" }
  | { type: "refreshProjects" };

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

// One panel per window; a second open command brings the first one forward.
export class StatusSettingsPanel {
  private static openPanel: StatusSettingsPanel | undefined;

  static show(statusConfig: StatusConfig, refreshProjects: () => Promise<void>): void {
    if (StatusSettingsPanel.openPanel !== undefined) {
      StatusSettingsPanel.openPanel.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel("overseer.statusSettings", "Link Status Colors", vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    StatusSettingsPanel.openPanel = new StatusSettingsPanel(panel, statusConfig, refreshProjects);
  }

  static notifyConfigChanged(): void {
    StatusSettingsPanel.openPanel?.postState();
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly statusConfig: StatusConfig,
    private readonly refreshProjects: () => Promise<void>,
  ) {
    panel.webview.html = panelHtml(crypto.randomBytes(16).toString("base64"), panel.webview.cspSource);
    panel.webview.onDidReceiveMessage((message: PanelMessage) => void this.receive(message));
    panel.onDidDispose(() => {
      StatusSettingsPanel.openPanel = undefined;
    });
  }

  private postState(): void {
    void this.panel.webview.postMessage({ type: "state", state: this.panelState() });
  }

  private panelState(): PanelState {
    const projects = this.statusConfig.projects().map((project) => ({
      key: project.key,
      isEnabled: project.isEnabled,
      statuses: project.statuses.map((statusName) => ({
        name: statusName,
        color: this.statusConfig.jiraColor(project.key, statusName),
        glyph: statusGlyphMarkup(statusGlyph("ticket", ticketStatus(statusName))),
      })),
    }));
    const prStatuses = PR_STATUS_KEYS.map((statusKey) => ({
      name: statusKey,
      color: this.statusConfig.prColor(statusKey),
      glyph: statusGlyphMarkup(statusGlyph("pr", { text: statusKey, colorKey: statusKey })),
    }));
    return { projects, prStatuses };
  }

  private async receive(message: PanelMessage | { type: "ready" }): Promise<void> {
    switch (message.type) {
      case "ready":
        this.postState();
        return;
      case "setProjectEnabled":
        await this.statusConfig.setProjectEnabled(message.projectKey, message.isEnabled);
        return;
      case "setJiraColor":
        if (HEX_COLOR_PATTERN.test(message.color)) {
          await this.statusConfig.setJiraColor(message.projectKey, message.statusName, message.color);
        }
        return;
      case "setPrColor":
        if (HEX_COLOR_PATTERN.test(message.color) && PR_STATUS_KEYS.includes(message.statusKey)) {
          await this.statusConfig.setPrColor(message.statusKey, message.color);
        }
        return;
      case "resetJiraColors":
        await this.statusConfig.resetJiraColors();
        return;
      case "resetPrColors":
        await this.statusConfig.resetPrColors();
        return;
      case "refreshProjects":
        await this.refreshProjects();
        this.postState();
        return;
    }
  }
}

function panelHtml(nonce: string, cspSource: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Link Status Colors</title>
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  body {
    margin: 0;
    padding: 24px;
    max-width: 960px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
  }
  h1 { margin: 0 0 4px; font-size: 1.4em; font-weight: 600; }
  h2 { margin: 0; font-size: 1.1em; font-weight: 600; }
  .lede, .muted { color: var(--vscode-descriptionForeground); }
  .lede { margin: 0 0 24px; }
  section { border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); padding: 16px 0 24px; }
  .section-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
  .section-head h2 { flex: 1; }
  button {
    font: inherit;
    padding: 4px 12px;
    border: 1px solid var(--vscode-button-border, transparent);
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground);
    cursor: pointer;
  }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button:disabled { opacity: 0.5; cursor: default; }
  :focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .project + .project { margin-top: 16px; }
  .project-head { display: flex; align-items: center; gap: 8px; height: 28px; cursor: pointer; }
  .project-head input { margin: 0; accent-color: var(--vscode-focusBorder); }
  .project-key { font-family: var(--vscode-editor-font-family); font-weight: 600; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 0 16px;
    margin: 4px 0 0 24px;
  }
  .grid.off { opacity: 0.45; }
  .row { display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 4px; cursor: pointer; }
  .row:hover { background: var(--vscode-list-hoverBackground); }
  .row svg { width: 16px; height: 16px; flex: none; }
  .row .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hex { font-family: var(--vscode-editor-font-family); font-size: 0.9em; }
  .warn { color: var(--vscode-editorWarning-foreground); font-size: 0.9em; }
  input[type="color"] {
    flex: none;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    background: none;
    cursor: pointer;
  }
  input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
  input[type="color"]::-webkit-color-swatch { border: none; }
  .empty { margin: 0; }
</style>
</head>
<body>
<h1>Link status colors</h1>
<p class="lede">Colors tint the ticket and PR icons in the Overseer sidebar. Changes save as you make them.</p>
<section>
  <div class="section-head">
    <h2>Jira projects</h2>
    <button id="refresh-projects">Refresh statuses</button>
    <button id="reset-jira">Reset colors</button>
  </div>
  <div id="projects"></div>
</section>
<section>
  <div class="section-head">
    <h2>Pull requests</h2>
    <button id="reset-pr">Reset colors</button>
  </div>
  <div id="pr-statuses" class="grid"></div>
</section>
<script nonce="${nonce}">
  const vscodeApi = acquireVsCodeApi();
  const SVG_NS = "http://www.w3.org/2000/svg";
  const MIN_ICON_CONTRAST = 3;

  function luminance(hexColor) {
    const channels = [1, 3, 5].map((offset) => parseInt(hexColor.slice(offset, offset + 2), 16) / 255);
    const linear = channels.map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  }

  function backgroundHex() {
    const rgb = getComputedStyle(document.body).backgroundColor.match(/\\d+/g) || ["0", "0", "0"];
    return "#" + rgb.slice(0, 3).map((channel) => Number(channel).toString(16).padStart(2, "0")).join("");
  }

  function contrastRatio(firstHex, secondHex) {
    const [lighter, darker] = [luminance(firstHex), luminance(secondHex)].sort((a, b) => b - a);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function glyphIcon(glyphMarkup, color) {
    const icon = document.createElementNS(SVG_NS, "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("fill", "none");
    icon.setAttribute("stroke", color);
    icon.setAttribute("stroke-width", "2");
    icon.setAttribute("stroke-linecap", "round");
    icon.setAttribute("stroke-linejoin", "round");
    icon.innerHTML = glyphMarkup;
    return icon;
  }

  function textSpan(className, text) {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = text;
    return span;
  }

  // The swatch, glyph, and hex update while the picker is open; the color saves when it closes.
  function statusRow(status, saveColor) {
    const row = document.createElement("label");
    row.className = "row";
    const picker = document.createElement("input");
    picker.type = "color";
    picker.value = status.color;
    picker.setAttribute("aria-label", status.name + " color");
    const icon = glyphIcon(status.glyph, status.color);
    const hex = textSpan("hex muted", status.color.toUpperCase());
    const warning = textSpan("warn", "");
    const showColor = (color) => {
      icon.setAttribute("stroke", color);
      hex.textContent = color.toUpperCase();
      warning.textContent = contrastRatio(color, backgroundHex()) < MIN_ICON_CONTRAST ? "low contrast" : "";
    };
    showColor(status.color);
    picker.addEventListener("input", () => showColor(picker.value));
    picker.addEventListener("change", () => saveColor(picker.value));
    row.append(picker, icon, textSpan("name", status.name), warning, hex);
    return row;
  }

  function renderProjects(projects) {
    const container = document.getElementById("projects");
    container.replaceChildren();
    if (projects.length === 0) {
      container.append(textSpan("empty muted", "No projects yet. A project shows up here once Overseer loads the status of one of its tickets."));
      return;
    }
    for (const project of projects) {
      const block = document.createElement("div");
      block.className = "project";
      const head = document.createElement("label");
      head.className = "project-head";
      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.checked = project.isEnabled;
      toggle.addEventListener("change", () =>
        vscodeApi.postMessage({ type: "setProjectEnabled", projectKey: project.key, isEnabled: toggle.checked }),
      );
      const countText = project.isEnabled ? project.statuses.length + " statuses" : "off · no status lookups";
      head.append(toggle, textSpan("project-key", project.key), textSpan("muted", countText));
      const grid = document.createElement("div");
      grid.className = project.isEnabled ? "grid" : "grid off";
      for (const status of project.statuses) {
        grid.append(
          statusRow(status, (color) =>
            vscodeApi.postMessage({ type: "setJiraColor", projectKey: project.key, statusName: status.name, color }),
          ),
        );
      }
      block.append(head, grid);
      container.append(block);
    }
  }

  function renderPrStatuses(prStatuses) {
    const grid = document.getElementById("pr-statuses");
    grid.replaceChildren(
      ...prStatuses.map((status) =>
        statusRow(status, (color) => vscodeApi.postMessage({ type: "setPrColor", statusKey: status.name, color })),
      ),
    );
  }

  const refreshButton = document.getElementById("refresh-projects");
  refreshButton.addEventListener("click", () => {
    refreshButton.disabled = true;
    refreshButton.textContent = "Refreshing…";
    vscodeApi.postMessage({ type: "refreshProjects" });
  });
  document.getElementById("reset-jira").addEventListener("click", () => vscodeApi.postMessage({ type: "resetJiraColors" }));
  document.getElementById("reset-pr").addEventListener("click", () => vscodeApi.postMessage({ type: "resetPrColors" }));

  window.addEventListener("message", (event) => {
    if (event.data.type !== "state") {
      return;
    }
    refreshButton.disabled = false;
    refreshButton.textContent = "Refresh statuses";
    renderProjects(event.data.state.projects);
    renderPrStatuses(event.data.state.prStatuses);
  });
  vscodeApi.postMessage({ type: "ready" });
</script>
</body>
</html>`;
}
