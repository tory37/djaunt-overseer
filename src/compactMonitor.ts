import * as fs from "fs";
import * as vscode from "vscode";
import {
  ClaudeSettings,
  compactHookPaths,
  CompactHookPaths,
  compactingSessionIds,
  hasCompactHooks,
  hookScript,
  withCompactHooks,
  withoutCompactHooks,
} from "./compactHooks";
import { tildePath } from "./paths";

const PROMPT_DISMISSED_KEY = "overseer.compactHookPromptDismissed";
const INSTALL_CHOICE = "Install";
const NOT_NOW_CHOICE = "Not Now";
const NEVER_CHOICE = "Don't Ask Again";
// fs.watch can miss events on some file systems, and old markers must expire, so the folder is also polled.
const MARKER_POLL_INTERVAL_MS = 15_000;

// Watches the marker folder the compact hooks write, and reports which sessions are compacting.
export class CompactMonitor implements vscode.Disposable {
  private readonly paths: CompactHookPaths;
  private compactingIds = new Set<string>();
  private watcher: fs.FSWatcher | undefined;
  private readonly pollTimer: NodeJS.Timeout;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  constructor(claudeHome: string, private readonly log: vscode.OutputChannel) {
    this.paths = compactHookPaths(claudeHome);
    this.startWatching();
    this.rescan();
    this.pollTimer = setInterval(() => this.rescan(), MARKER_POLL_INTERVAL_MS);
  }

  isCompacting(sessionId: string): boolean {
    return this.compactingIds.has(sessionId);
  }

  private startWatching(): void {
    try {
      fs.mkdirSync(this.paths.markerDir, { recursive: true });
      this.watcher = fs.watch(this.paths.markerDir, () => this.rescan());
    } catch (error) {
      this.log.appendLine(`Can't watch ${this.paths.markerDir}: ${String(error)}`);
    }
  }

  private rescan(): void {
    const latestIds = compactingSessionIds(this.paths.markerDir, Date.now());
    const hasChanged =
      latestIds.size !== this.compactingIds.size || [...latestIds].some((sessionId) => !this.compactingIds.has(sessionId));
    this.compactingIds = latestIds;
    if (hasChanged) {
      this.changeEmitter.fire();
    }
  }

  dispose(): void {
    this.watcher?.close();
    clearInterval(this.pollTimer);
    this.changeEmitter.dispose();
  }
}

export function registerCompactHookCommands(
  context: vscode.ExtensionContext,
  claudeHome: string,
  log: vscode.OutputChannel,
): vscode.Disposable[] {
  const paths = compactHookPaths(claudeHome);
  void promptToInstall(context, paths, log);
  return [
    vscode.commands.registerCommand("overseer.installCompactHooks", () => installCompactHooks(paths, log)),
    vscode.commands.registerCommand("overseer.removeCompactHooks", () => removeCompactHooks(paths, log)),
  ];
}

async function promptToInstall(context: vscode.ExtensionContext, paths: CompactHookPaths, log: vscode.OutputChannel): Promise<void> {
  const settings = readSettings(paths.settingsFile);
  if (context.globalState.get<boolean>(PROMPT_DISMISSED_KEY) || settings === undefined || hasCompactHooks(settings)) {
    return;
  }
  const choice = await vscode.window.showInformationMessage(
    `Overseer can show when a session is compacting. It needs a PreCompact and a PostCompact hook in ${tildePath(paths.settingsFile)}.`,
    INSTALL_CHOICE,
    NOT_NOW_CHOICE,
    NEVER_CHOICE,
  );
  if (choice === INSTALL_CHOICE) {
    await installCompactHooks(paths, log);
  } else if (choice === NEVER_CHOICE) {
    await context.globalState.update(PROMPT_DISMISSED_KEY, true);
    void vscode.window.showInformationMessage("Run Overseer: Install Compact Hooks from the Command Palette any time.");
  }
}

async function installCompactHooks(paths: CompactHookPaths, log: vscode.OutputChannel): Promise<void> {
  const settings = readSettingsOrWarn(paths.settingsFile);
  if (settings === undefined) {
    return;
  }
  fs.mkdirSync(paths.markerDir, { recursive: true });
  fs.writeFileSync(paths.scriptFile, hookScript(paths.markerDir), { mode: 0o755 });
  writeSettings(paths.settingsFile, withCompactHooks(settings, paths.scriptFile));
  log.appendLine(`Installed compact hooks in ${paths.settingsFile}`);
  void vscode.window.showInformationMessage(
    `Overseer: compact hooks installed. Running sessions may need a restart to pick them up. Backup: ${tildePath(backupFile(paths.settingsFile))}`,
  );
}

async function removeCompactHooks(paths: CompactHookPaths, log: vscode.OutputChannel): Promise<void> {
  const settings = readSettingsOrWarn(paths.settingsFile);
  if (settings === undefined) {
    return;
  }
  if (!hasCompactHooks(settings)) {
    void vscode.window.showInformationMessage("Overseer: no compact hooks to remove.");
    return;
  }
  writeSettings(paths.settingsFile, withoutCompactHooks(settings));
  fs.rmSync(paths.scriptFile, { force: true });
  log.appendLine(`Removed compact hooks from ${paths.settingsFile}`);
  void vscode.window.showInformationMessage("Overseer: compact hooks removed.");
}

// A missing file is an empty one; a file that isn't valid JSON is never overwritten.
function readSettings(settingsFile: string): ClaudeSettings | undefined {
  let settingsText: string;
  try {
    settingsText = fs.readFileSync(settingsFile, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(settingsText);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as ClaudeSettings) : undefined;
  } catch {
    return undefined;
  }
}

function readSettingsOrWarn(settingsFile: string): ClaudeSettings | undefined {
  const settings = readSettings(settingsFile);
  if (settings === undefined) {
    void vscode.window.showErrorMessage(`Overseer: ${tildePath(settingsFile)} isn't a JSON object, so Overseer won't edit it.`);
  }
  return settings;
}

function writeSettings(settingsFile: string, settings: ClaudeSettings): void {
  if (fs.existsSync(settingsFile)) {
    fs.copyFileSync(settingsFile, backupFile(settingsFile));
  }
  fs.writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
}

function backupFile(settingsFile: string): string {
  return `${settingsFile}.overseer-backup`;
}
