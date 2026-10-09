import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel("Overseer");
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine("Overseer activated");
}

export function deactivate(): void {}
