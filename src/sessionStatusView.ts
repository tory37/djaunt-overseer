import * as vscode from "vscode";
import { Registry } from "./registry";
import { MarkedStatus, parseSessionStatuses, SessionStatus, statusColorId, statusOfSession } from "./sessionStatuses";

const SESSION_STATUS_SCHEME = "overseer-session";
const STATUSES_SETTING = "sessionStatuses";

export function configuredStatuses(): SessionStatus[] {
  return parseSessionStatuses(vscode.workspace.getConfiguration("overseer").get<unknown>(STATUSES_SETTING));
}

export async function saveStatuses(statuses: SessionStatus[]): Promise<void> {
  await vscode.workspace.getConfiguration("overseer").update(STATUSES_SETTING, statuses, vscode.ConfigurationTarget.Global);
}

export function sessionStatusFor(registry: Registry, sessionId: string): MarkedStatus | undefined {
  const status = statusOfSession(sessionId, registry.sessionStatusIds(), configuredStatuses());
  return status && { ...status, reason: registry.sessionStatusReasons()[sessionId] };
}

// Tree rows carry this URI so the decoration below can tint the label and add the badge.
export function sessionStatusUri(sessionId: string): vscode.Uri {
  return vscode.Uri.from({ scheme: SESSION_STATUS_SCHEME, path: `/${sessionId}` });
}

export class SessionStatusDecorations implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly decorationChangeEmitter = new vscode.EventEmitter<vscode.Uri[]>();
  readonly onDidChangeFileDecorations = this.decorationChangeEmitter.event;
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly registry: Registry) {
    this.subscriptions = [
      registry.onDidChange(() => this.refresh()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`overseer.${STATUSES_SETTING}`)) {
          this.refresh();
        }
      }),
    ];
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== SESSION_STATUS_SCHEME) {
      return undefined;
    }
    const status = sessionStatusFor(this.registry, uri.path.slice(1));
    if (status === undefined) {
      return undefined;
    }
    const tooltip = status.reason ? `${status.name}: ${status.reason}` : status.name;
    return new vscode.FileDecoration(status.badge || undefined, tooltip, new vscode.ThemeColor(statusColorId(status.color)));
  }

  // A cleared status needs its old row repainted too, so every pinned row refreshes, not only those with a status.
  private refresh(): void {
    this.decorationChangeEmitter.fire(this.registry.pinnedSessionIds().map(sessionStatusUri));
  }

  dispose(): void {
    this.subscriptions.forEach((subscription) => subscription.dispose());
    this.decorationChangeEmitter.dispose();
  }
}

const CLEAR_STATUS_ID = "";

export async function pickSessionStatus(currentStatusIds: Set<string | undefined>): Promise<string | undefined | null> {
  const statuses = configuredStatuses();
  if (statuses.length === 0) {
    const choice = await vscode.window.showInformationMessage("Overseer: no statuses set up yet.", "Open Settings");
    if (choice !== undefined) {
      await vscode.commands.executeCommand("overseer.openStatusSettings");
    }
    return null;
  }
  const items = [
    ...statuses.map((status) => ({
      label: `$(${status.icon}) ${status.name}`,
      description: currentStatusIds.has(status.id) ? "current" : undefined,
      statusId: status.id,
    })),
    { label: "", kind: vscode.QuickPickItemKind.Separator, statusId: CLEAR_STATUS_ID },
    { label: "$(close) Clear Status", description: undefined, statusId: CLEAR_STATUS_ID },
  ];
  const picked = await vscode.window.showQuickPick(items, { placeHolder: "Set the session's status" });
  if (picked === undefined) {
    return null;
  }
  return picked.statusId === CLEAR_STATUS_ID ? undefined : picked.statusId;
}

// Returns the reason, "" for none, or undefined when the user cancels the whole change.
export async function askStatusReason(status: SessionStatus, currentReason: string | undefined): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: `Why is it ${status.name.toLowerCase()}?`,
    prompt: "Optional. It shows in the row's tooltip. Press Enter to skip.",
    value: currentReason,
  });
}
