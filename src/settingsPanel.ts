import * as crypto from "crypto";
import * as vscode from "vscode";
import { PR_STATUS_KEYS, PrStatusKey, statusGlyph, ticketStatus } from "./linkStatus";
import {
  customSessionColor,
  isCodiconName,
  SESSION_ICON_SPECS,
  SessionIconState,
  sessionIconName,
  sessionIconSpec,
  withSessionColor,
} from "./sessionIcons";
import { StatusConfig } from "./statusConfig";
import { statusGlyphMarkup } from "./statusIcons";

export type SettingsSection = "sessions" | "jira" | "github" | "general";

export interface SettingsPanelDependencies {
  extensionUri: vscode.Uri;
  statusConfig: StatusConfig;
  refreshProjects: () => Promise<void>;
}

interface StatusRow {
  name: string;
  color: string;
  glyph: string;
}

interface SessionIconRow {
  state: SessionIconState;
  label: string;
  icon: string;
  defaultIcon: string;
  customColor: string | undefined;
  colorVariable: string;
}

interface LinkSettings {
  "jira.enabled": boolean;
  "github.enabled": boolean;
  "artifacts.enabled": boolean;
  liveStatus: boolean;
}

interface PanelState {
  sessionIcons: SessionIconRow[];
  linkSettings: LinkSettings;
  projects: Array<{ key: string; isEnabled: boolean; statuses: StatusRow[] }>;
  prStatuses: StatusRow[];
}

type PanelMessage =
  | { type: "ready" }
  | { type: "setLinkSetting"; settingKey: keyof LinkSettings; value: boolean }
  | { type: "setSessionIcon"; state: SessionIconState; iconName: string }
  | { type: "setSessionColor"; state: SessionIconState; color: string | undefined }
  | { type: "setProjectEnabled"; projectKey: string; isEnabled: boolean }
  | { type: "setJiraColor"; projectKey: string; statusName: string; color: string }
  | { type: "setPrColor"; statusKey: PrStatusKey; color: string }
  | { type: "resetJiraColors" }
  | { type: "resetPrColors" }
  | { type: "refreshProjects" }
  | { type: "openAllSettings" }
  | { type: "openIconReference" };

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const LINK_SETTING_KEYS: Array<keyof LinkSettings> = ["jira.enabled", "github.enabled", "artifacts.enabled", "liveStatus"];
const CODICON_REFERENCE_URL = "https://microsoft.github.io/vscode-codicons/dist/codicon.html";
const EXTENSION_SETTINGS_QUERY = "@ext:djaunt.djaunt-overseer";

// One panel per window; a second open command brings the first one forward at the asked section.
export class SettingsPanel {
  private static openPanel: SettingsPanel | undefined;
  private pendingSection: SettingsSection | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  static show(dependencies: SettingsPanelDependencies, section?: SettingsSection): void {
    if (SettingsPanel.openPanel !== undefined) {
      SettingsPanel.openPanel.panel.reveal();
      SettingsPanel.openPanel.revealSection(section);
      return;
    }
    const mediaRoot = vscode.Uri.joinPath(dependencies.extensionUri, "media");
    const panel = vscode.window.createWebviewPanel("overseer.settings", "Overseer Settings", vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [mediaRoot],
    });
    SettingsPanel.openPanel = new SettingsPanel(panel, dependencies, section);
  }

  static notifyConfigChanged(): void {
    SettingsPanel.openPanel?.postState();
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly dependencies: SettingsPanelDependencies,
    initialSection: SettingsSection | undefined,
  ) {
    this.pendingSection = initialSection;
    const codiconStylesheet = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(dependencies.extensionUri, "media", "codicons", "codicon.css"),
    );
    panel.webview.html = panelHtml(crypto.randomBytes(16).toString("base64"), panel.webview.cspSource, codiconStylesheet.toString());
    this.disposables.push(
      panel.webview.onDidReceiveMessage((message: PanelMessage) => void this.receive(message)),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("overseer") || event.affectsConfiguration("workbench.colorCustomizations")) {
          this.postState();
        }
      }),
    );
    panel.onDidDispose(() => {
      SettingsPanel.openPanel = undefined;
      this.disposables.forEach((disposable) => disposable.dispose());
    });
  }

  private revealSection(section: SettingsSection | undefined): void {
    if (section !== undefined) {
      void this.panel.webview.postMessage({ type: "reveal", section });
    }
  }

  private postState(): void {
    void this.panel.webview.postMessage({ type: "state", state: this.panelState() });
  }

  private panelState(): PanelState {
    const { statusConfig } = this.dependencies;
    const iconConfig = vscode.workspace.getConfiguration("overseer.sessionIcons");
    const colorCustomizations = readColorCustomizations();
    const sessionIcons = SESSION_ICON_SPECS.map((spec) => ({
      state: spec.state,
      label: spec.label,
      icon: sessionIconName(spec.state, iconConfig.get<string>(spec.state)),
      defaultIcon: spec.defaultIcon,
      customColor: customSessionColor(colorCustomizations, spec.colorId),
      colorVariable: `--vscode-${spec.colorId.replace(/\./g, "-")}`,
    }));
    const linksConfig = vscode.workspace.getConfiguration("overseer.links");
    const linkSettings: LinkSettings = {
      "jira.enabled": linksConfig.get<boolean>("jira.enabled", true),
      "github.enabled": linksConfig.get<boolean>("github.enabled", true),
      "artifacts.enabled": linksConfig.get<boolean>("artifacts.enabled", true),
      liveStatus: linksConfig.get<boolean>("liveStatus", true),
    };
    const projects = statusConfig.projects().map((project) => ({
      key: project.key,
      isEnabled: project.isEnabled,
      statuses: project.statuses.map((statusName) => ({
        name: statusName,
        color: statusConfig.jiraColor(project.key, statusName),
        glyph: statusGlyphMarkup(statusGlyph("ticket", ticketStatus(statusName))),
      })),
    }));
    const prStatuses = PR_STATUS_KEYS.map((statusKey) => ({
      name: statusKey,
      color: statusConfig.prColor(statusKey),
      glyph: statusGlyphMarkup(statusGlyph("pr", { text: statusKey, colorKey: statusKey })),
    }));
    return { sessionIcons, linkSettings, projects, prStatuses };
  }

  private async receive(message: PanelMessage): Promise<void> {
    const { statusConfig } = this.dependencies;
    switch (message.type) {
      case "ready":
        this.postState();
        this.revealSection(this.pendingSection);
        this.pendingSection = undefined;
        return;
      case "setLinkSetting":
        await updateLinkSetting(message.settingKey, message.value);
        return;
      case "setSessionIcon":
        await updateSessionIcon(message.state, message.iconName);
        return;
      case "setSessionColor":
        await updateSessionColor(message.state, message.color);
        return;
      case "setProjectEnabled":
        await statusConfig.setProjectEnabled(message.projectKey, message.isEnabled);
        return;
      case "setJiraColor":
        if (HEX_COLOR_PATTERN.test(message.color)) {
          await statusConfig.setJiraColor(message.projectKey, message.statusName, message.color);
        }
        return;
      case "setPrColor":
        if (HEX_COLOR_PATTERN.test(message.color) && PR_STATUS_KEYS.includes(message.statusKey)) {
          await statusConfig.setPrColor(message.statusKey, message.color);
        }
        return;
      case "resetJiraColors":
        await statusConfig.resetJiraColors();
        return;
      case "resetPrColors":
        await statusConfig.resetPrColors();
        return;
      case "refreshProjects":
        await this.dependencies.refreshProjects();
        this.postState();
        return;
      case "openAllSettings":
        await vscode.commands.executeCommand("workbench.action.openSettings", EXTENSION_SETTINGS_QUERY);
        return;
      case "openIconReference":
        await vscode.env.openExternal(vscode.Uri.parse(CODICON_REFERENCE_URL));
        return;
    }
  }
}

function readColorCustomizations(): Record<string, unknown> | undefined {
  return vscode.workspace.getConfiguration("workbench").get<Record<string, unknown>>("colorCustomizations");
}

async function updateLinkSetting(settingKey: keyof LinkSettings, value: boolean): Promise<void> {
  if (LINK_SETTING_KEYS.includes(settingKey) && typeof value === "boolean") {
    await vscode.workspace.getConfiguration("overseer.links").update(settingKey, value, vscode.ConfigurationTarget.Global);
  }
}

// The default icon clears the setting, so a later change to the default still reaches this user.
async function updateSessionIcon(state: SessionIconState, iconName: string): Promise<void> {
  const trimmedName = iconName.trim();
  const isDefaultIcon = trimmedName === "" || trimmedName === sessionIconSpec(state).defaultIcon;
  if (!isDefaultIcon && !isCodiconName(trimmedName)) {
    return;
  }
  await vscode.workspace
    .getConfiguration("overseer.sessionIcons")
    .update(state, isDefaultIcon ? undefined : trimmedName, vscode.ConfigurationTarget.Global);
}

async function updateSessionColor(state: SessionIconState, color: string | undefined): Promise<void> {
  if (color !== undefined && !HEX_COLOR_PATTERN.test(color)) {
    return;
  }
  const updatedCustomizations = withSessionColor(readColorCustomizations(), sessionIconSpec(state).colorId, color);
  await vscode.workspace
    .getConfiguration("workbench")
    .update("colorCustomizations", updatedCustomizations, vscode.ConfigurationTarget.Global);
}

const SUGGESTED_ICONS = [
  "loading~spin",
  "sync~spin",
  "gear~spin",
  "terminal",
  "window",
  "debug-pause",
  "debug-start",
  "play",
  "play-circle",
  "circle-filled",
  "circle-outline",
  "record",
  "pass-filled",
  "pass",
  "eye",
  "zap",
  "flame",
  "rocket",
  "warning",
  "error",
];

function panelHtml(nonce: string, cspSource: string, codiconStylesheet: string): string {
  const iconOptions = SUGGESTED_ICONS.map((iconName) => `<option value="${iconName}"></option>`).join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; font-src ${cspSource}; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Overseer Settings</title>
<link rel="stylesheet" href="${codiconStylesheet}">
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  html { scroll-behavior: smooth; }
  @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
  body {
    margin: 0;
    padding: 24px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
  }
  .layout { display: grid; grid-template-columns: 160px minmax(0, 880px); gap: 32px; }
  .toc { position: sticky; top: 24px; align-self: start; display: flex; flex-direction: column; }
  .toc a {
    display: block;
    height: 28px;
    line-height: 28px;
    padding: 0 12px;
    border-left: 2px solid transparent;
    color: var(--vscode-descriptionForeground);
    text-decoration: none;
  }
  .toc a:hover { color: var(--vscode-foreground); background: var(--vscode-list-hoverBackground); }
  .toc a.active { border-left-color: var(--vscode-focusBorder); color: var(--vscode-foreground); font-weight: 600; }
  @media (max-width: 719px) {
    .layout { display: block; }
    .toc { position: static; flex-direction: row; flex-wrap: wrap; margin-bottom: 16px; }
    .toc a { border-left: none; border-bottom: 2px solid transparent; }
    .toc a.active { border-bottom-color: var(--vscode-focusBorder); }
  }
  h1 { margin: 0 0 4px; font-size: 1.4em; font-weight: 600; }
  h2 { margin: 0; font-size: 1.1em; font-weight: 600; }
  .lede, .muted { color: var(--vscode-descriptionForeground); }
  .lede { margin: 0 0 24px; }
  .note { margin: 0 0 12px; }
  section { border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); padding: 16px 0 24px; scroll-margin-top: 24px; }
  .section-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
  .section-head h2 { flex: 1; }
  .section-body.off { opacity: 0.45; }
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
  button.link { padding: 0; border: none; background: none; color: var(--vscode-textLink-foreground); }
  button.link:hover { background: none; color: var(--vscode-textLink-activeForeground); text-decoration: underline; }
  :focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  input[type="checkbox"] { margin: 0; accent-color: var(--vscode-focusBorder); }
  .switch { display: flex; align-items: center; gap: 8px; height: 28px; cursor: pointer; }
  input[type="text"], select {
    font: inherit;
    height: 24px;
    box-sizing: border-box;
    padding: 0 6px;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, transparent));
  }
  select { color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); border-color: var(--vscode-dropdown-border); }
  input[type="text"] { font-family: var(--vscode-editor-font-family); width: 100%; }
  input[type="text"].invalid { border-color: var(--vscode-inputValidation-warningBorder); }
  .session-grid { display: grid; grid-template-columns: 20px minmax(0, 1fr) 180px 20px 72px 88px; column-gap: 12px; align-items: center; }
  .session-grid > * { min-height: 32px; display: flex; align-items: center; }
  .session-grid .codicon { font-size: 16px; justify-content: center; }
  .session-grid .heading { min-height: 24px; color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  .tag { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  .project + .project { margin-top: 16px; }
  .project-head { display: flex; align-items: center; gap: 8px; height: 28px; cursor: pointer; }
  .project-key { font-family: var(--vscode-editor-font-family); font-weight: 600; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 0 16px; }
  .project .grid { margin: 4px 0 0 24px; }
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
  .general-row { display: flex; align-items: center; gap: 12px; min-height: 32px; }
  .general-row .muted { margin-left: auto; }
  .empty { margin: 0; }
</style>
</head>
<body>
<div class="layout">
  <nav class="toc" aria-label="Sections">
    <a href="#sessions" data-section="sessions">Sessions</a>
    <a href="#jira" data-section="jira">Jira</a>
    <a href="#github" data-section="github">GitHub</a>
    <a href="#general" data-section="general">General</a>
  </nav>
  <main>
    <h1>Overseer settings</h1>
    <p class="lede">Changes save as you make them.</p>

    <section id="sessions">
      <div class="section-head">
        <h2>Session icons</h2>
        <button class="link" id="browse-icons">Browse icons</button>
      </div>
      <p class="note muted">Any Codicon name works. <code>~spin</code> animates <code>loading</code>, <code>sync</code>, and <code>gear</code>. Colors save to <code>workbench.colorCustomizations</code>.</p>
      <div id="session-rows" class="session-grid"></div>
      <datalist id="icon-suggestions">${iconOptions}</datalist>
    </section>

    <section id="jira">
      <div class="section-head">
        <h2>Jira</h2>
        <button id="refresh-projects">Refresh statuses</button>
        <button id="reset-jira">Reset colors</button>
      </div>
      <label class="switch"><input type="checkbox" id="jira-enabled"> Ticket links and status</label>
      <div class="section-body" id="jira-body">
        <p class="note muted">Status comes from the Jira MCP server set in <code>overseer.jira.mcpServer</code>. Turn a project off to skip its status lookups.</p>
        <div id="projects"></div>
      </div>
    </section>

    <section id="github">
      <div class="section-head">
        <h2>GitHub</h2>
        <button id="reset-pr">Reset colors</button>
      </div>
      <label class="switch"><input type="checkbox" id="github-enabled"> Pull request links and status</label>
      <div class="section-body" id="github-body">
        <p class="note muted">Status comes from <code>gh</code>.</p>
        <div id="pr-statuses" class="grid"></div>
      </div>
    </section>

    <section id="general">
      <div class="section-head"><h2>General</h2></div>
      <label class="switch"><input type="checkbox" id="live-status"> Fetch live ticket and PR status</label>
      <label class="switch"><input type="checkbox" id="artifacts-enabled"> Artifact links</label>
      <div class="general-row"><button id="all-settings">All settings…</button><span class="muted">Every <code>overseer.*</code> setting in the Settings editor.</span></div>
    </section>
  </main>
</div>
<script nonce="${nonce}">
  const vscodeApi = acquireVsCodeApi();
  const SVG_NS = "http://www.w3.org/2000/svg";
  const MIN_ICON_CONTRAST = 3;
  const CODICON_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*(~spin)?$/;

  function rgbToHex(cssColor) {
    const rgb = cssColor.match(/\\d+/g) || ["0", "0", "0"];
    return "#" + rgb.slice(0, 3).map((channel) => Number(channel).toString(16).padStart(2, "0")).join("");
  }

  function luminance(hexColor) {
    const channels = [1, 3, 5].map((offset) => parseInt(hexColor.slice(offset, offset + 2), 16) / 255);
    const linear = channels.map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  }

  function backgroundHex() {
    return rgbToHex(getComputedStyle(document.body).backgroundColor);
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

  function lowContrastText(color) {
    return contrastRatio(color, backgroundHex()) < MIN_ICON_CONTRAST ? "low contrast" : "";
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
      warning.textContent = lowContrastText(color);
    };
    showColor(status.color);
    picker.addEventListener("input", () => showColor(picker.value));
    picker.addEventListener("change", () => saveColor(picker.value));
    row.append(picker, icon, textSpan("name", status.name), warning, hex);
    return row;
  }

  function setCodiconClass(element, iconName) {
    const [glyphName, modifier] = iconName.split("~");
    element.className = "codicon codicon-" + glyphName + (modifier === "spin" ? " codicon-modifier-spin" : "");
  }

  // A name the font lacks has no ::before content, which is how an unknown icon is caught before it saves.
  function isKnownCodicon(iconName) {
    if (!CODICON_NAME_PATTERN.test(iconName)) {
      return false;
    }
    const probe = document.createElement("i");
    setCodiconClass(probe, iconName);
    document.body.append(probe);
    const glyphContent = getComputedStyle(probe, "::before").content;
    probe.remove();
    return glyphContent !== "none" && glyphContent !== "normal" && glyphContent !== "";
  }

  function resolvedThemeHex(colorVariable) {
    const probe = document.createElement("span");
    probe.style.color = "var(" + colorVariable + ")";
    document.body.append(probe);
    const resolvedColor = getComputedStyle(probe).color;
    probe.remove();
    return rgbToHex(resolvedColor);
  }

  function sessionRow(sessionIcon) {
    const preview = document.createElement("i");
    setCodiconClass(preview, sessionIcon.icon);
    preview.style.color = sessionIcon.customColor || "var(" + sessionIcon.colorVariable + ")";
    preview.setAttribute("aria-hidden", "true");

    const iconField = document.createElement("input");
    iconField.type = "text";
    iconField.value = sessionIcon.icon;
    iconField.placeholder = sessionIcon.defaultIcon;
    iconField.setAttribute("list", "icon-suggestions");
    iconField.setAttribute("aria-label", sessionIcon.label + " icon");
    iconField.spellcheck = false;
    const iconCell = document.createElement("span");
    iconCell.append(iconField);

    const shownColor = sessionIcon.customColor || resolvedThemeHex(sessionIcon.colorVariable);
    const picker = document.createElement("input");
    picker.type = "color";
    picker.value = shownColor;
    picker.setAttribute("aria-label", sessionIcon.label + " color");
    const pickerCell = document.createElement("span");
    pickerCell.append(picker);
    const hex = textSpan("hex muted", shownColor.toUpperCase());

    const resetCell = document.createElement("span");
    if (sessionIcon.customColor) {
      const resetButton = document.createElement("button");
      resetButton.className = "link";
      resetButton.textContent = "Theme color";
      resetButton.addEventListener("click", () =>
        vscodeApi.postMessage({ type: "setSessionColor", state: sessionIcon.state, color: undefined }),
      );
      resetCell.append(resetButton);
    } else {
      resetCell.append(textSpan("tag", "theme"));
    }

    const label = textSpan("name", sessionIcon.label);
    const warning = textSpan("warn", "");
    const showIcon = () => {
      const iconName = iconField.value.trim() || sessionIcon.defaultIcon;
      const isKnown = isKnownCodicon(iconName);
      iconField.classList.toggle("invalid", !isKnown);
      label.textContent = isKnown ? sessionIcon.label : sessionIcon.label + " · unknown icon";
      if (isKnown) {
        setCodiconClass(preview, iconName);
      }
      return isKnown;
    };
    iconField.addEventListener("input", showIcon);
    iconField.addEventListener("change", () => {
      if (showIcon()) {
        vscodeApi.postMessage({ type: "setSessionIcon", state: sessionIcon.state, iconName: iconField.value });
      }
    });
    picker.addEventListener("input", () => {
      preview.style.color = picker.value;
      hex.textContent = picker.value.toUpperCase();
      warning.textContent = lowContrastText(picker.value);
    });
    picker.addEventListener("change", () =>
      vscodeApi.postMessage({ type: "setSessionColor", state: sessionIcon.state, color: picker.value }),
    );
    const labelCell = document.createElement("span");
    labelCell.append(label, warning);
    return [preview, labelCell, iconCell, pickerCell, hex, resetCell];
  }

  function renderSessionIcons(sessionIcons) {
    const grid = document.getElementById("session-rows");
    const headings = ["", "State", "Icon", "", "Color", ""].map((text) => textSpan("heading", text));
    grid.replaceChildren(...headings, ...sessionIcons.flatMap(sessionRow));
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

  // An integration that is off keeps its section visible but dimmed and out of the tab order.
  function setSectionEnabled(bodyId, isEnabled) {
    const body = document.getElementById(bodyId);
    body.classList.toggle("off", !isEnabled);
    body.inert = !isEnabled;
  }

  function renderLinkSettings(linkSettings) {
    document.getElementById("jira-enabled").checked = linkSettings["jira.enabled"];
    document.getElementById("github-enabled").checked = linkSettings["github.enabled"];
    document.getElementById("artifacts-enabled").checked = linkSettings["artifacts.enabled"];
    document.getElementById("live-status").checked = linkSettings.liveStatus;
    setSectionEnabled("jira-body", linkSettings["jira.enabled"]);
    setSectionEnabled("github-body", linkSettings["github.enabled"]);
  }

  const LINK_SETTING_CHECKBOXES = {
    "jira-enabled": "jira.enabled",
    "github-enabled": "github.enabled",
    "artifacts-enabled": "artifacts.enabled",
    "live-status": "liveStatus",
  };
  for (const [checkboxId, settingKey] of Object.entries(LINK_SETTING_CHECKBOXES)) {
    const checkbox = document.getElementById(checkboxId);
    checkbox.addEventListener("change", () =>
      vscodeApi.postMessage({ type: "setLinkSetting", settingKey, value: checkbox.checked }),
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
  document.getElementById("all-settings").addEventListener("click", () => vscodeApi.postMessage({ type: "openAllSettings" }));
  document.getElementById("browse-icons").addEventListener("click", () => vscodeApi.postMessage({ type: "openIconReference" }));

  const sections = [...document.querySelectorAll("section")];
  const tocLinks = [...document.querySelectorAll(".toc a")];
  function markActiveSection() {
    const scrolledSections = sections.filter((section) => section.getBoundingClientRect().top <= 64);
    const isAtBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 4;
    const activeSection = isAtBottom ? sections[sections.length - 1] : scrolledSections.pop() || sections[0];
    tocLinks.forEach((link) => link.classList.toggle("active", link.dataset.section === activeSection.id));
  }
  window.addEventListener("scroll", markActiveSection, { passive: true });

  function revealSection(sectionId) {
    document.getElementById(sectionId)?.scrollIntoView();
    tocLinks.forEach((link) => link.classList.toggle("active", link.dataset.section === sectionId));
  }
  tocLinks.forEach((link) =>
    link.addEventListener("click", (event) => {
      event.preventDefault();
      revealSection(link.dataset.section);
    }),
  );

  window.addEventListener("message", (event) => {
    if (event.data.type === "reveal") {
      revealSection(event.data.section);
      return;
    }
    if (event.data.type !== "state") {
      return;
    }
    const state = event.data.state;
    refreshButton.disabled = false;
    refreshButton.textContent = "Refresh statuses";
    renderSessionIcons(state.sessionIcons);
    renderLinkSettings(state.linkSettings);
    renderProjects(state.projects);
    renderPrStatuses(state.prStatuses);
    markActiveSection();
  });
  vscodeApi.postMessage({ type: "ready" });
</script>
</body>
</html>`;
}
