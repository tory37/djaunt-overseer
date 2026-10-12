import * as vscode from "vscode";

// The integrated browser arrived in newer VS Code; Simple Browser covers older builds.
const VSCODE_BROWSER_COMMANDS = ["workbench.action.browser.open", "simpleBrowser.show"];

// VS Code exposes no way to find an open browser tab by URL, so this always opens a new tab.
export async function openInVscode(url: string): Promise<void> {
  const availableCommands = new Set(await vscode.commands.getCommands(true));
  const browserCommand = VSCODE_BROWSER_COMMANDS.find((command) => availableCommands.has(command));
  if (browserCommand === undefined) {
    await openInBrowser(url);
    return;
  }
  await vscode.commands.executeCommand(browserCommand, url);
}

export async function openInBrowser(url: string): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(url));
}
