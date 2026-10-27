import * as crypto from "crypto";
import * as path from "path";
import * as vscode from "vscode";
import { formatAge } from "./format";
import { CommitEntry } from "./gitStatus";
import { SessionMeta } from "./indexer";
import { isPassiveMention, LinkCandidate, summarizeAllCandidates } from "./linkCandidates";
import { LinkStatusService } from "./linkStatusService";
import { linkDisplayId } from "./linkView";
import { LiveSessionMonitor } from "./liveSessions";
import { openInBrowser } from "./openUrl";
import { tildePath } from "./paths";
import { Registry } from "./registry";
import { RepoService } from "./repoService";
import { commitDocumentUri } from "./repoTree";
import { readLinkSettings, SessionLinkService } from "./sessionLinks";
import { SummaryPrompt, summaryPrompt } from "./sessionSidebarText";
import { SessionSummaryService } from "./sessionSummaries";
import { pickHoverSummary, readTranscriptTail, SUMMARY_SOURCE_LABELS, transcriptTurns } from "./sessionSummary";
import {
  distinctLastPrompt,
  PreviewRunState,
  previewRunState,
  previewTabTitle,
  PreviewTurn,
  recentConversation,
  shownPreviewLinks,
} from "./sessionPreviewModel";

export const SESSION_PREVIEW_VIEW_TYPE = "overseer.sessionPreview";
const MAX_PREVIEW_COMMITS = 20;
const SHORT_HASH_LENGTH = 7;

export interface SessionPreviewDependencies {
  extensionUri: vscode.Uri;
  registry: Registry;
  liveMonitor: LiveSessionMonitor;
  summaryService: SessionSummaryService;
  repoService: RepoService;
  linkService: SessionLinkService;
  linkStatusService: LinkStatusService;
  findSessionMeta: (sessionId: string) => SessionMeta | undefined;
  sessionTitle: (sessionId: string) => string;
}

interface SessionCommit {
  commit: CommitEntry;
  repoRoot: string;
}

// Read from the transcript and git, so they load after the header and reload when the transcript grows.
interface SessionDetails {
  sessionId: string;
  loadKey: string;
  turns: PreviewTurn[];
  foundCommits: SessionCommit[];
  commitCandidates: LinkCandidate[];
  pullRequestCandidates: LinkCandidate[];
}

interface PreviewSummary {
  text: string;
  caption: string;
}

// A commit the session made that git can't find in its repos still shows, with the subject from the transcript.
interface PreviewCommit {
  hash: string;
  shortHash: string;
  subject: string | undefined;
  repoName: string | undefined;
  isFound: boolean;
}

interface PreviewPullRequest {
  url: string;
  label: string;
  title: string | undefined;
}

interface PreviewState extends PreviewRunState {
  title: string;
  lastActive: string | undefined;
  place: string;
  summary: PreviewSummary | undefined;
  summaryPrompt: SummaryPrompt | undefined;
  isSummarizing: boolean;
  canSummarize: boolean;
  firstPrompt: string | undefined;
  lastPrompt: string | undefined;
  turns: PreviewTurn[] | undefined;
  commits: PreviewCommit[] | undefined;
  areCommitsEnabled: boolean;
  pullRequests: PreviewPullRequest[] | undefined;
  cwd: string | undefined;
  otherRepos: string[];
}

type PreviewMessage =
  | { type: "ready" }
  | { type: "resume" }
  | { type: "summarize" }
  | { type: "openPullRequest"; url: string }
  | { type: "openCommit"; hash: string }
  | { type: "copyHash"; hash: string };

// One reused editor tab for sessions with no terminal here. Showing another session repopulates it.
export class SessionPreview implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private shownSessionId: string | undefined;
  private details: SessionDetails | undefined;
  private loadingKey: string | undefined;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly dependencies: SessionPreviewDependencies) {
    const postState = (): void => this.postState();
    this.disposables.push(
      dependencies.registry.onDidChange(postState),
      dependencies.liveMonitor.onDidChange(postState),
      dependencies.summaryService.onDidChange(postState),
      dependencies.linkStatusService.onDidChange(postState),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("overseer.links")) {
          this.postState();
        }
      }),
    );
  }

  sessionId(): string | undefined {
    return this.shownSessionId;
  }

  show(sessionId: string): void {
    this.shownSessionId = sessionId;
    if (this.panel === undefined) {
      this.panel = this.createPanel();
    } else {
      this.panel.reveal(undefined, true);
    }
    this.postState();
    this.changeEmitter.fire();
  }

  close(): void {
    this.panel?.dispose();
  }

  private createPanel(): vscode.WebviewPanel {
    const mediaRoot = vscode.Uri.joinPath(this.dependencies.extensionUri, "media");
    const panel = vscode.window.createWebviewPanel(
      SESSION_PREVIEW_VIEW_TYPE,
      "Session Preview",
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
      { enableScripts: true, localResourceRoots: [mediaRoot] },
    );
    const codiconStylesheet = panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "codicons", "codicon.css"));
    panel.webview.html = previewHtml(crypto.randomBytes(16).toString("base64"), panel.webview.cspSource, codiconStylesheet.toString());
    panel.webview.onDidReceiveMessage((message: PreviewMessage) => void this.receive(message), undefined, this.disposables);
    panel.onDidChangeViewState(() => this.postState(), undefined, this.disposables);
    panel.onDidDispose(
      () => {
        this.panel = undefined;
        this.shownSessionId = undefined;
        this.changeEmitter.fire();
      },
      undefined,
      this.disposables,
    );
    return panel;
  }

  // The terminal opens beside the active tab and its focus closes the preview, so it takes the preview's place.
  async resume(): Promise<void> {
    const sessionId = this.shownSessionId;
    if (sessionId === undefined) {
      return;
    }
    this.panel?.reveal(this.panel.viewColumn, false);
    await vscode.commands.executeCommand("overseer.openSessionById", sessionId);
  }

  private async receive(message: PreviewMessage): Promise<void> {
    const sessionId = this.shownSessionId;
    if (sessionId === undefined) {
      return;
    }
    switch (message.type) {
      case "ready":
        this.postState();
        return;
      case "resume":
        await this.resume();
        return;
      case "summarize":
        await vscode.commands.executeCommand("overseer.summarizeSession", sessionId);
        return;
      case "openPullRequest": {
        const pullRequest = this.details?.pullRequestCandidates.find(({ url }) => url === message.url);
        if (pullRequest?.url !== undefined) {
          await openInBrowser(pullRequest.url);
        }
        return;
      }
      case "openCommit": {
        const sessionCommit = this.details?.foundCommits.find(({ commit }) => commit.hash === message.hash);
        if (sessionCommit !== undefined) {
          const commitDocument = await vscode.workspace.openTextDocument(commitDocumentUri(sessionCommit.repoRoot, sessionCommit.commit));
          await vscode.languages.setTextDocumentLanguage(commitDocument, "diff");
          await vscode.window.showTextDocument(commitDocument, { preview: true });
        }
        return;
      }
      case "copyHash":
        if (typeof message.hash === "string") {
          await vscode.env.clipboard.writeText(message.hash);
        }
        return;
    }
  }

  private postState(): void {
    if (this.panel === undefined || this.shownSessionId === undefined) {
      return;
    }
    const previewState = this.previewState(this.shownSessionId);
    this.panel.title = previewTabTitle(previewState.title);
    void this.panel.webview.postMessage({ type: "state", state: previewState });
  }

  private previewState(sessionId: string): PreviewState {
    const { liveMonitor, summaryService, findSessionMeta, sessionTitle } = this.dependencies;
    const meta = findSessionMeta(sessionId);
    if (meta !== undefined) {
      this.loadDetails(meta);
    }
    const details = this.details?.sessionId === sessionId ? this.details : undefined;
    const linkSettings = readLinkSettings();
    const shownLinks = (candidates: LinkCandidate[]): LinkCandidate[] =>
      shownPreviewLinks(candidates, (link) => this.dependencies.linkStatusService.statusFor(link), linkSettings);
    const summary = meta && pickHoverSummary(meta.recap, summaryService.summaryFor(sessionId), meta.sizeBytes);
    return {
      title: sessionTitle(sessionId),
      lastActive: meta === undefined ? undefined : formatAge(meta.lastActivityMs),
      place: meta === undefined ? "" : sessionSubtitle(meta),
      ...previewRunState(liveMonitor.get(sessionId)),
      summary:
        summary === undefined
          ? undefined
          : { text: summary.text, caption: `${SUMMARY_SOURCE_LABELS[summary.source]} · ${formatAge(summary.writtenAtMs)}` },
      summaryPrompt: summaryPrompt(summary, meta !== undefined),
      isSummarizing: summaryService.isSummarizing(sessionId),
      canSummarize: meta !== undefined,
      firstPrompt: meta?.firstPrompt,
      lastPrompt: distinctLastPrompt(meta?.firstPrompt, meta?.lastPrompt),
      turns: details?.turns,
      commits: details === undefined ? undefined : previewCommits(shownLinks(details.commitCandidates), details.foundCommits),
      areCommitsEnabled: linkSettings.enabledKinds.has("commit"),
      pullRequests: details === undefined ? undefined : previewPullRequests(shownLinks(details.pullRequestCandidates)),
      cwd: meta === undefined ? undefined : tildePath(meta.resumeCwd ?? meta.startCwd),
      otherRepos: (meta?.otherReposTouched ?? []).map((repoRoot) => path.basename(repoRoot)),
    };
  }

  private loadDetails(meta: SessionMeta): void {
    const loadKey = `${meta.sessionId}:${meta.sizeBytes}`;
    if (this.details?.loadKey === loadKey || this.loadingKey === loadKey) {
      return;
    }
    this.loadingKey = loadKey;
    void Promise.all([this.readTurns(meta), this.readCandidates(meta)]).then(async ([turns, candidates]) => {
      const commitCandidates = newestFirst(candidates.filter((candidate) => candidate.kind === "commit")).slice(0, MAX_PREVIEW_COMMITS);
      const foundCommits = await this.readCommits(meta, commitCandidates.map(commitHashOf));
      if (this.loadingKey !== loadKey) {
        return;
      }
      this.loadingKey = undefined;
      this.details = {
        sessionId: meta.sessionId,
        loadKey,
        turns,
        foundCommits,
        commitCandidates,
        pullRequestCandidates: newestFirst(candidates.filter(isPreviewPullRequest)),
      };
      this.postState();
    });
  }

  private async readCandidates(meta: SessionMeta): Promise<LinkCandidate[]> {
    try {
      const scanState = await this.dependencies.linkService.scanStateFor(meta);
      return scanState === undefined ? [] : summarizeAllCandidates(scanState);
    } catch {
      return [];
    }
  }

  private async readTurns(meta: SessionMeta): Promise<PreviewTurn[]> {
    try {
      return recentConversation(transcriptTurns(await readTranscriptTail(meta.transcriptFile)));
    } catch {
      return [];
    }
  }

  private async readCommits(meta: SessionMeta, commitHashes: string[]): Promise<SessionCommit[]> {
    if (commitHashes.length === 0) {
      return [];
    }
    const repoRoots = [meta.homeRepo, ...meta.otherReposTouched].filter((repoRoot): repoRoot is string => repoRoot !== undefined);
    const commitsByRepo = await Promise.all(
      repoRoots.map(async (repoRoot) =>
        (await this.dependencies.repoService.describeCommits(repoRoot, commitHashes)).map((commit) => ({ commit, repoRoot })),
      ),
    );
    const commitsByHash = new Map(commitsByRepo.flat().map((sessionCommit) => [sessionCommit.commit.hash, sessionCommit]));
    return [...commitsByHash.values()];
  }

  dispose(): void {
    this.panel?.dispose();
    vscode.Disposable.from(...this.disposables).dispose();
    this.changeEmitter.dispose();
  }
}

function newestFirst(candidates: LinkCandidate[]): LinkCandidate[] {
  return [...candidates].sort((left, right) => (right.lastSeenOffsetBytes ?? 0) - (left.lastSeenOffsetBytes ?? 0));
}

function commitHashOf(candidate: LinkCandidate): string {
  return candidate.fullHash ?? candidate.id;
}

// Transcript order, newest first; a hash git found gets its subject and repo.
function previewCommits(commitCandidates: LinkCandidate[], foundCommits: SessionCommit[]): PreviewCommit[] {
  return commitCandidates.map((candidate) => {
    const hash = commitHashOf(candidate);
    const found = foundCommits.find(({ commit }) => commit.hash.startsWith(candidate.id));
    return {
      hash: found?.commit.hash ?? hash,
      shortHash: found?.commit.shortHash ?? hash.slice(0, SHORT_HASH_LENGTH),
      subject: found?.commit.subject ?? candidate.title,
      repoName: found === undefined ? undefined : path.basename(found.repoRoot),
      isFound: found !== undefined,
    };
  });
}

// A PR seen only in passing is noise.
function isPreviewPullRequest(candidate: LinkCandidate): boolean {
  return candidate.kind === "pr" && candidate.url !== undefined && !isPassiveMention(candidate);
}

function previewPullRequests(pullRequestCandidates: LinkCandidate[]): PreviewPullRequest[] {
  return pullRequestCandidates.map((candidate) => ({
    url: candidate.url ?? "",
    label: linkDisplayId(candidate),
    title: candidate.title,
  }));
}

function previewHtml(nonce: string, cspSource: string, codiconStylesheet: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${cspSource}; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Session Preview</title>
<link rel="stylesheet" href="${codiconStylesheet}">
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  body {
    margin: 0;
    padding: 0;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
  }
  button { font: inherit; color: inherit; background: none; border: none; padding: 0; cursor: pointer; }
  :focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
  p { margin: 0; }
  header {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: flex-start;
    gap: 16px;
    padding: 20px 24px 16px;
    background: var(--vscode-editor-background);
    border-bottom: 1px solid var(--vscode-panel-border, transparent);
  }
  .heading { flex: 1; min-width: 0; }
  h1 { margin: 0; font-size: 18px; font-weight: 600; line-height: 28px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; margin-top: 4px; font-size: 12px; color: var(--vscode-descriptionForeground); }
  .meta-item { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
  .meta-item .codicon { font-size: 12px; }
  .elsewhere { color: var(--vscode-charts-orange); }
  .button {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 12px;
    border-radius: 2px;
    font-size: 13px;
    transition: background-color 75ms;
  }
  .button .codicon { font-size: 14px; }
  .primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  .primary:hover { background: var(--vscode-button-hoverBackground); }
  .icon-button {
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: background-color 75ms;
  }
  .icon-button:hover { background: var(--vscode-toolbar-hoverBackground); }
  .columns { display: grid; grid-template-columns: 1fr; }
  @media (min-width: 900px) {
    .columns { grid-template-columns: 2fr 1fr; }
    .side { border-top: none !important; border-left: 1px solid var(--vscode-panel-border, transparent); }
  }
  .main, .side { padding: 24px; min-width: 0; }
  .side { border-top: 1px solid var(--vscode-panel-border, transparent); }
  section + section { margin-top: 32px; }
  .section-label { display: flex; align-items: center; height: 24px; margin-bottom: 8px; }
  h2 { flex: 1; margin: 0; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
  .count {
    margin-left: 4px;
    padding: 0 6px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 400;
    color: var(--vscode-badge-foreground);
    background: var(--vscode-badge-background);
  }
  .summary {
    padding: 16px;
    border: 1px solid var(--vscode-editorWidget-border, transparent);
    border-radius: 2px;
    background: var(--vscode-editorWidget-background);
    font-size: 13px;
    line-height: 20px;
  }
  .summary.empty { border-style: dashed; background: none; color: var(--vscode-descriptionForeground); }
  .summary-prompt { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 12px; color: var(--vscode-descriptionForeground); }
  .summary-prompt.stale { margin-top: 4px; }
  .summary-prompt .codicon { font-size: 14px; color: var(--vscode-editorWarning-foreground); }
  .link-button { color: var(--vscode-textLink-foreground); }
  .link-button:hover { text-decoration: underline; }
  .caption { margin-top: 12px; font-size: 12px; color: var(--vscode-descriptionForeground); }
  .muted { color: var(--vscode-descriptionForeground); font-size: 13px; line-height: 20px; }
  .turns { list-style: none; margin: 0; padding: 0; }
  .turn {
    display: grid;
    grid-template-columns: 20px 1fr;
    column-gap: 8px;
    padding: 12px 0;
    border-bottom: 1px solid var(--vscode-panel-border, transparent);
  }
  .turn:last-child { border-bottom: none; }
  .turn .codicon { margin-top: 2px; font-size: 14px; }
  .turn-text { font-size: 13px; line-height: 20px; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
  .turn.user .turn-text { font-weight: 500; }
  .turn.claude .turn-text, .turn.claude .codicon { color: var(--vscode-descriptionForeground); }
  .prompt + .prompt { margin-top: 16px; }
  .prompt-label { margin-bottom: 4px; font-size: 12px; color: var(--vscode-descriptionForeground); }
  .prompt-text { font-size: 13px; line-height: 20px; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
  .commits { list-style: none; margin: 0 -8px; padding: 0; }
  .commit {
    display: grid;
    grid-template-columns: 56px 1fr auto;
    align-items: start;
    column-gap: 8px;
    padding: 4px 8px;
    border-radius: 2px;
    transition: background-color 75ms;
  }
  .commit:hover { background: var(--vscode-list-hoverBackground); }
  .commit-hash { font-family: var(--vscode-editor-font-family); font-size: 12px; line-height: 20px; color: var(--vscode-textLink-foreground); text-align: left; }
  .commit-hash:hover { text-decoration: underline; }
  .commit-hash:disabled { color: var(--vscode-descriptionForeground); text-decoration: none; cursor: default; }
  .commit-subject { font-size: 13px; line-height: 20px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .commit-repo { font-size: 12px; color: var(--vscode-descriptionForeground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .commit .icon-button { opacity: 0; }
  .commit:hover .icon-button, .commit:focus-within .icon-button { opacity: 1; }
  .cwd { font-family: var(--vscode-editor-font-family); font-size: 12px; line-height: 20px; overflow-wrap: anywhere; color: var(--vscode-textPreformat-foreground); }
  .sublabel { margin-top: 8px; font-size: 12px; color: var(--vscode-descriptionForeground); }
  .repos { list-style: none; margin: 4px 0 0; padding: 0; }
  .repos li { display: flex; align-items: center; gap: 8px; height: 24px; font-size: 13px; }
  .repos .codicon { font-size: 14px; color: var(--vscode-descriptionForeground); }
  .pull-requests { list-style: none; margin: 0; padding: 0; }
  .pull-request + .pull-request { margin-top: 8px; }
  .pull-request-link { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; line-height: 20px; color: var(--vscode-textLink-foreground); }
  .pull-request-link:hover { text-decoration: underline; }
  .item-note { font-size: 12px; color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; }
  [hidden] { display: none !important; }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
</head>
<body>
<header>
  <div class="heading">
    <h1 id="title"></h1>
    <p class="meta">
      <span class="meta-item" id="state"><span class="codicon" id="state-icon"></span><span id="state-label"></span></span>
      <span class="meta-item" id="last-active"></span>
      <span class="meta-item" id="place"><span class="codicon codicon-git-branch"></span><span id="place-label"></span></span>
    </p>
  </div>
  <button type="button" class="button primary" id="resume"><span class="codicon" id="resume-icon"></span><span id="resume-label"></span></button>
</header>
<div class="columns">
  <main class="main">
    <section>
      <div class="section-label">
        <h2>Where it left off</h2>
        <button type="button" class="icon-button" id="summarize-again" title="Summarize again with Haiku" aria-label="Summarize again with Haiku"><span class="codicon codicon-sparkle"></span></button>
      </div>
      <div id="summary"></div>
    </section>
    <section>
      <div class="section-label"><h2>Last turns</h2></div>
      <div id="turns"></div>
    </section>
  </main>
  <aside class="side">
    <section id="prompts-section">
      <div class="section-label"><h2>Prompts</h2></div>
      <div id="prompts"></div>
    </section>
    <section id="pull-requests-section">
      <div class="section-label"><h2>Pull requests<span class="count" id="pull-request-count"></span></h2></div>
      <div id="pull-requests"></div>
    </section>
    <section id="commits-section">
      <div class="section-label"><h2>Commits<span class="count" id="commit-count"></span></h2></div>
      <div id="commits"></div>
    </section>
    <section id="where-section">
      <div class="section-label"><h2>Where</h2></div>
      <p class="cwd" id="cwd"></p>
      <p class="sublabel" id="repos-label">Also touched</p>
      <ul class="repos" id="repos"></ul>
    </section>
  </aside>
</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const byId = (elementId) => document.getElementById(elementId);

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

  function codicon(name) {
    return element("span", "codicon codicon-" + name);
  }

  function summaryPromptLine(prompt) {
    const line = element("p", prompt.kind === "stale" ? "summary-prompt stale" : "summary-prompt");
    if (prompt.kind === "stale") {
      line.append(codicon("warning"));
    }
    line.append(element("span", "", prompt.text));
    if (prompt.canRunHaiku) {
      const button = element("button", "link-button", "Run Haiku");
      button.type = "button";
      button.addEventListener("click", () => vscode.postMessage({ type: "summarize" }));
      line.append(button);
    }
    return line;
  }

  function renderHeader(state) {
    byId("title").textContent = state.title;
    byId("title").title = state.title;
    byId("state").classList.toggle("elsewhere", state.isElsewhere);
    byId("state-icon").className = "codicon " + (state.isElsewhere ? "codicon-broadcast" : "codicon-debug-pause");
    byId("state-label").textContent = state.stateLabel;
    byId("last-active").hidden = state.lastActive === undefined;
    byId("last-active").textContent = state.lastActive === undefined ? "" : "last active " + state.lastActive;
    byId("place").hidden = state.place === "";
    byId("place-label").textContent = state.place;
    byId("resume-icon").className = "codicon " + (state.isElsewhere ? "codicon-repo-forked" : "codicon-play");
    byId("resume-label").textContent = state.resumeLabel;
  }

  function renderSummary(state) {
    const container = byId("summary");
    byId("summarize-again").hidden = state.summary === undefined || state.isSummarizing || !state.canSummarize;
    if (state.isSummarizing) {
      const box = element("div", "summary empty");
      box.append(element("span", "codicon codicon-loading codicon-modifier-spin"), document.createTextNode(" Haiku is reading the transcript…"));
      container.replaceChildren(box);
      return;
    }
    if (state.summary === undefined) {
      const box = element("div", "summary empty");
      box.append(summaryPromptLine(state.summaryPrompt));
      container.replaceChildren(box);
      return;
    }
    const box = element("div", "summary");
    box.append(element("p", "", state.summary.text), element("p", "caption", state.summary.caption));
    if (state.summaryPrompt !== undefined) {
      box.append(summaryPromptLine(state.summaryPrompt));
    }
    container.replaceChildren(box);
  }

  function renderPullRequests(state) {
    const container = byId("pull-requests");
    const pullRequests = state.pullRequests ?? [];
    byId("pull-request-count").hidden = pullRequests.length === 0;
    byId("pull-request-count").textContent = String(pullRequests.length);
    if (state.pullRequests === undefined) {
      container.replaceChildren(element("p", "muted", "Reading the transcript…"));
      return;
    }
    if (pullRequests.length === 0) {
      container.replaceChildren(element("p", "muted", "None."));
      return;
    }
    const list = element("ul", "pull-requests");
    for (const pullRequest of pullRequests) {
      const item = element("li", "pull-request");
      const link = element("button", "pull-request-link");
      link.type = "button";
      link.title = pullRequest.url;
      link.append(codicon("git-pull-request"), element("span", "", pullRequest.label));
      link.addEventListener("click", () => vscode.postMessage({ type: "openPullRequest", url: pullRequest.url }));
      item.append(link);
      if (pullRequest.title) {
        item.append(element("p", "item-note", pullRequest.title));
      }
      list.append(item);
    }
    container.replaceChildren(list);
  }

  function renderTurns(state) {
    const container = byId("turns");
    if (state.turns === undefined) {
      container.replaceChildren(element("p", "muted", "Reading the transcript…"));
      return;
    }
    if (state.turns.length === 0) {
      container.replaceChildren(element("p", "muted", "No messages in the transcript yet."));
      return;
    }
    const list = element("ul", "turns");
    for (const turn of state.turns) {
      const isUser = turn.speaker === "user";
      const item = element("li", "turn " + turn.speaker);
      const icon = codicon(isUser ? "account" : "hubot");
      icon.title = isUser ? "You" : "Claude";
      item.append(icon, element("p", "turn-text", turn.text));
      list.append(item);
    }
    container.replaceChildren(list);
  }

  function renderPrompts(state) {
    const prompts = [["First", state.firstPrompt], ["Last", state.lastPrompt]].filter(([, text]) => text);
    byId("prompts-section").hidden = prompts.length === 0;
    byId("prompts").replaceChildren(
      ...prompts.map(([label, text]) => {
        const block = element("div", "prompt");
        block.append(element("p", "prompt-label", label), element("p", "prompt-text", text));
        return block;
      }),
    );
  }

  function renderCommits(state) {
    byId("commits-section").hidden = !state.areCommitsEnabled;
    const container = byId("commits");
    const commits = state.commits ?? [];
    byId("commit-count").hidden = commits.length === 0;
    byId("commit-count").textContent = String(commits.length);
    if (state.commits === undefined) {
      container.replaceChildren(element("p", "muted", "Looking up commits…"));
      return;
    }
    if (commits.length === 0) {
      container.replaceChildren(element("p", "muted", "None."));
      return;
    }
    const list = element("ul", "commits");
    for (const commit of commits) {
      const item = element("li", "commit");
      const hashButton = element("button", "commit-hash", commit.shortHash);
      hashButton.type = "button";
      hashButton.disabled = !commit.isFound;
      hashButton.title = commit.isFound ? "Show the commit" : "Not found in this session's repos";
      hashButton.addEventListener("click", () => vscode.postMessage({ type: "openCommit", hash: commit.hash }));
      const text = element("div");
      const subject = element("p", "commit-subject", commit.subject ?? "Not found in this session's repos");
      subject.title = subject.textContent;
      text.append(subject);
      if (commit.repoName !== undefined) {
        text.append(element("p", "commit-repo", commit.repoName));
      }
      const copyButton = element("button", "icon-button");
      copyButton.type = "button";
      copyButton.title = "Copy hash";
      copyButton.setAttribute("aria-label", "Copy hash");
      copyButton.append(codicon("copy"));
      copyButton.addEventListener("click", () => vscode.postMessage({ type: "copyHash", hash: commit.hash }));
      item.append(hashButton, text, copyButton);
      list.append(item);
    }
    container.replaceChildren(list);
  }

  function renderWhere(state) {
    byId("where-section").hidden = state.cwd === undefined;
    byId("cwd").textContent = state.cwd ?? "";
    byId("repos-label").hidden = state.otherRepos.length === 0;
    byId("repos").replaceChildren(
      ...state.otherRepos.map((repoName) => {
        const item = element("li");
        item.append(codicon("repo"), element("span", "", repoName));
        return item;
      }),
    );
  }

  byId("resume").addEventListener("click", () => vscode.postMessage({ type: "resume" }));
  byId("summarize-again").addEventListener("click", () => vscode.postMessage({ type: "summarize" }));
  window.addEventListener("message", (event) => {
    if (event.data.type !== "state") {
      return;
    }
    const state = event.data.state;
    renderHeader(state);
    renderSummary(state);
    renderTurns(state);
    renderPullRequests(state);
    renderPrompts(state);
    renderCommits(state);
    renderWhere(state);
  });
  vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
}

function sessionSubtitle(meta: SessionMeta): string {
  const repoName = path.basename(meta.resumeCwd ?? meta.startCwd);
  return [repoName, meta.gitBranch].filter((part) => part !== undefined && part !== "").join(" · ");
}
