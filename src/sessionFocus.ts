import * as vscode from "vscode";
import { isSameSessionFocus, nextSessionFocus, SessionFocus, SessionFocusEvent, SessionFocusSource } from "./sessionFocusState";
import { SESSION_PREVIEW_VIEW_TYPE } from "./sessionPreview";
import { sessionIdOfTerminal } from "./terminals";

export interface PreviewTab {
  sessionId(): string | undefined;
  readonly onDidChange: vscode.Event<void>;
}

// Follows the session of the active tab. A webview tab doesn't change activeTerminal, so tabs are watched too.
export class SessionFocusTracker implements vscode.Disposable {
  private focus: SessionFocus | undefined;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly preview: PreviewTab) {
    this.focus = nextSessionFocus(undefined, terminalEvent(vscode.window.activeTerminal));
    this.disposables.push(
      vscode.window.onDidChangeActiveTerminal((terminal) => this.apply(terminalEvent(terminal))),
      vscode.window.tabGroups.onDidChangeTabs(() => this.applyActiveTab()),
      vscode.window.tabGroups.onDidChangeTabGroups(() => this.applyActiveTab()),
      preview.onDidChange(() => this.applyPreviewChange()),
    );
  }

  focusedSessionId(): string | undefined {
    return this.focus?.sessionId;
  }

  focusSource(): SessionFocusSource | undefined {
    return this.focus?.source;
  }

  private applyPreviewChange(): void {
    if (this.preview.sessionId() === undefined) {
      this.apply({ kind: "previewClosed", terminalSessionId: terminalSessionId(vscode.window.activeTerminal) });
      return;
    }
    this.applyActiveTab();
  }

  private applyActiveTab(): void {
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (activeTab?.input instanceof vscode.TabInputTerminal) {
      this.apply(terminalEvent(vscode.window.activeTerminal));
      return;
    }
    const previewSessionId = this.preview.sessionId();
    const isPreviewTab = activeTab?.input instanceof vscode.TabInputWebview && activeTab.input.viewType.endsWith(SESSION_PREVIEW_VIEW_TYPE);
    if (isPreviewTab && previewSessionId !== undefined) {
      this.apply({ kind: "preview", sessionId: previewSessionId });
      return;
    }
    this.apply({ kind: "otherTab" });
  }

  private apply(event: SessionFocusEvent): void {
    const nextFocus = nextSessionFocus(this.focus, event);
    if (isSameSessionFocus(this.focus, nextFocus)) {
      return;
    }
    this.focus = nextFocus;
    this.changeEmitter.fire();
  }

  dispose(): void {
    vscode.Disposable.from(...this.disposables).dispose();
    this.changeEmitter.dispose();
  }
}

function terminalEvent(terminal: vscode.Terminal | undefined): SessionFocusEvent {
  return { kind: "terminal", sessionId: terminalSessionId(terminal) };
}

function terminalSessionId(terminal: vscode.Terminal | undefined): string | undefined {
  return terminal === undefined ? undefined : sessionIdOfTerminal(terminal);
}
