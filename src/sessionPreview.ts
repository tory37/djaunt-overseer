import * as crypto from "crypto";
import * as path from "path";
import * as vscode from "vscode";
import { formatAge } from "./format";
import { CommitEntry } from "./gitStatus";
import { SessionMeta } from "./indexer";
import { LiveSessionMonitor } from "./liveSessions";
import { tildePath } from "./paths";
import { Registry } from "./registry";
import { RepoService } from "./repoService";
import { commitDocumentUri } from "./repoTree";
import { sessionSubtitle } from "./resourcesPanel";
import { SessionSummaryService } from "./sessionSummaries";
import { pickHoverSummary, readTranscriptTail, SUMMARY_SOURCE_LABELS, transcriptTurns } from "./sessionSummary";
import {
  distinctLastPrompt,
  PreviewRunState,
  previewRunState,
  previewTabTitle,
  PreviewTurn,
  recentConversation,
} from "./sessionPreviewModel";

export const SESSION_PREVIEW_VIEW_TYPE = "overseer.sessionPreview";
const MAX_PREVIEW_COMMITS = 20;

export interface SessionPreviewDependencies {
  extensionUri: vscode.Uri;
  registry: Registry;
  liveMonitor: LiveSessionMonitor;
  summaryService: SessionSummaryService;
  repoService: RepoService;
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
  commits: SessionCommit[];
}

interface PreviewSummary {
  text: string;
  caption: string;
  isStale: boolean;
}

interface PreviewCommit {
  hash: string;
  shortHash: string;
  subject: string;
  repoName: string;
}

interface PreviewState extends PreviewRunState {
  title: string;
  lastActive: string | undefined;
  place: string;
  summary: PreviewSummary | undefined;
  isSummarizing: boolean;
  canSummarize: boolean;
  firstPrompt: string | undefined;
  lastPrompt: string | undefined;
  turns: PreviewTurn[] | undefined;
  commits: PreviewCommit[] | undefined;
  cwd: string | undefined;
  otherRepos: string[];
}

type PreviewMessage =
  | { type: "ready" }
  | { type: "resume" }
  | { type: "summarize" }
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
        // The terminal opens beside the active tab and its focus closes the preview, so it takes the preview's place.
        this.panel?.reveal(this.panel.viewColumn, false);
        await vscode.commands.executeCommand("overseer.openSessionById", sessionId);
        return;
      case "summarize":
        await vscode.commands.executeCommand("overseer.summarizeSession", sessionId);
        return;
      case "openCommit": {
        const sessionCommit = this.details?.commits.find(({ commit }) => commit.hash === message.hash);
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
    const summary = meta && pickHoverSummary(meta.recap, summaryService.summaryFor(sessionId), meta.sizeBytes);
    return {
      title: sessionTitle(sessionId),
      lastActive: meta === undefined ? undefined : formatAge(meta.lastActivityMs),
      place: meta === undefined ? "" : sessionSubtitle(meta),
      ...previewRunState(liveMonitor.get(sessionId)),
      summary:
        summary === undefined
          ? undefined
          : { text: summary.text, caption: `${SUMMARY_SOURCE_LABELS[summary.source]} · ${formatAge(summary.writtenAtMs)}`, isStale: summary.isStale },
      isSummarizing: summaryService.isSummarizing(sessionId),
      canSummarize: meta !== undefined,
      firstPrompt: meta?.firstPrompt,
      lastPrompt: distinctLastPrompt(meta?.firstPrompt, meta?.lastPrompt),
      turns: details?.turns,
      commits: details?.commits.map(({ commit, repoRoot }) => ({
        hash: commit.hash,
        shortHash: commit.shortHash,
        subject: commit.subject,
        repoName: path.basename(repoRoot),
      })),
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
    void Promise.all([this.readTurns(meta), this.readCommits(meta)]).then(([turns, commits]) => {
      if (this.loadingKey !== loadKey) {
        return;
      }
      this.loadingKey = undefined;
      this.details = { sessionId: meta.sessionId, loadKey, turns, commits };
      this.postState();
    });
  }

  private async readTurns(meta: SessionMeta): Promise<PreviewTurn[]> {
    try {
      return recentConversation(transcriptTurns(await readTranscriptTail(meta.transcriptFile)));
    } catch {
      return [];
    }
  }

  private async readCommits(meta: SessionMeta): Promise<SessionCommit[]> {
    if (meta.commitHashes.length === 0) {
      return [];
    }
    const repoRoots = [meta.homeRepo, ...meta.otherReposTouched].filter((repoRoot): repoRoot is string => repoRoot !== undefined);
    const commitsByRepo = await Promise.all(
      repoRoots.map(async (repoRoot) =>
        (await this.dependencies.repoService.describeCommits(repoRoot, meta.commitHashes)).map((commit) => ({ commit, repoRoot })),
      ),
    );
    const commitsByHash = new Map(commitsByRepo.flat().map((sessionCommit) => [sessionCommit.commit.hash, sessionCommit]));
    return [...commitsByHash.values()]
      .sort((left, right) => right.commit.committedAtMs - left.commit.committedAtMs)
      .slice(0, MAX_PREVIEW_COMMITS);
  }

  dispose(): void {
    this.panel?.dispose();
    vscode.Disposable.from(...this.disposables).dispose();
    this.changeEmitter.dispose();
  }
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
  .secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  .secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
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
  .summary.empty .button { margin-top: 12px; }
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
  .commit-subject { font-size: 13px; line-height: 20px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .commit-repo { font-size: 12px; color: var(--vscode-descriptionForeground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .commit .icon-button { opacity: 0; }
  .commit:hover .icon-button, .commit:focus-within .icon-button { opacity: 1; }
  .cwd { font-family: var(--vscode-editor-font-family); font-size: 12px; line-height: 20px; overflow-wrap: anywhere; color: var(--vscode-textPreformat-foreground); }
  .sublabel { margin-top: 8px; font-size: 12px; color: var(--vscode-descriptionForeground); }
  .repos { list-style: none; margin: 4px 0 0; padding: 0; }
  .repos li { display: flex; align-items: center; gap: 8px; height: 24px; font-size: 13px; }
  .repos .codicon { font-size: 14px; color: var(--vscode-descriptionForeground); }
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

  function summarizeButton() {
    const button = element("button", "button secondary");
    button.type = "button";
    button.append(codicon("sparkle"), element("span", "", "Summarize with Haiku"));
    button.addEventListener("click", () => vscode.postMessage({ type: "summarize" }));
    return button;
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
      box.append(element("p", "", "No recap yet. Claude writes one when you step away, or Haiku can summarize the transcript now."));
      if (state.canSummarize) {
        box.append(summarizeButton());
      }
      container.replaceChildren(box);
      return;
    }
    const box = element("div", "summary");
    const caption = state.summary.caption + (state.summary.isStale ? " · the session moved on since" : "");
    box.append(element("p", "", state.summary.text), element("p", "caption", caption));
    container.replaceChildren(box);
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
    const container = byId("commits");
    byId("commits-section").hidden = state.commits !== undefined && state.commits.length === 0;
    byId("commit-count").hidden = state.commits === undefined;
    byId("commit-count").textContent = state.commits === undefined ? "" : String(state.commits.length);
    if (state.commits === undefined) {
      container.replaceChildren(element("p", "muted", "Looking up commits…"));
      return;
    }
    const list = element("ul", "commits");
    for (const commit of state.commits) {
      const item = element("li", "commit");
      const hashButton = element("button", "commit-hash", commit.shortHash);
      hashButton.type = "button";
      hashButton.title = "Show the commit";
      hashButton.addEventListener("click", () => vscode.postMessage({ type: "openCommit", hash: commit.hash }));
      const text = element("div");
      text.append(element("p", "commit-subject", commit.subject), element("p", "commit-repo", commit.repoName));
      text.firstChild.title = commit.subject;
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
    renderPrompts(state);
    renderCommits(state);
    renderWhere(state);
  });
  vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
}
