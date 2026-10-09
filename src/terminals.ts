import * as fs from "fs";
import * as vscode from "vscode";
import { displayTitle, SessionMeta } from "./indexer";
import { LiveSession } from "./liveParse";

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FALLBACK_SHELL = "/bin/zsh";
const SUSPEND_TIMEOUT_MS = 8_000;
const CLEAR_INPUT_LINE = "\x15";
export const SESSION_ID_ENV_VAR = "OVERSEER_SESSION_ID";

// Terminals revived after a window reload can lose their env, so they are matched to sessions by pid instead.
const adoptedTerminalSessionIds = new WeakMap<vscode.Terminal, string>();

export function sessionIdOfTerminal(terminal: vscode.Terminal): string | undefined {
  const creationOptions = terminal.creationOptions as vscode.TerminalOptions;
  return creationOptions.env?.[SESSION_ID_ENV_VAR] ?? adoptedTerminalSessionIds.get(terminal);
}

export function findSessionTerminal(sessionId: string): vscode.Terminal | undefined {
  return vscode.window.terminals.find((terminal) => sessionIdOfTerminal(terminal) === sessionId);
}

// Overseer terminals exec claude directly, so the terminal's process ID is Claude's own pid.
export async function adoptTerminalsByPid(liveSessions: Map<string, LiveSession>): Promise<boolean> {
  const sessionIdsByPid = new Map<number, string>();
  for (const liveSession of liveSessions.values()) {
    if (liveSession.pid !== undefined) {
      sessionIdsByPid.set(liveSession.pid, liveSession.sessionId);
    }
  }
  let adoptedAny = false;
  for (const terminal of vscode.window.terminals) {
    if (sessionIdOfTerminal(terminal) !== undefined) {
      continue;
    }
    const terminalPid = await terminal.processId;
    const matchedSessionId = terminalPid === undefined ? undefined : sessionIdsByPid.get(terminalPid);
    if (matchedSessionId !== undefined) {
      adoptedTerminalSessionIds.set(terminal, matchedSessionId);
      adoptedAny = true;
    }
  }
  return adoptedAny;
}

export function resumeSession(
  meta: SessionMeta,
  log: vscode.OutputChannel,
  forkSessionId?: string,
): vscode.Terminal | undefined {
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

  if (forkSessionId !== undefined) {
    log.appendLine(`Forking ${meta.sessionId} as ${forkSessionId} in ${meta.resumeCwd}`);
    return launchClaudeTerminal(
      `${displayTitle(meta)} (fork)`,
      meta.resumeCwd,
      forkSessionId,
      `claude --resume ${meta.sessionId} --fork-session --session-id ${forkSessionId}`,
    );
  }

  const openTerminal = findSessionTerminal(meta.sessionId);
  if (openTerminal) {
    openTerminal.show();
    return openTerminal;
  }

  log.appendLine(`Resuming ${meta.sessionId} in ${meta.resumeCwd}`);
  return launchClaudeTerminal(displayTitle(meta), meta.resumeCwd, meta.sessionId, `claude --resume ${meta.sessionId}`);
}

export function startNewSession(
  sessionId: string,
  sessionName: string | undefined,
  cwd: string,
  log: vscode.OutputChannel,
): vscode.Terminal {
  const nameArgument = sessionName === undefined ? "" : ` -n ${quoteForShell(sessionName)}`;
  log.appendLine(`Starting new session ${sessionId} in ${cwd}`);
  return launchClaudeTerminal(sessionName ?? "New session", cwd, sessionId, `claude --session-id ${sessionId}${nameArgument}`);
}

export function attachBackgroundSession(
  meta: SessionMeta,
  agentId: string,
  log: vscode.OutputChannel,
): vscode.Terminal | undefined {
  if (!/^[0-9a-zA-Z-]+$/.test(agentId)) {
    void vscode.window.showErrorMessage(`Overseer: "${agentId}" is not an agent ID Claude can attach to.`);
    return undefined;
  }
  log.appendLine(`Attaching background agent ${agentId} (${meta.sessionId})`);
  const attachCwd = meta.resumeCwd !== undefined && fs.existsSync(meta.resumeCwd) ? meta.resumeCwd : meta.startCwd;
  return launchClaudeTerminal(displayTitle(meta), attachCwd, meta.sessionId, `claude attach ${agentId}`);
}

// Clears any half-typed draft first so the slash command isn't appended to it and sent as a prompt.
export function sendSlashCommand(terminal: vscode.Terminal, slashCommand: string): void {
  terminal.sendText(CLEAR_INPUT_LINE, false);
  terminal.sendText(slashCommand, true);
}

// /exit lets Claude shut down cleanly; if the tab is still open after the timeout, close it, which ends the process.
export async function suspendTerminal(terminal: vscode.Terminal): Promise<void> {
  const terminalClosed = new Promise<void>((resolve) => {
    const closeListener = vscode.window.onDidCloseTerminal((closedTerminal) => {
      if (closedTerminal === terminal) {
        closeListener.dispose();
        resolve();
      }
    });
  });
  sendSlashCommand(terminal, "/exit");
  const timedOut = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), SUSPEND_TIMEOUT_MS));
  if ((await Promise.race([terminalClosed, timedOut])) === "timeout") {
    terminal.dispose();
  }
}

function quoteForShell(text: string): string {
  const singleLine = text.replace(/[\r\n]+/g, " ");
  return `'${singleLine.replace(/'/g, `'\\''`)}'`;
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
