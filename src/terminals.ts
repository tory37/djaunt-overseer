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
// A terminal whose session changed under it is also here, and this entry wins over its stale env.
const adoptedTerminalSessionIds = new WeakMap<vscode.Terminal, string>();

export function sessionIdOfTerminal(terminal: vscode.Terminal): string | undefined {
  const creationOptions = terminal.creationOptions as vscode.TerminalOptions;
  return adoptedTerminalSessionIds.get(terminal) ?? creationOptions.env?.[SESSION_ID_ENV_VAR] ?? undefined;
}

export function findSessionTerminal(sessionId: string): vscode.Terminal | undefined {
  return vscode.window.terminals.find((terminal) => sessionIdOfTerminal(terminal) === sessionId);
}

// Overseer terminals exec claude directly, so the terminal's process ID is Claude's own pid.
// A plain shell has no Claude pid, so its pid is saved at launch and matched here.
export async function adoptTerminalsByPid(
  liveSessions: Map<string, LiveSession>,
  shellPidsBySessionId: Record<string, number | undefined>,
): Promise<boolean> {
  const sessionIdsByPid = new Map<number, string>();
  for (const liveSession of liveSessions.values()) {
    if (liveSession.pid !== undefined) {
      sessionIdsByPid.set(liveSession.pid, liveSession.sessionId);
    }
  }
  for (const [sessionId, shellPid] of Object.entries(shellPidsBySessionId)) {
    if (shellPid !== undefined) {
      sessionIdsByPid.set(shellPid, sessionId);
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

export interface SessionSwitch {
  fromSessionId: string;
  toSessionId: string;
}

// /clear and /resume start a new session in the same Claude process, so the terminal follows its pid to the new session.
export async function followSwitchedSessions(liveSessions: Map<string, LiveSession>): Promise<SessionSwitch[]> {
  const sessionIdsByPid = new Map<number, string>();
  for (const liveSession of liveSessions.values()) {
    if (liveSession.pid !== undefined) {
      sessionIdsByPid.set(liveSession.pid, liveSession.sessionId);
    }
  }
  const sessionSwitches: SessionSwitch[] = [];
  for (const terminal of vscode.window.terminals) {
    const fromSessionId = sessionIdOfTerminal(terminal);
    const terminalPid = await terminal.processId;
    const toSessionId = terminalPid === undefined ? undefined : sessionIdsByPid.get(terminalPid);
    if (fromSessionId !== undefined && toSessionId !== undefined && toSessionId !== fromSessionId) {
      adoptedTerminalSessionIds.set(terminal, toSessionId);
      sessionSwitches.push({ fromSessionId, toSessionId });
    }
  }
  return sessionSwitches;
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

// Uses the user's default terminal profile, so it is the same shell as any other VS Code terminal.
export function openShellTerminal(sessionId: string, title: string, cwd: string, log: vscode.OutputChannel): vscode.Terminal | undefined {
  const openTerminal = findSessionTerminal(sessionId);
  if (openTerminal) {
    openTerminal.show();
    return openTerminal;
  }
  if (!fs.existsSync(cwd)) {
    void vscode.window.showErrorMessage(`Overseer: ${cwd} no longer exists, so the terminal can't open there.`);
    return undefined;
  }
  log.appendLine(`Opening terminal ${sessionId} in ${cwd}`);
  const terminal = vscode.window.createTerminal({
    name: title,
    cwd,
    env: { [SESSION_ID_ENV_VAR]: sessionId },
    location: vscode.TerminalLocation.Editor,
    iconPath: new vscode.ThemeIcon("terminal-bash"),
  });
  terminal.show();
  return terminal;
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
  let closeListener: vscode.Disposable | undefined;
  let timeoutHandle: NodeJS.Timeout | undefined;
  const terminalClosed = new Promise<void>((resolve) => {
    closeListener = vscode.window.onDidCloseTerminal((closedTerminal) => {
      if (closedTerminal === terminal) {
        resolve();
      }
    });
  });
  const timedOut = new Promise<"timeout">((resolve) => {
    timeoutHandle = setTimeout(() => resolve("timeout"), SUSPEND_TIMEOUT_MS);
  });
  sendSlashCommand(terminal, "/exit");
  try {
    if ((await Promise.race([terminalClosed, timedOut])) === "timeout") {
      terminal.dispose();
    }
  } finally {
    closeListener?.dispose();
    clearTimeout(timeoutHandle);
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
