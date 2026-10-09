import * as fs from "fs";
import * as vscode from "vscode";
import { displayTitle, SessionMeta } from "./indexer";

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FALLBACK_SHELL = "/bin/zsh";
export const SESSION_ID_ENV_VAR = "OVERSEER_SESSION_ID";

export function resumeSession(meta: SessionMeta, log: vscode.OutputChannel): vscode.Terminal | undefined {
  if (!SESSION_ID_PATTERN.test(meta.sessionId)) {
    void vscode.window.showErrorMessage(`Overseer: "${meta.sessionId}" is not a session ID Claude can resume.`);
    return undefined;
  }
  if (meta.resumeCwd === undefined) {
    void vscode.window.showErrorMessage(
      `Overseer: can't tell which directory "${displayTitle(meta)}" belongs to. Its transcript is ${meta.transcriptFile}.`,
    );
    return undefined;
  }
  if (!fs.existsSync(meta.resumeCwd)) {
    void vscode.window.showErrorMessage(
      `Overseer: ${meta.resumeCwd} no longer exists (a removed worktree?), so Claude can't resume this session there.`,
    );
    return undefined;
  }

  log.appendLine(`Resuming ${meta.sessionId} in ${meta.resumeCwd}`);
  return launchClaudeTerminal(displayTitle(meta), meta.resumeCwd, meta.sessionId, `claude --resume ${meta.sessionId}`);
}

// Claude runs as the shell's own command, so /exit ends the process and VS Code closes the tab.
function launchClaudeTerminal(title: string, cwd: string, sessionId: string, claudeCommand: string): vscode.Terminal {
  const terminal = vscode.window.createTerminal({
    name: title,
    cwd,
    shellPath: process.env.SHELL ?? FALLBACK_SHELL,
    shellArgs: ["-l", "-i", "-c", `exec ${claudeCommand}`],
    env: { [SESSION_ID_ENV_VAR]: sessionId },
    location: vscode.TerminalLocation.Editor,
    iconPath: new vscode.ThemeIcon("terminal"),
  });
  terminal.show();
  return terminal;
}
