import * as crypto from "crypto";
import * as fs from "fs";
import * as vscode from "vscode";
import type { PinnedSession } from "./grouping";
import type { LiveSessionMonitor } from "./liveSessions";
import { CHATTER_LABELS, CHATTER_STYLES, chatterStyle } from "./officeChatter";
import { OFFICE_SCENES, officeSceneId } from "./officeLayout";
import type { AgentInput } from "./officeSim";
import { isPerformanceKind, PERFORMANCE_KINDS, PERFORMANCES, performanceFrequency, PerformanceKindId } from "./officePerformances";
import { visitorFrequency } from "./officeVisitors";
import { PixelGuyLook, raceOfSeed, yourLook } from "./pixelGuy";
import { RACES, seedWithRace } from "./pixelRaces";
import type { Registry } from "./registry";
import type { SceneEventDirector } from "./sceneEvents";

export const OFFICE_PANEL_VIEW_ID = "overseer.office";
const SCENE_SETTING = "overseer.office.scene";
const SLEEPERS_SETTING = "overseer.office.sleepers";
const YOU_SETTING = "overseer.office.you";
const YOUR_LOOK_SETTING = "overseer.office.yourLook";
const CRITTERS_SETTING = "overseer.office.critters";
const FLIERS_SETTING = "overseer.office.fliers";
const RACES_SETTING = "overseer.office.races";
const DAY_NIGHT_SETTING = "overseer.office.dayNight";
const VISITORS_SETTING = "overseer.office.visitors";
const PERFORMANCES_SETTING = "overseer.office.performances";
const CHATTER_SETTING = "overseer.office.chatter";

export interface OfficePanelDeps {
  extensionUri: vscode.Uri;
  liveMonitor: LiveSessionMonitor;
  registry: Registry;
  pinnedSessions: () => PinnedSession[];
  sessionTitle: (sessionId: string) => string;
  sceneEvents: SceneEventDirector;
  // The session the Session sidebar shows; its guy wears a crown.
  focusedSessionId: () => string | undefined;
  onDidChangeFocus: vscode.Event<void>;
}

// The Office view: a pixel guy for every session in the sidebar, working at his desk while the session is busy,
// wandering the room while it's idle, and asleep at his desk while it's suspended. The simulation runs in the webview (src/officeView); this side sends it the
// live sessions whenever they change and opens a session when its guy is clicked. You have a station too, and act out the
// scene events the director plays on every decorative view.
export class OfficePanelProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly webviews = new Set<vscode.Webview>();
  private readonly views = new Set<vscode.WebviewView>();
  // A show asked for before the view was open, played once it says it's ready.
  private pendingShow: { kind: PerformanceKindId | "random" } | undefined;
  private readonly listeners: vscode.Disposable[];

  constructor(private readonly deps: OfficePanelDeps) {
    this.listeners = [
      deps.liveMonitor.onDidChange(() => this.postAll()),
      deps.registry.onDidChange(() => this.postAll()),
      deps.onDidChangeFocus(() => this.postAll()),
      vscode.workspace.onDidChangeConfiguration((change) => {
        if ([SCENE_SETTING, SLEEPERS_SETTING, YOU_SETTING, YOUR_LOOK_SETTING, CRITTERS_SETTING, FLIERS_SETTING, DAY_NIGHT_SETTING, VISITORS_SETTING, PERFORMANCES_SETTING, CHATTER_SETTING, RACES_SETTING].some((setting) => change.affectsConfiguration(setting))) {
          this.postAll();
        }
      }),
    ];
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    const webview = webviewView.webview;
    const distUri = vscode.Uri.joinPath(this.deps.extensionUri, "dist");
    webview.options = { enableScripts: true, localResourceRoots: [distUri] };
    const scriptUri = vscode.Uri.joinPath(distUri, "officeView.js");
    // Reinstalling the same version keeps the same URL, so the build time busts the webview's cached copy.
    webview.html = officeHtml(webview, webview.asWebviewUri(scriptUri).with({ query: `v=${scriptStamp(scriptUri)}` }));
    this.webviews.add(webview);
    this.views.add(webviewView);
    this.deps.sceneEvents.attach(webviewView);
    const messageListener = webview.onDidReceiveMessage((message: unknown) => this.handleMessage(webview, message));
    webviewView.onDidDispose(() => {
      this.webviews.delete(webview);
      this.views.delete(webviewView);
      messageListener.dispose();
    });
  }

  // Puts on a show in the Office now, opening the view first if it isn't showing.
  playShow(kind: PerformanceKindId | "random"): void {
    const message = { type: "performance", kind };
    if (![...this.views].some((view) => view.visible)) {
      this.pendingShow = this.webviews.size === 0 ? { kind } : undefined;
      void vscode.commands.executeCommand(`${OFFICE_PANEL_VIEW_ID}.focus`);
    }
    this.webviews.forEach((webview) => void webview.postMessage(message));
  }

  // Titles come from the analyzer and the index, which change on their own schedule.
  refreshTitles(): void {
    this.postAll();
  }

  dispose(): void {
    this.listeners.forEach((listener) => listener.dispose());
  }

  private handleMessage(webview: vscode.Webview, message: unknown): void {
    if (typeof message !== "object" || message === null) {
      return;
    }
    const { type, sessionId } = message as { type?: unknown; sessionId?: unknown };
    if (type === "ready") {
      void webview.postMessage(this.message());
      if (this.pendingShow !== undefined) {
        void webview.postMessage({ type: "performance", kind: this.pendingShow.kind });
        this.pendingShow = undefined;
      }
    } else if (type === "open" && typeof sessionId === "string") {
      void vscode.commands.executeCommand("overseer.clickSession", sessionId);
    }
  }

  private postAll(): void {
    if (this.webviews.size === 0) {
      return;
    }
    const message = this.message();
    this.webviews.forEach((webview) => void webview.postMessage(message));
  }

  private message(): {
    type: "office";
    scene: string;
    agents: AgentInput[];
    you: PixelGuyLook | null;
    critters: boolean;
    fliers: boolean;
    dayNight: boolean;
    visitors: string;
    performances: string;
    chatter: string;
    races: boolean;
    focusedId: string | null;
  } {
    const agents: AgentInput[] = [];
    const seen = new Set<string>();
    const showSleepers = vscode.workspace.getConfiguration().get<boolean>(SLEEPERS_SETTING, true);
    for (const pinned of this.deps.pinnedSessions()) {
      // Plain terminal rows aren't Claude sessions, so they get no guy.
      if (pinned.terminal !== undefined || seen.has(pinned.sessionId)) {
        continue;
      }
      const live = this.deps.liveMonitor.get(pinned.sessionId);
      if (live === undefined && !showSleepers) {
        continue;
      }
      seen.add(pinned.sessionId);
      agents.push({
        id: pinned.sessionId,
        seed: this.deps.registry.avatarSeed(pinned.sessionId),
        status: live === undefined ? "asleep" : live.status === "idle" ? "idle" : "working",
        title: this.deps.sessionTitle(pinned.sessionId),
      });
    }
    const configuration = vscode.workspace.getConfiguration();
    const you = configuration.get<boolean>(YOU_SETTING, true) ? yourLook(configuration.get<unknown>(YOUR_LOOK_SETTING)) : null;
    return {
      type: "office",
      scene: currentScene(),
      agents,
      you,
      critters: configuration.get<boolean>(CRITTERS_SETTING, true),
      fliers: configuration.get<boolean>(FLIERS_SETTING, true),
      dayNight: configuration.get<boolean>(DAY_NIGHT_SETTING, true),
      visitors: visitorFrequency(configuration.get<unknown>(VISITORS_SETTING)),
      performances: performanceFrequency(configuration.get<unknown>(PERFORMANCES_SETTING)),
      chatter: chatterStyle(configuration.get<unknown>(CHATTER_SETTING)),
      races: configuration.get<boolean>(RACES_SETTING, true),
      focusedId: this.deps.focusedSessionId() ?? null,
    };
  }
}

function scriptStamp(scriptUri: vscode.Uri): string {
  try {
    return String(Math.floor(fs.statSync(scriptUri.fsPath).mtimeMs));
  } catch {
    return String(Date.now());
  }
}

function currentScene(): string {
  return officeSceneId(vscode.workspace.getConfiguration().get<string>(SCENE_SETTING));
}

export function registerOfficeCommands(registry: Registry, office: OfficePanelProvider): vscode.Disposable[] {
  return [
    // Takes a show kind as an argument (for a keybinding), or asks.
    vscode.commands.registerCommand("overseer.office.playShow", async (kind?: unknown) => {
      if (isPerformanceKind(kind) || kind === "random") {
        office.playShow(kind);
        return;
      }
      const picked = await vscode.window.showQuickPick(
        [
          { label: "$(question) Surprise Me", id: "random" as const },
          ...PERFORMANCE_KINDS.map((id) => ({ label: PERFORMANCES[id].label, description: SHOW_DESCRIPTIONS[id], id })),
        ],
        { placeHolder: "Which show?" },
      );
      if (picked !== undefined) {
        office.playShow(picked.id);
      }
    }),
    vscode.commands.registerCommand("overseer.office.chatterStyle", async (style?: unknown) => {
      const configuration = vscode.workspace.getConfiguration();
      let picked = CHATTER_STYLES.find((id) => id === style);
      if (picked === undefined) {
        const current = chatterStyle(configuration.get<unknown>(CHATTER_SETTING));
        picked = (await vscode.window.showQuickPick(
          CHATTER_STYLES.map((id) => ({
            label: id === current ? `$(check) ${CHATTER_LABELS[id].label}` : CHATTER_LABELS[id].label,
            description: CHATTER_LABELS[id].description,
            id,
          })),
          { placeHolder: "How the Office shows what the guys say" },
        ))?.id;
      }
      if (picked !== undefined) {
        await configuration.update(CHATTER_SETTING, picked, vscode.ConfigurationTarget.Global);
      }
    }),
    vscode.commands.registerCommand("overseer.office.switchScene", async () => {
      const current = currentScene();
      const picked = await vscode.window.showQuickPick(
        OFFICE_SCENES.map((scene) => ({ label: scene.id === current ? `$(check) ${scene.label}` : scene.label, id: scene.id })),
        { placeHolder: "Office scene" },
      );
      if (picked !== undefined) {
        await vscode.workspace.getConfiguration().update(SCENE_SETTING, picked.id, vscode.ConfigurationTarget.Global);
      }
    }),
    vscode.commands.registerCommand("overseer.rerollPixelGuy", async (node?: { pinned?: PinnedSession }) => {
      const sessionId = node?.pinned?.sessionId;
      if (sessionId !== undefined) {
        await registry.setAvatarSeed(sessionId, crypto.randomBytes(8).toString("hex"));
      }
    }),
    vscode.commands.registerCommand("overseer.pickPixelGuyRace", async (node?: { pinned?: PinnedSession }) => {
      const sessionId = node?.pinned?.sessionId;
      if (sessionId === undefined) {
        return;
      }
      // Only the race changes; the rest of the look stays.
      const seed = registry.avatarSeed(sessionId);
      const races = vscode.workspace.getConfiguration().get<boolean>(RACES_SETTING, true);
      const current = raceOfSeed(seed, races);
      const picked = await vscode.window.showQuickPick(
        RACES.map((race) => ({ label: race.id === current ? `$(check) ${race.label}` : race.label, id: race.id })),
        { placeHolder: "Race for this session's pixel guy" },
      );
      if (picked !== undefined) {
        await registry.setAvatarSeed(sessionId, seedWithRace(seed, picked.id));
      }
    }),
    vscode.commands.registerCommand("overseer.resetPixelGuy", async (node?: { pinned?: PinnedSession }) => {
      const sessionId = node?.pinned?.sessionId;
      if (sessionId !== undefined) {
        await registry.setAvatarSeed(sessionId, sessionId);
      }
    }),
  ];
}

const SHOW_DESCRIPTIONS: Record<PerformanceKindId, string> = {
  guitarist: "a busker with an acoustic guitar",
  band: "singer, guitar, bass, and drums",
  lunch: "a trolley of hot lunch for everyone",
  snacks: "donuts, cookies, ice cream, popcorn",
  comedian: "stand-up under a spotlight",
  magician: "card tricks and a rabbit in a hat",
  dj: "a DJ, a mirror ball, and dancing",
};

function officeHtml(webview: vscode.Webview, scriptUri: vscode.Uri): string {
  const nonce = crypto.randomBytes(16).toString("base64");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}' ${webview.cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Office</title>
<style nonce="${nonce}">
  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: var(--vscode-sideBar-background); }
  canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
  .readout {
    position: absolute;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 10px;
    line-height: 14px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
    pointer-events: none;
    white-space: pre;
    text-shadow: 0 0 3px var(--vscode-sideBar-background);
  }
  .top { top: 4px; } .bottom { bottom: 4px; } .left { left: 8px; } .right { right: 8px; text-align: right; }
  .live { color: var(--vscode-textLink-foreground); }
  #tooltip { text-transform: none; letter-spacing: 0; max-width: calc(100% - 16px); overflow: hidden; text-overflow: ellipsis; }
</style>
</head>
<body>
<canvas id="office"></canvas>
<div class="readout top right"><span class="live" id="scene">office</span> // <span id="status">quiet</span></div>
<div class="readout bottom left" id="tooltip" hidden></div>
<script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
}
