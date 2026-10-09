import * as vscode from "vscode";
import { defaultClaudeHome } from "./paths";
import { pickSession } from "./quickPick";
import { SessionIndex } from "./sessionIndex";
import { resumeSession } from "./terminals";

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel("Overseer");
  const configuredClaudeHome = vscode.workspace.getConfiguration("overseer").get<string>("claudeHome");
  const claudeHome = configuredClaudeHome || defaultClaudeHome();
  const sessionIndex = new SessionIndex(claudeHome, context.globalStorageUri.fsPath, log);

  context.subscriptions.push(
    log,
    sessionIndex,
    vscode.commands.registerCommand("overseer.allSessions", async () => {
      const pickedSession = await pickSession(sessionIndex);
      if (pickedSession) {
        resumeSession(pickedSession, log);
      }
    }),
    vscode.commands.registerCommand("overseer.refreshIndex", () => sessionIndex.refresh()),
  );

  void sessionIndex.refresh();
}

export function deactivate(): void {}
