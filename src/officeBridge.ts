import * as crypto from "crypto";
import * as vscode from "vscode";
import type { PinnedSession } from "./grouping";
import type { LiveSessionMonitor } from "./liveSessions";
import { officeAgents } from "./officeAgents";
import { MOVED_OFFICE_SETTINGS, settingsToMove } from "./officeSettingsMigration";
import type { OfficeLook, OfficeSimulationApi } from "./officeSimulationApi";
import type { Registry } from "./registry";
import type { SceneEventDirector } from "./sceneEvents";

export const OFFICE_EXTENSION_ID = "djaunt.office-simulation";
export const OFFICE_PANEL_VIEW_ID = "overseer.office";
const OFFICE_RELEASES_URL = "https://github.com/tory37/vscode-office-simulation/releases/latest";
const SLEEPERS_SETTING = "overseer.office.sleepers";
// Set when the old overseer.office.* settings have been copied to officeSim.*.
const MIGRATED_KEY = "overseer.officeSettingsMoved";
// True while the Office Simulation extension is hooked in; the Pixel Guy menu needs it.
const CONNECTED_CONTEXT = "overseer.officeConnected";

export interface OfficeBridgeDeps {
  liveMonitor: LiveSessionMonitor;
  registry: Registry;
  pinnedSessions: () => PinnedSession[];
  sessionTitle: (sessionId: string) => string;
  sceneEvents: SceneEventDirector;
  focusedSessionId: () => string | undefined;
  onDidChangeFocus: vscode.Event<void>;
  globalState: vscode.Memento;
}

// Overseer's side of the Office, which is its own extension now (Office Simulation). Overseer is a host: it sends a
// worker for each pinned Claude session, plays its scene events and Core's tint there, opens a session when its guy
// is clicked, and draws the Office in its own sidebar view. Without the extension the view offers to install it, and
// the session rows keep their codicons. It hooks in whenever the extension shows up, without a reload.
export class OfficeBridge implements vscode.WebviewViewProvider, vscode.Disposable {
  private office: OfficeSimulationApi | undefined;
  private connecting: Promise<void> | undefined;
  private readonly views = new Map<vscode.WebviewView, vscode.Disposable | undefined>();
  private readonly listeners: vscode.Disposable[];
  private officeListeners: vscode.Disposable[] = [];
  private readonly connectEmitter = new vscode.EventEmitter<void>();
  // The Office hooked in (or went away).
  readonly onDidChangeConnection = this.connectEmitter.event;

  constructor(private readonly deps: OfficeBridgeDeps) {
    this.listeners = [
      deps.liveMonitor.onDidChange(() => this.refresh()),
      deps.registry.onDidChange(() => this.refresh()),
      deps.onDidChangeFocus(() => this.refresh()),
      vscode.workspace.onDidChangeConfiguration((change) => {
        if (change.affectsConfiguration(SLEEPERS_SETTING)) {
          this.refresh();
        }
      }),
      vscode.extensions.onDidChange(() => void this.connect()),
    ];
    void this.connect();
  }

  get api(): OfficeSimulationApi | undefined {
    return this.office;
  }

  // Sends the workers again: titles come from the analyzer and the index on their own schedule.
  refresh(): void {
    this.office?.setAgents(officeAgents({
      pinned: this.deps.pinnedSessions(),
      liveStatus: (sessionId) => {
        const live = this.deps.liveMonitor.get(sessionId);
        return live === undefined ? undefined : live.status === "idle" ? "idle" : "busy";
      },
      showSleepers: vscode.workspace.getConfiguration().get<boolean>(SLEEPERS_SETTING, true),
      seed: (sessionId) => this.deps.registry.avatarSeed(sessionId),
      look: (sessionId) => this.deps.registry.avatarLook(sessionId),
      title: this.deps.sessionTitle,
      focusedId: this.deps.focusedSessionId(),
    }));
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.views.set(webviewView, undefined);
    webviewView.onDidDispose(() => {
      this.views.get(webviewView)?.dispose();
      this.views.delete(webviewView);
    });
    if (this.office !== undefined) {
      this.views.set(webviewView, this.office.attachView(webviewView));
    } else {
      this.showInstall(webviewView);
    }
  }

  // Runs an Office command, or offers to install the Office when it's missing.
  async runOfficeCommand(command: string, ...args: unknown[]): Promise<void> {
    await this.connect();
    if (this.office === undefined) {
      await offerInstall();
      return;
    }
    await vscode.commands.executeCommand(command, ...args);
  }

  // Opens the character maker on a session's guy and saves the look to the registry.
  async customize(sessionId: string): Promise<void> {
    await this.connect();
    const office = this.office;
    if (office === undefined) {
      await offerInstall();
      return;
    }
    const saved = this.deps.registry.avatarLook(sessionId);
    const start = saved !== null && typeof saved === "object" ? (saved as OfficeLook) : office.lookFromSeed(this.deps.registry.avatarSeed(sessionId));
    const look = await office.editLook(start, `Customize ${this.deps.sessionTitle(sessionId)}`);
    if (look !== undefined) {
      await this.deps.registry.setAvatarLook(sessionId, look);
    }
  }

  async reroll(sessionId: string): Promise<void> {
    await this.deps.registry.setAvatarLook(sessionId, undefined);
    await this.deps.registry.setAvatarSeed(sessionId, crypto.randomBytes(8).toString("hex"));
  }

  async reset(sessionId: string): Promise<void> {
    await this.deps.registry.setAvatarLook(sessionId, undefined);
    await this.deps.registry.setAvatarSeed(sessionId, sessionId);
  }

  // Only the race changes. A custom look keeps everything else; the Office fills in the race's marks.
  async pickRace(sessionId: string): Promise<void> {
    await this.connect();
    const office = this.office;
    if (office === undefined) {
      await offerInstall();
      return;
    }
    const seed = this.deps.registry.avatarSeed(sessionId);
    const saved = this.deps.registry.avatarLook(sessionId) as OfficeLook | undefined;
    const current = saved !== undefined ? (saved.race ?? "human") : office.raceOfSeed(seed);
    const picked = await vscode.window.showQuickPick(
      office.races().map((race) => ({ label: race.id === current ? `$(check) ${race.label}` : race.label, id: race.id })),
      { placeHolder: "Race for this session's pixel guy" },
    );
    if (picked === undefined) {
      return;
    }
    if (saved !== undefined) {
      const { marks: _marks, ...rest } = saved;
      await this.deps.registry.setAvatarLook(sessionId, { ...rest, race: picked.id });
    } else {
      await this.deps.registry.setAvatarSeed(sessionId, office.seedWithRace(seed, picked.id));
    }
  }

  dispose(): void {
    this.listeners.forEach((listener) => listener.dispose());
    this.officeListeners.forEach((listener) => listener.dispose());
    this.views.forEach((attachment) => attachment?.dispose());
    this.connectEmitter.dispose();
  }

  private connect(): Promise<void> {
    const extension = vscode.extensions.getExtension<OfficeSimulationApi>(OFFICE_EXTENSION_ID);
    if (extension === undefined) {
      if (this.office !== undefined) {
        this.disconnect();
      }
      return Promise.resolve();
    }
    if (this.office !== undefined) {
      return Promise.resolve();
    }
    this.connecting ??= (async () => {
      try {
        const api = extension.isActive ? extension.exports : await extension.activate();
        if (api?.apiVersion === 1) {
          await this.moveSettings();
          this.hookIn(api);
        }
      } catch {
        // The Office failed to start: carry on without it.
      } finally {
        this.connecting = undefined;
      }
    })();
    return this.connecting;
  }

  private hookIn(office: OfficeSimulationApi): void {
    this.office = office;
    const events = this.deps.sceneEvents;
    office.takeOverEvents();
    office.setTint(events.currentTint(), false);
    this.officeListeners = [
      events.onDidPlay((message) => office.playEvent(message.kind, message.variant)),
      events.onDidTint((index) => office.setTint(index)),
      office.onDidClickAgent((id) => {
        if (id !== "you") {
          void vscode.commands.executeCommand("overseer.clickSession", id);
        }
      }),
      office.onDidOpenView(() => this.refresh()),
    ];
    for (const view of this.views.keys()) {
      this.views.set(view, office.attachView(view));
    }
    this.refresh();
    void vscode.commands.executeCommand("setContext", CONNECTED_CONTEXT, true);
    this.connectEmitter.fire();
  }

  private disconnect(): void {
    this.office = undefined;
    this.officeListeners.forEach((listener) => listener.dispose());
    this.officeListeners = [];
    for (const [view, attachment] of this.views) {
      attachment?.dispose();
      this.views.set(view, undefined);
      this.showInstall(view);
    }
    void vscode.commands.executeCommand("setContext", CONNECTED_CONTEXT, false);
    this.connectEmitter.fire();
  }

  // Copies the overseer.office.* settings you set to officeSim.*, once.
  private async moveSettings(): Promise<void> {
    if (this.deps.globalState.get<boolean>(MIGRATED_KEY, false)) {
      return;
    }
    const configuration = vscode.workspace.getConfiguration();
    const moves = settingsToMove((name: (typeof MOVED_OFFICE_SETTINGS)[number]) => ({
      old: configuration.inspect(`overseer.office.${name}`)?.globalValue,
      current: configuration.inspect(`officeSim.${name}`)?.globalValue,
    }));
    for (const move of moves) {
      try {
        await configuration.update(move.key, move.value, vscode.ConfigurationTarget.Global);
      } catch {
        // A value the Office no longer takes stays behind.
      }
    }
    await this.deps.globalState.update(MIGRATED_KEY, true);
  }

  private showInstall(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: true };
    const nonce = crypto.randomBytes(16).toString("base64");
    view.webview.html = installHtml(nonce);
    const listener = view.webview.onDidReceiveMessage((message: unknown) => {
      if ((message as { type?: unknown })?.type === "install") {
        void vscode.env.openExternal(vscode.Uri.parse(OFFICE_RELEASES_URL));
      }
    });
    view.onDidDispose(() => listener.dispose());
  }
}

async function offerInstall(): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    "The Office is its own extension now: install Office Simulation to see your sessions' guys at work.",
    "Get Office Simulation",
  );
  if (choice !== undefined) {
    await vscode.env.openExternal(vscode.Uri.parse(OFFICE_RELEASES_URL));
  }
}

function installHtml(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-descriptionForeground); padding: 12px 16px; }
  p { margin: 0 0 10px; line-height: 1.5; }
  button { font: inherit; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; border-radius: 2px; padding: 4px 12px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
</style>
</head>
<body>
<p>The Office is its own extension now. Install <strong>Office Simulation</strong> and your sessions' guys come back to work here, with everything you set kept.</p>
<button id="install">Get Office Simulation</button>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.getElementById("install").addEventListener("click", () => vscode.postMessage({ type: "install" }));
</script>
</body>
</html>`;
}
