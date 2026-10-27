import * as crypto from "crypto";
import * as path from "path";
import * as vscode from "vscode";
import { SessionAnalysis } from "./analysisState";
import { formatAge } from "./format";
import { SessionMeta } from "./indexer";
import { isPassiveMention, LinkCandidate, linkKey, summarizeAllCandidates } from "./linkCandidates";
import { LinkStatus } from "./linkStatus";
import { LinkStatusService } from "./linkStatusService";
import { isLinkShown, linkForItemKey, MarkedLink } from "./linkView";
import { LiveSessionMonitor } from "./liveSessions";
import { openInBrowser, openInVscode } from "./openUrl";
import { tildePath } from "./paths";
import { Registry } from "./registry";
import { acceptedOrder, linkStatusColor, ResourceRow, resourceRow } from "./resourceRows";
import { readLinkSettings, SessionLinkService } from "./sessionLinks";
import { SessionAnalyzer } from "./sessionAnalyzer";
import { SessionFocusTracker } from "./sessionFocus";
import { linkRowTitle, metaLine, metaTitle, shortLinkStatus, stateSentence, SummaryPrompt, summaryPrompt } from "./sessionSidebarText";
import { SessionPreview } from "./sessionPreview";
import { previewRunState, SidebarRunKind, sidebarRunKind } from "./sessionPreviewModel";
import { statusColorId } from "./sessionStatuses";
import { configuredStatuses, sessionStatusFor } from "./sessionStatusView";
import { SessionSummaryService } from "./sessionSummaries";
import { pickHoverSummary, SUMMARY_SOURCE_LABELS } from "./sessionSummary";
import { StatusConfig } from "./statusConfig";
import { sessionIdOfTerminal } from "./terminals";
import { buildWorkstreamDisplay, DisplayGroup, resolveItemDrop } from "./workstreamDisplay";
import {
  applyUserEdits,
  withoutRemovedItem,
  withPinnedItem,
  withRenamedWorkstream,
  withWorkstreamDone,
  withWorkstreamOrder,
  WorkstreamEdits,
} from "./workstreamEdits";

export const SESSION_PANEL_VIEW_ID = "overseer.session";
const PANEL_INTRODUCED_KEY = "overseer.sessionPanelIntroduced";
const ITEM_ROW_DEPTH = 1;

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
  sessionAnalyzer: SessionAnalyzer;
  findSessionMeta: (sessionId: string) => SessionMeta | undefined;
  sessionTitle: (sessionId: string) => string;
  globalState: vscode.Memento;
}

interface HeaderStatus {
  name: string;
  color: string;
  reason: string | undefined;
  isDerived: boolean;
}

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
  status: HeaderStatus | undefined;
  summary: { text: string; caption: string } | undefined;
  summaryPrompt: SummaryPrompt | undefined;
  isSummarizing: boolean;
  hasTranscript: boolean;
}

interface PanelRow extends ResourceRow {
  shortStatus: string | undefined;
  hoverTitle: string;
}

interface WorkView {
  isLoaded: boolean;
  isAnalyzing: boolean;
  where: string[];
  updatedAgo: string | undefined;
  groups: DisplayGroup<PanelRow>[];
  removedRows: PanelRow[];
  isEmpty: boolean;
}

interface PanelState {
  session: SessionDetails | undefined;
  work: WorkView | undefined;
  isJiraEnabled: boolean;
}

// The saved analysis before edits, plus the transcript's items, loaded together because both are async.
interface WorkSnapshot {
  savedAnalysis: SessionAnalysis | undefined;
  candidates: LinkCandidate[];
}

type PanelMessage =
  | { type: "ready" }
  | { type: "open"; key: string; target: "vscode" | "browser" }
  | { type: "copy"; key: string }
  | { type: "setMark"; key: string; mark: "removed" | null }
  | { type: "moveStatus"; key: string }
  | { type: "renameWorkstream"; id: string; title: string }
  | { type: "moveItem"; key: string; workstreamId: string }
  | { type: "reorderWorkstreams"; ids: string[] }
  | { type: "setWorkstreamDone"; id: string; done: boolean }
  | { type: "action"; action: string };

// Each sidebar action runs the same command as the tree's context menu, given the session ID.
const ACTION_COMMANDS: Record<string, string> = {
  suspend: "overseer.suspendSession",
  compact: "overseer.compactSession",
  clear: "overseer.clearSession",
  model: "overseer.switchModel",
  cost: "overseer.costSession",
  command: "overseer.runSessionCommand",
  summarize: "overseer.summarizeSession",
  analyze: "overseer.analyzeSession",
  recheckAnalysis: "overseer.recheckSession",
  openRepo: "overseer.openRepoInScm",
  status: "overseer.setSessionStatus",
  rename: "overseer.renameSession",
};

// Shows the focused session's workstreams, beside it in the Secondary Side Bar.
export class SessionPanelProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private shownLinks: MarkedLink[] = [];
  private shownGroups: DisplayGroup<PanelRow>[] = [];
  private readonly workSnapshots = new Map<string, WorkSnapshot>();
  private readonly workLoadsInFlight = new Set<string>();
  private readonly staleWorkLoads = new Set<string>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly dependencies: SessionPanelDependencies) {
    const postState = (): void => this.postState();
    this.disposables.push(
      vscode.window.onDidChangeActiveTerminal((terminal) => void this.introduceOnce(terminal)),
      dependencies.sessionFocus.onDidChange(() => {
        const sessionId = dependencies.sessionFocus.focusedSessionId();
        if (sessionId !== undefined && this.workSnapshots.has(sessionId)) {
          this.reloadWork(sessionId);
        }
        this.postState();
      }),
      vscode.window.onDidCloseTerminal(postState),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("overseer.links")) {
          this.postState();
        }
      }),
      dependencies.registry.onDidChange(postState),
      dependencies.statusConfig.onDidChange(postState),
      dependencies.linkStatusService.onDidChange(postState),
      dependencies.liveMonitor.onDidChange(postState),
      dependencies.summaryService.onDidChange(postState),
      dependencies.sessionAnalyzer.onDidChange((sessionId) => {
        if (sessionId === dependencies.sessionFocus.focusedSessionId()) {
          this.reloadWork(sessionId);
        } else {
          this.workSnapshots.delete(sessionId);
        }
        this.postState();
      }),
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

  // The snapshot loads async; edits apply here on every render, so a user edit shows without waiting for a reload or a model pass.
  private panelState(): PanelState {
    const sessionId = this.dependencies.sessionFocus.focusedSessionId();
    if (sessionId === undefined) {
      this.shownLinks = [];
      this.shownGroups = [];
      return { session: undefined, work: undefined, isJiraEnabled: false };
    }
    const meta = this.dependencies.findSessionMeta(sessionId);
    const snapshot = this.workSnapshots.get(sessionId);
    if (snapshot === undefined) {
      this.startWorkLoad(sessionId);
    }
    const edits = this.dependencies.sessionAnalyzer.currentEdits(sessionId);
    const analysis = snapshot?.savedAnalysis === undefined ? undefined : applyUserEdits(snapshot.savedAnalysis, edits);
    return {
      session: this.sessionDetails(sessionId, meta, analysis),
      work: this.workView(sessionId, snapshot, analysis, edits),
      isJiraEnabled: readLinkSettings().enabledKinds.has("ticket"),
    };
  }

  private workView(
    sessionId: string,
    snapshot: WorkSnapshot | undefined,
    analysis: SessionAnalysis | undefined,
    edits: WorkstreamEdits,
  ): WorkView {
    const { registry, sessionAnalyzer, linkStatusService } = this.dependencies;
    const candidates = snapshot?.candidates ?? [];
    const linkMarks = registry.linkMarks(sessionId);
    const removedItemKeys = new Set(edits.removedItems);
    const linkSettings = readLinkSettings();
    const candidatesByKey = new Map(candidates.map((candidate) => [linkKey(candidate), candidate]));
    const lastActivityByKey = new Map(candidates.map((candidate) => [linkKey(candidate), candidate.lastSeenOffsetBytes ?? 0]));
    const candidateItemKeys = [
      ...candidates.filter((candidate) => !isPassiveMention(candidate)).map(linkKey),
      ...Object.keys(linkMarks).filter((itemKey) => linkMarks[itemKey] === "pinned"),
      ...(analysis?.seedFacts.keptItemKeys ?? []),
    ];
    const shownLinksByKey = new Map<string, MarkedLink>();
    const rowFor = (itemKey: string): PanelRow | undefined => {
      const knownLink = candidatesByKey.get(itemKey) ?? linkForItemKey(itemKey);
      if (knownLink === undefined) {
        return undefined;
      }
      const status = linkStatusService.statusFor(knownLink);
      if (!isLinkShown(knownLink, status, linkSettings)) {
        return undefined;
      }
      const link: MarkedLink = { ...knownLink, mark: removedItemKeys.has(itemKey) ? "removed" : linkMarks[itemKey] };
      shownLinksByKey.set(itemKey, link);
      return this.rowFor(link, status, analysis?.artifactTitles[itemKey], linkSettings.jiraBaseUrl);
    };
    const display = buildWorkstreamDisplay({
      analysis,
      workstreamOrder: edits.workstreamOrder,
      candidateItemKeys,
      removedItemKeys: [...removedItemKeys],
      lastActivityOf: (itemKey) => lastActivityByKey.get(itemKey) ?? 0,
      rowFor,
    });
    this.shownLinks = [...shownLinksByKey.values()];
    this.shownGroups = display.groups;
    return {
      isLoaded: snapshot !== undefined,
      isAnalyzing: sessionAnalyzer.isAnalyzing(sessionId),
      where: analysis?.where ?? [],
      updatedAgo: analysis?.lastPassAt === undefined ? undefined : formatAge(analysis.lastPassAt),
      groups: display.groups,
      removedRows: display.removedRows,
      isEmpty: display.isEmpty,
    };
  }

  private startWorkLoad(sessionId: string): void {
    if (!this.workLoadsInFlight.has(sessionId)) {
      void this.loadWork(sessionId);
    }
  }

  // A change during a load means the load may have read old data, so one more load follows it.
  private reloadWork(sessionId: string): void {
    if (this.workLoadsInFlight.has(sessionId)) {
      this.staleWorkLoads.add(sessionId);
      return;
    }
    void this.loadWork(sessionId);
  }

  private async loadWork(sessionId: string): Promise<void> {
    const { sessionAnalyzer, linkService, findSessionMeta } = this.dependencies;
    this.workLoadsInFlight.add(sessionId);
    const meta = findSessionMeta(sessionId);
    const snapshot = await Promise.all([sessionAnalyzer.savedAnalysis(sessionId), meta === undefined ? undefined : linkService.scanStateFor(meta)])
      .then(([savedAnalysis, scanState]): WorkSnapshot => ({
        savedAnalysis,
        candidates: scanState === undefined ? [] : summarizeAllCandidates(scanState),
      }))
      .catch((): WorkSnapshot => ({ savedAnalysis: undefined, candidates: [] }));
    this.workSnapshots.set(sessionId, snapshot);
    this.workLoadsInFlight.delete(sessionId);
    if (this.staleWorkLoads.delete(sessionId)) {
      void this.loadWork(sessionId);
    }
    this.postState();
  }

  private sessionDetails(sessionId: string, meta: SessionMeta | undefined, analysis: SessionAnalysis | undefined): SessionDetails {
    const { liveMonitor, sessionFocus, summaryService, sessionTitle } = this.dependencies;
    const liveSession = liveMonitor.get(sessionId);
    const runKind = sidebarRunKind(sessionFocus.focusSource() === "terminal", liveSession);
    const isLive = runKind === "idle" || runKind === "busy";
    const { stateLabel, resumeLabel } = previewRunState(isLive ? undefined : liveSession);
    const summary = meta && pickHoverSummary(meta.recap, summaryService.summaryFor(sessionId), meta.sizeBytes);
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
      status: this.headerStatus(sessionId, analysis),
      summary:
        summary === undefined
          ? undefined
          : { text: summary.text, caption: `${SUMMARY_SOURCE_LABELS[summary.source]} · ${formatAge(summary.writtenAtMs)}` },
      summaryPrompt: summaryPrompt(summary, meta !== undefined),
      isSummarizing: summaryService.isSummarizing(sessionId),
      hasTranscript: meta !== undefined,
    };
  }

  // A status the user set wins; otherwise the analyzer's derived status shows, tagged as automatic.
  private headerStatus(sessionId: string, analysis: SessionAnalysis | undefined): HeaderStatus | undefined {
    const userStatus = sessionStatusFor(this.dependencies.registry, sessionId);
    const derivedStatus =
      userStatus === undefined && analysis?.sessionStatus !== undefined
        ? configuredStatuses().find((status) => status.id === analysis.sessionStatus)
        : undefined;
    const shownStatus = userStatus ?? derivedStatus;
    if (shownStatus === undefined) {
      return undefined;
    }
    return {
      name: shownStatus.name,
      color: `--vscode-${statusColorId(shownStatus.color).replace(/\./g, "-")}`,
      reason: userStatus?.reason,
      isDerived: userStatus === undefined,
    };
  }

  // An artifact shows the analyzer's short title; its slug stays in the hover text.
  private rowFor(link: MarkedLink, status: LinkStatus | undefined, artifactTitle: string | undefined, jiraBaseUrl: string): PanelRow {
    const row = resourceRow(link, status, linkStatusColor(this.dependencies.statusConfig, link, status), jiraBaseUrl, ITEM_ROW_DEPTH);
    const shownLabel = link.kind === "artifact" && artifactTitle !== undefined ? artifactTitle : row.label;
    return { ...row, label: shownLabel, shortStatus: shortLinkStatus(row.statusText), hoverTitle: linkRowTitle(row) };
  }

  private urlFor(key: string): string | undefined {
    const link = this.shownLink(key);
    return link === undefined ? undefined : resourceRow(link, undefined, undefined, readLinkSettings().jiraBaseUrl).url;
  }

  private shownLink(key: string): MarkedLink | undefined {
    return this.shownLinks.find((link) => linkKey(link) === key);
  }

  private isShownWorkstream(workstreamId: unknown): workstreamId is string {
    return this.shownGroups.some((group) => !group.isUnsorted && group.id === workstreamId);
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
    const storedEdits = registry.workstreamEdits(sessionId);
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
      case "setMark":
        await this.setRemoved(sessionId, message.key, message.mark === "removed", storedEdits);
        return;
      case "renameWorkstream":
        if (this.isShownWorkstream(message.id) && typeof message.title === "string") {
          await registry.setWorkstreamEdits(sessionId, withRenamedWorkstream(storedEdits, message.id, message.title));
        }
        return;
      case "moveItem": {
        const targetWorkstreamId = resolveItemDrop(this.shownGroups, message.key, message.workstreamId);
        if (targetWorkstreamId !== undefined) {
          await registry.setWorkstreamEdits(sessionId, withPinnedItem(storedEdits, message.key, targetWorkstreamId));
        }
        return;
      }
      case "reorderWorkstreams": {
        const shownWorkstreamIds = this.shownGroups.filter((group) => !group.isUnsorted).map((group) => group.id);
        const workstreamOrder = Array.isArray(message.ids) ? acceptedOrder(shownWorkstreamIds, message.ids) : undefined;
        if (workstreamOrder !== undefined) {
          await registry.setWorkstreamEdits(sessionId, withWorkstreamOrder(storedEdits, workstreamOrder));
        }
        return;
      }
      case "setWorkstreamDone":
        if (this.isShownWorkstream(message.id) && typeof message.done === "boolean") {
          await registry.setWorkstreamEdits(sessionId, withWorkstreamDone(storedEdits, message.id, message.done));
        }
        return;
      case "action":
        if (message.action === "resume") {
          await this.resume(sessionId);
        } else if (Object.hasOwn(ACTION_COMMANDS, message.action)) {
          await vscode.commands.executeCommand(ACTION_COMMANDS[message.action], sessionId);
        }
        return;
    }
  }

  // Link marks hold removals; a restore also clears an older removal kept in the stored edits.
  private async setRemoved(sessionId: string, itemKey: string, isRemoved: boolean, storedEdits: WorkstreamEdits): Promise<void> {
    const { registry } = this.dependencies;
    if (this.shownLink(itemKey) === undefined) {
      return;
    }
    await registry.setLinkMark(sessionId, [itemKey], isRemoved ? "removed" : undefined);
    if (!isRemoved && storedEdits.removedItems.includes(itemKey)) {
      await registry.setWorkstreamEdits(sessionId, withoutRemovedItem(storedEdits, itemKey));
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
  :root {
    color-scheme: light dark;
    --s1: 4px;
    --s2: 8px;
    --s3: 12px;
    --s4: 16px;
    --row-height: 28px;
    --indent: 12px;
    --icon-size: 14px;
    --mono: var(--vscode-editor-font-family);
    --muted: var(--vscode-descriptionForeground);
    --hairline: var(--vscode-sideBarSectionHeader-border, var(--vscode-widget-border, transparent));
    --outline: var(--vscode-button-border, var(--vscode-contrastBorder, var(--vscode-widget-border, var(--vscode-descriptionForeground))));
  }
  html, body, #root { height: 100%; }
  body {
    margin: 0;
    padding: 0;
    font-family: var(--vscode-font-family);
    font-size: 13px;
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
  }
  #root { display: flex; flex-direction: column; }
  button { font: inherit; color: inherit; background: none; border: none; padding: 0; cursor: pointer; }
  :focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .scroll { flex: 1; min-height: 0; overflow: auto; padding-bottom: var(--s3); }
  .scroll.centered { display: flex; align-items: center; justify-content: center; padding-bottom: 0; }
  .mono { font-family: var(--mono); }
  .ellipsis { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .header { padding: var(--s4) var(--s4) 0; }
  .title-line { display: flex; align-items: center; gap: var(--s2); min-width: 0; }
  .title-line > .codicon { flex-shrink: 0; font-size: var(--icon-size); }
  h1 { flex: 1 1 auto; min-width: 64px; margin: 0; font-size: 14px; font-weight: 600; }
  .header-status { flex: 0 1 auto; display: flex; align-items: baseline; gap: var(--s1); min-width: 0; max-width: 50%; font-size: 11px; color: var(--status-color, var(--muted)); }
  .header-status .name { min-width: 0; }
  .auto-tag { flex-shrink: 0; font-size: 10px; color: var(--muted); }
  .meta-line { margin: var(--s1) 0 0 calc(var(--icon-size) + var(--s2)); font-size: 11px; color: var(--muted); }
  .busy { color: var(--vscode-charts-blue); }
  .idle { color: var(--vscode-charts-green); }
  .paused { color: var(--vscode-icon-foreground); }
  .elsewhere { color: var(--vscode-charts-orange); }
  .where { margin: var(--s3) var(--s4) 0; padding-top: var(--s2); border-top: 1px solid var(--hairline); }
  .where-line { margin: 0; font-family: var(--mono); font-size: 12px; line-height: 18px; text-wrap: pretty; }
  .where-caption { display: flex; align-items: center; gap: var(--s1); margin: var(--s1) 0 0; font-size: 11px; color: var(--muted); }
  .where-caption .codicon { font-size: 12px; }
  .next { margin: var(--s4) var(--s4) 0; }
  .state-sentence { margin: 0 0 var(--s2); font-size: 11px; color: var(--muted); }
  .state-sentence.elsewhere { color: var(--vscode-charts-orange); }
  .recap-text { display: block; width: 100%; text-align: left; font-size: 14px; line-height: 22px; text-wrap: pretty; }
  .recap-text.clamped { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
  .caption { margin: var(--s1) 0 0; font-size: 11px; color: var(--vscode-disabledForeground); }
  .summary-prompt.stale { margin-top: var(--s1); }
  .summary-prompt .codicon { font-size: var(--icon-size); color: var(--vscode-editorWarning-foreground); }
  .muted { display: flex; align-items: center; gap: var(--s2); margin: 0; font-size: 12px; color: var(--muted); }
  .main-actions { display: flex; gap: var(--s2); margin-top: var(--s3); }
  .button { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: var(--s2); height: 32px; padding: 0 var(--s3); border-radius: 2px; font-size: 13px; font-weight: 500; transition: background-color 80ms linear; }
  .button .codicon { font-size: var(--icon-size); }
  .button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .button.primary:hover { background: var(--vscode-button-hoverBackground); }
  .button.outline { border: 1px solid var(--outline); color: var(--vscode-foreground); }
  .button.outline:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
  .button.square { flex: none; width: 32px; padding: 0; }
  .button.compact { flex: none; height: var(--row-height); }
  .button:disabled { opacity: 0.5; cursor: default; }
  .work { margin-top: var(--s4); padding-top: var(--s3); border-top: 1px solid var(--hairline); }
  .section-heading { display: flex; align-items: center; gap: var(--s1); height: var(--row-height); padding: 0 var(--s2) 0 var(--s4); }
  .section-heading h2 { flex: 1; margin: 0; font-family: var(--mono); font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  .icon-button { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 4px; color: var(--muted); transition: background-color 80ms linear; }
  .icon-button:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
  .icon-button:disabled { opacity: 0.4; cursor: default; }
  .icon-button .codicon { font-size: var(--icon-size); }
  .loading-work { padding: 0 var(--s4); }
  .link-button { flex-shrink: 0; color: var(--vscode-textLink-foreground); }
  .link-button:hover { text-decoration: underline; }
  .empty-work { display: flex; flex-direction: column; align-items: flex-start; gap: var(--s2); margin: var(--s1) var(--s4) 0; font-size: 12px; line-height: 18px; color: var(--muted); }
  .empty-work p { margin: 0; }
  .ws-group { margin-top: var(--s2); }
  .ws-group.done { opacity: 0.6; }
  .ws-group.done:hover, .ws-group.done:focus-within { opacity: 1; }
  .ws-group.drop-target { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .ws-header { position: relative; display: flex; align-items: center; gap: var(--s1); height: var(--row-height); padding: 0 var(--s2) 0 var(--s4); transition: background-color 80ms linear; }
  .ws-header:hover { background: var(--vscode-list-hoverBackground); }
  .chevron { flex-shrink: 0; display: inline-flex; color: var(--muted); }
  .chevron .codicon { font-size: var(--icon-size); transition: transform 120ms ease-out; }
  .ws-group.expanded .chevron .codicon { transform: rotate(90deg); }
  .done-check { flex-shrink: 0; font-size: var(--icon-size); color: var(--vscode-charts-green); }
  .ws-title { flex: 1; min-width: 0; font-size: 13px; font-weight: 600; }
  .unsorted .ws-title { font-weight: 400; color: var(--muted); }
  .ws-count { flex-shrink: 0; font-family: var(--mono); font-size: 11px; color: var(--muted); }
  .rename-input { flex: 1; min-width: 0; height: 22px; padding: 0 var(--s1); border: 1px solid var(--vscode-focusBorder); border-radius: 2px; font: inherit; font-size: 13px; font-weight: 600; color: var(--vscode-input-foreground); background: var(--vscode-input-background); outline: none; }
  .ws-actions { display: none; flex-shrink: 0; }
  .ws-header:hover .ws-actions, .ws-header:focus-within .ws-actions, .ws-header:has(.is-open) .ws-actions { display: flex; }
  .ws-header:hover .ws-count, .ws-header:focus-within .ws-count, .ws-header:has(.is-open) .ws-count { display: none; }
  .ticket-line { display: flex; flex-wrap: wrap; gap: 0 var(--s2); max-height: 36px; overflow: hidden; padding: 0 var(--s4) var(--s1) calc(var(--s4) + var(--icon-size) + var(--s1)); }
  .ticket-chip { display: inline-flex; align-items: center; gap: var(--s1); font-family: var(--mono); font-size: 11px; line-height: 18px; color: var(--vscode-foreground); text-decoration: none; }
  a.ticket-chip:hover { text-decoration: underline; }
  .dot { flex-shrink: 0; width: 6px; height: 6px; border-radius: 50%; background: var(--status-color, var(--muted)); }
  .list { list-style: none; margin: 0; padding: 0; }
  .link-row { position: relative; display: flex; align-items: center; gap: var(--s2); height: var(--row-height); padding: 0 var(--s4) 0 calc(var(--s4) + var(--depth, 0) * var(--indent)); transition: background-color 80ms linear; }
  .link-row:hover { background: var(--vscode-list-hoverBackground); }
  .glyph { flex-shrink: 0; width: var(--icon-size); height: var(--icon-size); stroke: var(--status-color, var(--muted)); }
  .key { flex: 0 1 auto; min-width: 32px; max-width: 72px; font-family: var(--mono); font-size: 11px; color: var(--vscode-foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-decoration: none; }
  a.key { cursor: pointer; }
  a.key:hover { text-decoration: underline; }
  .label { flex: 1 1 0; min-width: 0; font-size: 13px; color: var(--muted); }
  .short-status { flex: 0 1 auto; min-width: 0; max-width: 30%; font-family: var(--mono); font-size: 11px; color: var(--status-color, var(--muted)); }
  .actions { display: none; flex-shrink: 0; margin: calc(-1 * var(--s1)) calc(-1 * var(--s2)) calc(-1 * var(--s1)) 0; }
  .link-row:hover .actions, .link-row:focus-within .actions, .link-row:has(.is-open) .actions { display: flex; }
  .link-row:hover .short-status, .link-row:focus-within .short-status, .link-row:has(.is-open) .short-status { display: none; }
  .gripper { position: absolute; left: 1px; visibility: hidden; cursor: grab; font-size: var(--icon-size); color: var(--muted); }
  .link-row:hover .gripper, .ws-header:hover .gripper { visibility: visible; }
  .removed .key { text-decoration: line-through; }
  .disclosure { display: flex; align-items: center; gap: var(--s1); width: 100%; height: var(--row-height); margin-top: var(--s2); padding: 0 var(--s4); font-size: 12px; text-align: left; color: var(--muted); }
  .disclosure:hover { color: var(--vscode-foreground); }
  .disclosure .codicon { flex-shrink: 0; font-size: var(--icon-size); transition: transform 120ms ease-out; }
  .disclosure[aria-expanded="true"] .codicon-chevron-right { transform: rotate(90deg); }
  .dragging { opacity: 0.4; }
  .drop-before { box-shadow: inset 0 2px 0 var(--vscode-focusBorder); }
  .drop-after { box-shadow: inset 0 -2px 0 var(--vscode-focusBorder); }
  .menu {
    position: fixed;
    top: var(--menu-top, 0);
    left: var(--menu-left, 0);
    z-index: 10;
    min-width: 184px;
    max-width: calc(100vw - 2 * var(--s1));
    padding: var(--s1) 0;
    box-sizing: border-box;
    border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, transparent));
    border-radius: 4px;
    background: var(--vscode-menu-background);
    color: var(--vscode-menu-foreground);
    box-shadow: 0 2px 8px var(--vscode-widget-shadow, transparent);
  }
  .menu-item { display: flex; align-items: center; gap: var(--s2); width: 100%; height: 22px; padding: 0 var(--s2); font-size: 13px; text-align: left; white-space: nowrap; }
  .menu-item span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .menu-item:hover, .menu-item:focus-visible { background: var(--vscode-menu-selectionBackground); color: var(--vscode-menu-selectionForeground); outline: none; }
  .menu-item .codicon { flex-shrink: 0; font-size: var(--icon-size); }
  .menu-heading { margin: 0; padding: var(--s1) var(--s2) 2px; font-family: var(--mono); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  .menu-separator { height: 1px; margin: var(--s1) 0; background: var(--vscode-menu-separatorBackground, var(--vscode-menu-border)); }
  .toolbar {
    flex-shrink: 0;
    padding: var(--s2);
    border-top: 1px solid var(--hairline);
    background: var(--vscode-sideBarSectionHeader-background, var(--vscode-editorWidget-background));
  }
  .group-label { margin: 0; padding: 2px var(--s2) var(--s1); font-family: var(--mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  .group-hint { margin-left: var(--s1); font-family: var(--vscode-font-family); font-size: 11px; letter-spacing: normal; text-transform: none; color: var(--vscode-disabledForeground); }
  .tile-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(56px, 1fr)); gap: 2px; margin-bottom: var(--s2); }
  .tile-grid:last-child { margin-bottom: 0; }
  .tile { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; padding: var(--s1) 0; border-radius: 4px; color: var(--vscode-icon-foreground); transition: background-color 80ms linear, color 80ms linear; }
  .tile:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-textLink-activeForeground); }
  .tile:disabled { opacity: 0.5; cursor: default; }
  .tile .codicon { font-size: var(--s4); }
  .tile span:last-child { max-width: 100%; padding: 0 2px; box-sizing: border-box; font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .empty { padding: var(--s4); font-size: 13px; line-height: 20px; text-align: center; color: var(--muted); }
  .empty p { margin: var(--s1) 0 0; }
  .empty .lead { margin-top: var(--s2); color: var(--vscode-foreground); }
  .empty .codicon { font-size: var(--s4); }
  @media (prefers-reduced-motion: reduce) {
    .link-row, .ws-header, .button, .icon-button, .tile, .chevron .codicon, .disclosure .codicon { transition: none; }
  }
</style>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const savedViewState = readSavedViewState();
  let isRecapExpanded = false;
  let shownSessionId = undefined;
  const RUN_ICONS = { idle: "circle-filled", busy: "loading", paused: "debug-pause", elsewhere: "broadcast" };
  const UNSORTED_GROUP_ID = "unsorted";
  const REMOVED_GROUP_ID = "removed";
  const MENU_MARGIN_PX = 4;
  const MENU_GAP_PX = 2;
  const CLAUDE_ACTIONS = [
    ["compact", "fold", "Compact", "Compact"],
    ["clear", "clear-all", "Clear", "Clear"],
    ["model", "sparkle", "Model", "Model"],
    ["cost", "graph", "Cost", "Cost"],
    ["command", "terminal", "Run…", "Run command"],
  ];
  const SESSION_ACTIONS = [
    ["analyze", "sync", "Update", "Update now"],
    ["recheckAnalysis", "layers", "Recheck", "Recheck from scratch"],
    ["openRepo", "source-control", "Repo", "Open repo"],
    ["status", "tag", "Status", "Set status"],
    ["rename", "edit", "Rename", "Rename"],
  ];
  const ACTIONS_WITHOUT_TRANSCRIPT = new Set(["rename", "status"]);
  const MISSING_LABELS = { ticket: "Summary loads from Jira", pr: "Title loads from GitHub", artifact: "", commit: "" };
  let panelState = undefined;
  let openMenuId = undefined;
  let menuBuilders = new Map();
  let renaming = undefined;
  let draggedItem = undefined;
  let draggedGroupId = undefined;

  // Collapse choices are kept per session; a group with no choice uses its default.
  function readSavedViewState() {
    const saved = vscode.getState();
    const collapsedBySession = saved && typeof saved.collapsedBySession === "object" && saved.collapsedBySession !== null ? saved.collapsedBySession : {};
    return { collapsedBySession };
  }

  function isCollapsed(groupId, isCollapsedByDefault) {
    const choice = savedViewState.collapsedBySession[shownSessionId]?.[groupId];
    return typeof choice === "boolean" ? choice : isCollapsedByDefault;
  }

  function setCollapsed(groupId, collapsed) {
    savedViewState.collapsedBySession[shownSessionId] = { ...savedViewState.collapsedBySession[shownSessionId], [groupId]: collapsed };
    vscode.setState(savedViewState);
    render();
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

  function classNames(...names) {
    return names.filter(Boolean).join(" ");
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
    svg.innerHTML = row.glyph;
    return svg;
  }

  function send(message) {
    vscode.postMessage(message);
  }

  function runAction(action) {
    send({ type: "action", action });
  }

  function keyElement(row, className) {
    if (row.url === undefined) {
      const plainKey = element("span", className, row.displayId);
      if (row.kind === "ticket") {
        plainKey.title = "Set overseer.links.jira.baseUrl to open tickets";
      }
      return plainKey;
    }
    const link = element("a", className, row.displayId);
    link.href = "#";
    link.title = "Open " + row.displayId;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
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

  // The menu itself is drawn on the panel after render, so a row's edge never clips it.
  function menuButton(menuId, iconName, label, buildItems) {
    menuBuilders.set(menuId, buildItems);
    const isOpen = openMenuId === menuId;
    const button = iconButton(iconName, label, () => {
      openMenuId = isOpen ? undefined : menuId;
      render();
    });
    button.dataset.menuId = menuId;
    button.classList.toggle("is-open", isOpen);
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", String(isOpen));
    return button;
  }

  function drawOpenMenu(root) {
    const anchor = openMenuId === undefined ? null : root.querySelector('[data-menu-id="' + CSS.escape(openMenuId) + '"]');
    if (anchor === null) {
      openMenuId = undefined;
      return;
    }
    const menu = element("div", "menu");
    menu.setAttribute("role", "menu");
    menu.append(...menuBuilders.get(openMenuId)());
    menu.addEventListener("click", (event) => event.stopPropagation());
    root.append(menu);
    const anchorBounds = anchor.getBoundingClientRect();
    const menuBounds = menu.getBoundingClientRect();
    const rightmostLeft = window.innerWidth - menuBounds.width - MENU_MARGIN_PX;
    const left = Math.max(MENU_MARGIN_PX, Math.min(anchorBounds.right - menuBounds.width, rightmostLeft));
    const fitsBelow = anchorBounds.bottom + MENU_GAP_PX + menuBounds.height <= window.innerHeight - MENU_MARGIN_PX;
    const top = fitsBelow ? anchorBounds.bottom + MENU_GAP_PX : Math.max(MENU_MARGIN_PX, anchorBounds.top - MENU_GAP_PX - menuBounds.height);
    menu.style.setProperty("--menu-left", left + "px");
    menu.style.setProperty("--menu-top", top + "px");
  }

  function moveTargetItems(row, group) {
    const targets = panelState.work.groups.filter((otherGroup) => otherGroup.id !== group.id && !otherGroup.isUnsorted);
    const items = targets.map((target) => menuItem("arrow-right", target.title, () => send({ type: "moveItem", key: row.key, workstreamId: target.id })));
    if (!group.isUnsorted) {
      items.push(menuItem("inbox", "Unsorted", () => send({ type: "moveItem", key: row.key, workstreamId: UNSORTED_GROUP_ID })));
    }
    return items.length === 0 ? [] : [element("div", "menu-separator"), element("p", "menu-heading", "Move to"), ...items];
  }

  function rowActions(row, group) {
    const actions = element("div", "actions");
    if (row.mark === "removed") {
      actions.append(iconButton("discard", "Restore", () => send({ type: "setMark", key: row.key, mark: null })));
      return actions;
    }
    actions.append(
      iconButton("link-external", "Open in Browser", () => send({ type: "open", key: row.key, target: "browser" }), row.url === undefined),
      menuButton("row:" + row.key, "ellipsis", "More Actions", () => {
        const items = [];
        if (row.url !== undefined) {
          items.push(menuItem("browser", "Open in VS Code", () => send({ type: "open", key: row.key, target: "vscode" })));
        }
        items.push(menuItem("copy", "Copy Link", () => send({ type: "copy", key: row.key })));
        if (row.kind === "ticket" && panelState.isJiraEnabled) {
          items.push(menuItem("arrow-swap", "Move to Status…", () => send({ type: "moveStatus", key: row.key })));
        }
        items.push(...moveTargetItems(row, group));
        items.push(element("div", "menu-separator"));
        items.push(menuItem("close", "Remove from This Session", () => send({ type: "setMark", key: row.key, mark: "removed" })));
        return items;
      }),
    );
    return actions;
  }

  function itemRow(row, group) {
    const item = element("li", classNames("link-row", row.mark === "removed" && "removed"));
    item.style.setProperty("--depth", String(row.depth));
    if (row.statusColor) {
      item.style.setProperty("--status-color", row.statusColor);
    }
    item.title = row.hoverTitle;
    item.append(glyphElement(row), keyElement(row, "key"), element("span", "label ellipsis", row.label || MISSING_LABELS[row.kind]));
    if (row.shortStatus) {
      item.append(element("span", "short-status ellipsis", row.shortStatus));
    }
    if (row.mark === "removed") {
      item.append(rowActions(row, undefined));
      return item;
    }
    item.append(rowActions(row, group));
    makeItemDraggable(item, row, group);
    return item;
  }

  function makeItemDraggable(item, row, group) {
    item.draggable = true;
    const gripper = codicon("gripper", "Drag to Another Workstream");
    gripper.classList.add("gripper");
    item.prepend(gripper);
    item.addEventListener("dragstart", (event) => {
      event.stopPropagation();
      draggedItem = { key: row.key, groupId: group.id };
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", row.key);
      item.classList.add("dragging");
    });
    item.addEventListener("dragend", () => {
      draggedItem = undefined;
      item.classList.remove("dragging");
      clearDropMarks();
    });
  }

  function makeGroupDraggable(header, group) {
    header.draggable = true;
    const gripper = codicon("gripper", "Drag to Reorder");
    gripper.classList.add("gripper");
    header.prepend(gripper);
    header.addEventListener("dragstart", (event) => {
      draggedGroupId = group.id;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", group.id);
      header.parentElement.classList.add("dragging");
    });
    header.addEventListener("dragend", () => {
      draggedGroupId = undefined;
      header.parentElement.classList.remove("dragging");
      clearDropMarks();
    });
  }

  // A row dropped anywhere on another group moves there; a header dropped on another workstream reorders.
  function makeDropTarget(block, group) {
    block.addEventListener("dragover", (event) => {
      if (draggedItem !== undefined && draggedItem.groupId !== group.id) {
        event.preventDefault();
        if (!block.classList.contains("drop-target")) {
          clearDropMarks();
          block.classList.add("drop-target");
        }
        return;
      }
      if (draggedGroupId !== undefined && draggedGroupId !== group.id && !group.isUnsorted) {
        event.preventDefault();
        const bounds = block.getBoundingClientRect();
        clearDropMarks();
        block.classList.add(event.clientY > bounds.top + bounds.height / 2 ? "drop-after" : "drop-before");
      }
    });
    block.addEventListener("dragleave", (event) => {
      if (!block.contains(event.relatedTarget)) {
        block.classList.remove("drop-target", "drop-before", "drop-after");
      }
    });
    block.addEventListener("drop", (event) => {
      event.preventDefault();
      const isAfter = block.classList.contains("drop-after");
      clearDropMarks();
      if (draggedItem !== undefined) {
        send({ type: "moveItem", key: draggedItem.key, workstreamId: group.id });
      } else if (draggedGroupId !== undefined) {
        send({ type: "reorderWorkstreams", ids: reorderedWorkstreamIds(draggedGroupId, group.id, isAfter) });
      }
    });
  }

  function clearDropMarks() {
    document.querySelectorAll(".drop-target, .drop-before, .drop-after").forEach((marked) => marked.classList.remove("drop-target", "drop-before", "drop-after"));
  }

  function shownWorkstreamIds() {
    return panelState.work.groups.filter((group) => !group.isUnsorted).map((group) => group.id);
  }

  function reorderedWorkstreamIds(movedId, targetId, isAfter) {
    const ids = shownWorkstreamIds().filter((id) => id !== movedId);
    ids.splice(ids.indexOf(targetId) + (isAfter ? 1 : 0), 0, movedId);
    return ids;
  }

  function moveWorkstreamBy(groupId, step) {
    const ids = shownWorkstreamIds();
    const index = ids.indexOf(groupId);
    const targetIndex = index + step;
    if (index < 0 || targetIndex < 0 || targetIndex >= ids.length) {
      return;
    }
    ids.splice(index, 1);
    ids.splice(targetIndex, 0, groupId);
    send({ type: "reorderWorkstreams", ids });
  }

  function startRename(group) {
    openMenuId = undefined;
    renaming = { groupId: group.id, draft: group.title, isNew: true };
    render();
  }

  function commitRename() {
    if (renaming === undefined) {
      return;
    }
    const { groupId, draft } = renaming;
    renaming = undefined;
    const group = panelState.work?.groups.find((shownGroup) => shownGroup.id === groupId);
    if (group !== undefined && draft.trim() !== group.title) {
      send({ type: "renameWorkstream", id: groupId, title: draft });
    }
    render();
  }

  function cancelRename() {
    renaming = undefined;
    render();
  }

  function renameInput() {
    const input = element("input", "rename-input");
    input.type = "text";
    input.value = renaming.draft;
    input.setAttribute("aria-label", "Workstream name");
    input.addEventListener("input", () => {
      renaming.draft = input.value;
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitRename();
      } else if (event.key === "Escape") {
        event.stopPropagation();
        cancelRename();
      }
    });
    input.addEventListener("click", (event) => event.stopPropagation());
    return input;
  }

  // render() rebuilds the DOM, so the open rename input gets its focus back each time.
  function focusRenameInput(root) {
    const input = root.querySelector(".rename-input");
    if (input === null) {
      return;
    }
    input.focus();
    if (renaming.isNew) {
      input.select();
      renaming.isNew = false;
    } else {
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  function groupActions(group) {
    const actions = element("div", "ws-actions");
    const doneLabel = group.isDone ? "Mark Active" : "Mark Done";
    const setDone = () => send({ type: "setWorkstreamDone", id: group.id, done: !group.isDone });
    actions.append(
      iconButton("edit", "Rename", () => startRename(group)),
      iconButton(group.isDone ? "circle-large-outline" : "check", doneLabel, setDone),
      menuButton("group:" + group.id, "ellipsis", "More Actions", () => [
        menuItem("edit", "Rename", () => startRename(group)),
        menuItem(group.isDone ? "circle-large-outline" : "check", doneLabel, setDone),
        element("div", "menu-separator"),
        menuItem("arrow-up", "Move Up", () => moveWorkstreamBy(group.id, -1)),
        menuItem("arrow-down", "Move Down", () => moveWorkstreamBy(group.id, 1)),
      ]),
    );
    return actions;
  }

  function groupHeader(group, collapsed) {
    const header = element("div", "ws-header");
    const toggle = element("button", "chevron");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", (collapsed ? "Expand " : "Collapse ") + group.title);
    toggle.append(codicon("chevron-right"));
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      setCollapsed(group.id, !collapsed);
    });
    header.append(toggle);
    if (group.isDone) {
      const check = codicon("check", "Done");
      check.classList.add("done-check");
      header.append(check);
    }
    if (renaming?.groupId === group.id) {
      header.append(renameInput());
      return header;
    }
    const title = element("span", "ws-title ellipsis", group.title);
    title.title = group.title;
    header.append(title, element("span", "ws-count", String(group.tickets.length + group.rows.length)));
    if (!group.isUnsorted) {
      title.addEventListener("dblclick", () => startRename(group));
      header.append(groupActions(group));
      makeGroupDraggable(header, group);
    }
    return header;
  }

  function ticketLine(tickets) {
    const line = element("div", "ticket-line");
    for (const ticket of tickets) {
      const chip = keyElement(ticket, "ticket-chip");
      chip.textContent = "";
      if (ticket.statusColor) {
        chip.style.setProperty("--status-color", ticket.statusColor);
      }
      chip.title = ticket.hoverTitle;
      chip.append(element("span", "dot"), element("span", "", ticket.displayId));
      line.append(chip);
    }
    return line;
  }

  function groupElement(group) {
    const collapsed = isCollapsed(group.id, group.isCollapsedByDefault);
    const block = element("div", classNames("ws-group", group.isUnsorted && "unsorted", group.isDone && "done", !collapsed && "expanded"));
    block.append(groupHeader(group, collapsed));
    if (group.tickets.length > 0) {
      block.append(ticketLine(group.tickets));
    }
    if (!collapsed && group.rows.length > 0) {
      const list = element("ul", "list");
      list.append(...group.rows.map((row) => itemRow(row, group)));
      block.append(list);
    }
    makeDropTarget(block, group);
    return block;
  }

  function removedDisclosure(work) {
    const count = work.removedRows.length;
    if (count === 0) {
      return [];
    }
    const collapsed = isCollapsed(REMOVED_GROUP_ID, true);
    const toggle = textButton("disclosure", "chevron-right", "Removed (" + count + ")", () => setCollapsed(REMOVED_GROUP_ID, !collapsed));
    toggle.setAttribute("aria-expanded", String(!collapsed));
    if (collapsed) {
      return [toggle];
    }
    const list = element("ul", "list");
    list.append(...work.removedRows.map((row) => itemRow(row, undefined)));
    return [toggle, list];
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
      titleLine.append(headerStatus(session.status));
    }
    header.append(titleLine);
    if (session.metaLine) {
      const meta = element("p", "meta-line mono ellipsis", session.metaLine);
      meta.title = session.metaTitle;
      header.append(meta);
    }
    return header;
  }

  function headerStatus(status) {
    const statusElement = element("span", "header-status mono");
    statusElement.style.setProperty("--status-color", "var(" + status.color + ")");
    statusElement.append(element("span", "name ellipsis", status.name));
    if (status.isDerived) {
      statusElement.append(element("span", "auto-tag", "auto"));
      statusElement.title = status.name + " (set by the analyzer)";
    } else {
      statusElement.title = status.reason ? "Why: " + status.reason : status.name;
    }
    return statusElement;
  }

  function whereSection(work) {
    if (!work.isLoaded || (work.where.length === 0 && !work.isAnalyzing)) {
      return undefined;
    }
    const block = element("section", "where");
    block.append(...work.where.map((line) => element("p", "where-line", line)));
    const caption = element("p", "where-caption");
    if (work.isAnalyzing) {
      caption.append(spinner(), element("span", "", "Updating…"));
    } else if (work.updatedAgo) {
      caption.append(element("span", "", "updated " + work.updatedAgo));
    }
    if (caption.childNodes.length > 0) {
      block.append(caption);
    }
    return block;
  }

  function recapNodes(session) {
    if (session.isSummarizing) {
      const line = element("p", "muted");
      line.append(spinner(), document.createTextNode("Summarizing with Haiku…"));
      return [line];
    }
    const prompt = summaryPromptLine(session.summaryPrompt);
    if (session.summary === undefined) {
      return [prompt];
    }
    const text = textButton(isRecapExpanded ? "recap-text" : "recap-text clamped", undefined, session.summary.text, () => {
      isRecapExpanded = !isRecapExpanded;
      render();
    });
    text.title = isRecapExpanded ? "Show less" : "Show all";
    const nodes = [text, element("p", "caption", session.summary.caption)];
    return prompt === undefined ? nodes : [...nodes, prompt];
  }

  function summaryPromptLine(prompt) {
    if (prompt === undefined) {
      return undefined;
    }
    const line = element("p", prompt.kind === "stale" ? "muted summary-prompt stale" : "muted summary-prompt");
    if (prompt.kind === "stale") {
      line.append(codicon("warning"));
    }
    line.append(element("span", "", prompt.text));
    if (prompt.canRunHaiku) {
      line.append(textButton("link-button", undefined, "Run Haiku", () => runAction("summarize")));
    }
    return line;
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
    block.append(sentence, ...recapNodes(session).filter(Boolean), mainActions(session));
    return block;
  }

  function updateButton(session, work) {
    const label = session.hasTranscript ? (work.isAnalyzing ? "Updating…" : "Update Now") : "No transcript yet";
    const button = iconButton("sync", label, () => runAction("analyze"), work.isAnalyzing || !session.hasTranscript);
    if (work.isAnalyzing) {
      button.firstChild.classList.add("codicon-modifier-spin");
    }
    return button;
  }

  function emptyWork(session, work) {
    const empty = element("div", "empty-work");
    const update = textButton("button outline compact", "sync", "Update", () => runAction("analyze"));
    update.disabled = work.isAnalyzing || !session.hasTranscript;
    empty.append(element("p", "", "No work found yet. Update reads the transcript."), update);
    return empty;
  }

  function workSection(session, work) {
    const section = element("section", "work");
    const heading = element("div", "section-heading");
    const canRecheck = session.hasTranscript && !work.isAnalyzing;
    heading.append(
      element("h2", "", "Work"),
      updateButton(session, work),
      iconButton("layers", session.hasTranscript ? "Recheck from Scratch" : "No transcript yet", () => runAction("recheckAnalysis"), !canRecheck),
    );
    section.append(heading);
    if (!work.isLoaded) {
      const loading = element("p", "muted loading-work");
      loading.append(spinner(), element("span", "", "Reading the analysis…"));
      section.append(loading);
    } else if (work.isEmpty) {
      section.append(emptyWork(session, work));
    } else {
      section.append(...work.groups.map(groupElement));
    }
    section.append(...removedDisclosure(work));
    return section;
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

  // Each render rebuilds the scroll container, so its offset is carried over while the same session stays shown.
  function render() {
    const root = document.getElementById("root");
    const previousScrollTop = root.querySelector(".scroll")?.scrollTop ?? 0;
    const previousSessionId = shownSessionId;
    root.replaceChildren();
    menuBuilders = new Map();
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
      renaming = undefined;
      openMenuId = undefined;
    }
    const work = panelState.work;
    scroll.append(...[sessionHeader(session), whereSection(work), nextStep(session), workSection(session, work)].filter(Boolean));
    root.append(toolbar(session));
    if (session.sessionId === previousSessionId) {
      scroll.scrollTop = previousScrollTop;
    }
    drawOpenMenu(root);
    focusRenameInput(root);
  }

  document.addEventListener("click", (event) => {
    if (renaming !== undefined && !event.target.closest(".rename-input")) {
      commitRename();
      return;
    }
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
  window.addEventListener("resize", () => {
    if (openMenuId !== undefined) {
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
