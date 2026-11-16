import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { LiveSession, LiveStatus, parseAgentsJson } from "./liveParse";
import { executableNames, loginShellLookupCommand, resolveLoginShell } from "./loginShell";

const POLL_INTERVAL_MS = 15_000;
const WATCH_DEBOUNCE_MS = 300;
const COMMAND_TIMEOUT_MS = 10_000;

export class LiveSessionMonitor implements vscode.Disposable {
  private liveSessions = new Map<string, LiveSession>();
  private claudeBinary: string | undefined;
  private refreshInFlight: Promise<Map<string, LiveSession>> | undefined;
  private sessionsDirWatcher: fs.FSWatcher | undefined;
  private watchDebounceTimer: NodeJS.Timeout | undefined;
  private readonly pollTimer: NodeJS.Timeout;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  constructor(
    claudeHome: string,
    private readonly log: vscode.OutputChannel,
  ) {
    this.pollTimer = setInterval(() => void this.refresh(), POLL_INTERVAL_MS);
    this.watchSessionsDir(path.join(claudeHome, "sessions"));
  }

  get(sessionId: string): LiveSession | undefined {
    return this.liveSessions.get(sessionId);
  }

  statuses(): Map<string, LiveStatus> {
    return new Map([...this.liveSessions].map(([sessionId, liveSession]) => [sessionId, liveSession.status]));
  }

  refresh(): Promise<Map<string, LiveSession>> {
    this.refreshInFlight ??= this.runRefresh().finally(() => {
      this.refreshInFlight = undefined;
    });
    return this.refreshInFlight;
  }

  private async runRefresh(): Promise<Map<string, LiveSession>> {
    try {
      const agentsJson = await this.runClaude(["agents", "--json"]);
      const refreshedSessions = parseAgentsJson(agentsJson);
      if (!sameLiveSessions(this.liveSessions, refreshedSessions)) {
        this.liveSessions = refreshedSessions;
        this.changeEmitter.fire();
      }
    } catch (error) {
      this.log.appendLine(`Live session refresh failed: ${String(error)}`);
    }
    return this.liveSessions;
  }

  // Claude rewrites sessions/<pid>.json on every busy/idle flip, so the directory is a cheap change signal.
  private watchSessionsDir(sessionsDir: string): void {
    try {
      this.sessionsDirWatcher = fs.watch(sessionsDir, () => {
        clearTimeout(this.watchDebounceTimer);
        this.watchDebounceTimer = setTimeout(() => void this.refresh(), WATCH_DEBOUNCE_MS);
      });
    } catch (error) {
      this.log.appendLine(`Can't watch ${sessionsDir}, polling only: ${String(error)}`);
    }
  }

  private async runClaude(claudeArgs: string[]): Promise<string> {
    this.claudeBinary ??= await resolveClaudeBinary();
    return execFileText(this.claudeBinary, claudeArgs);
  }

  dispose(): void {
    clearInterval(this.pollTimer);
    clearTimeout(this.watchDebounceTimer);
    this.sessionsDirWatcher?.close();
    this.changeEmitter.dispose();
  }
}

export function resolveClaudeBinary(): Promise<string> {
  return resolveCliBinary("claude");
}

// VS Code's own PATH can miss version-manager installs like nvm, so ask the user's login shell.
export async function resolveCliBinary(binaryName: string): Promise<string> {
  const pathMatch = await findOnPath(binaryName);
  if (pathMatch !== undefined) {
    // Windows cannot run a bare "claude" without its extension, so it gets the full path.
    return process.platform === "win32" ? pathMatch : binaryName;
  }
  const userShell = resolveLoginShell(process.platform, process.env, fs.existsSync);
  if (userShell === undefined) {
    throw new Error(`${binaryName} not found on PATH, and Git Bash is not installed to look further`);
  }
  const resolvedPath = (await execFileText(userShell, ["-l", "-i", "-c", loginShellLookupCommand(binaryName, process.platform)]))
    .trim()
    .split(/\r?\n/)
    .pop();
  if (!resolvedPath) {
    throw new Error(`${binaryName} not found on PATH or in the login shell`);
  }
  return resolvedPath;
}

async function findOnPath(binaryName: string): Promise<string | undefined> {
  const pathDirectories = (process.env.PATH ?? "").split(path.delimiter).filter((directory) => directory !== "");
  const fileNames = executableNames(binaryName, process.platform, process.env);
  for (const directory of pathDirectories) {
    for (const fileName of fileNames) {
      const candidate = path.join(directory, fileName);
      const isExecutable = await fs.promises
        .access(candidate, fs.constants.X_OK)
        .then(() => true)
        .catch(() => false);
      if (isExecutable) {
        return candidate;
      }
    }
  }
  return undefined;
}

function execFileText(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout);
      }
    });
  });
}

function sameLiveSessions(left: Map<string, LiveSession>, right: Map<string, LiveSession>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const [sessionId, leftSession] of left) {
    const rightSession = right.get(sessionId);
    if (rightSession === undefined || rightSession.status !== leftSession.status ||
      rightSession.pid !== leftSession.pid ||
      rightSession.processCount !== leftSession.processCount) {
      return false;
    }
  }
  return true;
}
