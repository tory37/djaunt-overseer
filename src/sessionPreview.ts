import * as crypto from "crypto";
import * as vscode from "vscode";
import { formatAge } from "./format";
import { SessionMeta } from "./indexer";
import { LiveSessionMonitor } from "./liveSessions";
import { Registry } from "./registry";
import { sessionSubtitle } from "./resourcesPanel";
import { PreviewRunState, previewRunState, previewTabTitle } from "./sessionPreviewModel";

export const SESSION_PREVIEW_VIEW_TYPE = "overseer.sessionPreview";

export interface SessionPreviewDependencies {
  extensionUri: vscode.Uri;
  registry: Registry;
  liveMonitor: LiveSessionMonitor;
  findSessionMeta: (sessionId: string) => SessionMeta | undefined;
  sessionTitle: (sessionId: string) => string;
}

interface PreviewState extends PreviewRunState {
  title: string;
  lastActive: string | undefined;
  place: string;
}

type PreviewMessage = { type: "ready" } | { type: "resume" };

// One reused editor tab for sessions with no terminal here. Showing another session repopulates it.
export class SessionPreview implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private shownSessionId: string | undefined;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly dependencies: SessionPreviewDependencies) {
    const postState = (): void => this.postState();
    this.disposables.push(dependencies.registry.onDidChange(postState), dependencies.liveMonitor.onDidChange(postState));
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
    switch (message.type) {
      case "ready":
        this.postState();
        return;
      case "resume":
        if (this.shownSessionId !== undefined) {
          await vscode.commands.executeCommand("overseer.openSessionById", this.shownSessionId);
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
    const { liveMonitor, findSessionMeta, sessionTitle } = this.dependencies;
    const meta = findSessionMeta(sessionId);
    return {
      title: sessionTitle(sessionId),
      lastActive: meta === undefined ? undefined : formatAge(meta.lastActivityMs),
      place: meta === undefined ? "" : sessionSubtitle(meta),
      ...previewRunState(liveMonitor.get(sessionId)),
    };
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
  :focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
  header {
    position: sticky;
    top: 0;
    display: flex;
    align-items: flex-start;
    gap: 16px;
    padding: 20px 24px 16px;
    background: var(--vscode-editor-background);
    border-bottom: 1px solid var(--vscode-panel-border, transparent);
  }
  .heading { flex: 1; min-width: 0; }
  h1 { margin: 0; font-size: 18px; font-weight: 600; line-height: 28px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; margin: 4px 0 0; font-size: 12px; color: var(--vscode-descriptionForeground); }
  .meta-item { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
  .meta-item .codicon { font-size: 12px; }
  .elsewhere { color: var(--vscode-charts-orange); }
  .resume {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 12px;
    border: none;
    border-radius: 2px;
    font: inherit;
    font-size: 13px;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    cursor: pointer;
    transition: background-color 75ms;
  }
  .resume:hover { background: var(--vscode-button-hoverBackground); }
  .resume .codicon { font-size: 14px; }
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
  <button type="button" class="resume" id="resume"><span class="codicon" id="resume-icon"></span><span id="resume-label"></span></button>
</header>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const byId = (elementId) => document.getElementById(elementId);

  function render(state) {
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

  byId("resume").addEventListener("click", () => vscode.postMessage({ type: "resume" }));
  window.addEventListener("message", (event) => {
    if (event.data.type === "state") {
      render(event.data.state);
    }
  });
  vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
}
