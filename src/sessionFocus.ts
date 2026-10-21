import * as vscode from "vscode";
import { isSameSessionFocus, nextSessionFocus, SessionFocus, SessionFocusEvent } from "./sessionFocusState";
import { sessionIdOfTerminal } from "./terminals";

// Follows the session of the active tab. A webview tab doesn't change activeTerminal, so tabs are watched too.
export class SessionFocusTracker implements vscode.Disposable {
  private focus: SessionFocus | undefined;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.focus = nextSessionFocus(undefined, terminalEvent(vscode.window.activeTerminal));
    this.disposables.push(
      vscode.window.onDidChangeActiveTerminal((terminal) => this.apply(terminalEvent(terminal))),
      vscode.window.tabGroups.onDidChangeTabs(() => this.applyActiveTab()),
      vscode.window.tabGroups.onDidChangeTabGroups(() => this.applyActiveTab()),
    );
  }

  focusedSessionId(): string | undefined {
    return this.focus?.sessionId;
  }

  private applyActiveTab(): void {
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (activeTab?.input instanceof vscode.TabInputTerminal) {
      this.apply(terminalEvent(vscode.window.activeTerminal));
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
  return { kind: "terminal", sessionId: terminal === undefined ? undefined : sessionIdOfTerminal(terminal) };
}
