import * as vscode from "vscode";
import {
  enabledSceneEvents,
  EVENT_FREQUENCY_PRESETS,
  eventMinutes,
  firstSceneEventDelayMs,
  nextSceneEventDelayMs,
  pickSceneEvent,
  SCENE_EVENT_SETTING,
  SceneEventKind,
  sceneEventMessage,
  validateEventMinutes,
} from "./sceneEventSchedule";

const EVENT_MINUTES_SETTING = "views.eventMinutes";

// Plays the ERROR, HACK, and DEFENSE bits on every decorative view at once, now and then, and on command. A change to
// the frequency setting reschedules the pending event. Also relays the tint of Core's burst to the other views, and
// sends the current tint to a view when it loads.
export class SceneEventDirector implements vscode.Disposable {
  private readonly webviews = new Set<vscode.Webview>();
  private tintIndex = 0;
  private readonly configListener: vscode.Disposable;
  private timer: ReturnType<typeof setTimeout>;

  constructor() {
    this.timer = setTimeout(() => this.playScheduled(), firstSceneEventDelayMs(currentEventMinutes()));
    this.configListener = vscode.workspace.onDidChangeConfiguration((change) => {
      if (change.affectsConfiguration(`overseer.${EVENT_MINUTES_SETTING}`)) {
        this.schedule();
      }
    });
  }

  attach(webviewView: vscode.WebviewView): void {
    const webview = webviewView.webview;
    this.webviews.add(webview);
    const messageListener = webview.onDidReceiveMessage((message: unknown) => this.receive(webview, message));
    webviewView.onDidDispose(() => {
      messageListener.dispose();
      this.webviews.delete(webview);
    });
  }

  play(kind: SceneEventKind): void {
    const message = sceneEventMessage(kind, Math.random);
    this.webviews.forEach((webview) => void webview.postMessage(message));
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.configListener.dispose();
  }

  private receive(sender: vscode.Webview, message: unknown): void {
    if (typeof message !== "object" || message === null) return;
    const { type, index } = message as { type?: unknown; index?: unknown };
    if (type === "ready") {
      void sender.postMessage({ type: "tint", index: this.tintIndex, burst: false });
      return;
    }
    if (type !== "tint" || !Number.isInteger(index)) return;
    this.tintIndex = index as number;
    const relayed = { type: "tint", index, burst: true };
    this.webviews.forEach((webview) => {
      if (webview !== sender) void webview.postMessage(relayed);
    });
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.playScheduled(), nextSceneEventDelayMs(currentEventMinutes(), Math.random));
  }

  private playScheduled(): void {
    const kind = pickSceneEvent(enabledSceneEvents(isSceneEventEnabled), Math.random);
    if (kind !== undefined) {
      this.play(kind);
    }
    this.schedule();
  }
}

function isSceneEventEnabled(kind: SceneEventKind): boolean {
  return vscode.workspace.getConfiguration("overseer").get<boolean>(SCENE_EVENT_SETTING[kind], true);
}

function currentEventMinutes(): number {
  return eventMinutes(vscode.workspace.getConfiguration("overseer").get<unknown>(EVENT_MINUTES_SETTING));
}

const formatMinutes = (minutes: number) => (minutes < 1 ? `${Math.round(minutes * 60)}s` : `${minutes} min`);

async function setEventFrequency(): Promise<void> {
  const current = currentEventMinutes();
  type FrequencyItem = vscode.QuickPickItem & { minutes?: number };
  const items: FrequencyItem[] = EVENT_FREQUENCY_PRESETS.map(({ label, minutes }) => ({
    label: minutes === current ? `$(check) ${label}` : label,
    description: `about every ${formatMinutes(minutes)}`,
    minutes,
  }));
  const isPreset = EVENT_FREQUENCY_PRESETS.some(({ minutes }) => minutes === current);
  items.push({ label: isPreset ? "Custom…" : "$(check) Custom…", description: isPreset ? undefined : `about every ${formatMinutes(current)}` });
  const picked = await vscode.window.showQuickPick(items, { placeHolder: `Scene events play about every ${formatMinutes(current)}` });
  if (picked === undefined) {
    return;
  }
  let minutes = picked.minutes;
  if (minutes === undefined) {
    const text = await vscode.window.showInputBox({ prompt: "Average minutes between scene events", value: String(current), validateInput: validateEventMinutes });
    if (text === undefined) {
      return;
    }
    minutes = Number(text.trim());
  }
  await vscode.workspace.getConfiguration("overseer").update(EVENT_MINUTES_SETTING, minutes, vscode.ConfigurationTarget.Global);
}

export function registerSceneEventCommands(director: SceneEventDirector): vscode.Disposable[] {
  const toggle = async (kind: SceneEventKind, name: string) => {
    const isEnabled = !isSceneEventEnabled(kind);
    await vscode.workspace.getConfiguration("overseer").update(SCENE_EVENT_SETTING[kind], isEnabled, vscode.ConfigurationTarget.Global);
    void vscode.window.showInformationMessage(`Overseer: ${name} events ${isEnabled ? "on" : "off"}.`);
  };
  return [
    vscode.commands.registerCommand("overseer.playErrorEvent", () => director.play("error")),
    vscode.commands.registerCommand("overseer.playHackEvent", () => director.play("hack")),
    vscode.commands.registerCommand("overseer.playDefenseEvent", () => director.play("defense")),
    vscode.commands.registerCommand("overseer.toggleErrorEvents", () => toggle("error", "ERROR")),
    vscode.commands.registerCommand("overseer.toggleHackEvents", () => toggle("hack", "HACK")),
    vscode.commands.registerCommand("overseer.toggleDefenseEvents", () => toggle("defense", "DEFENSE")),
    vscode.commands.registerCommand("overseer.setEventFrequency", setEventFrequency),
  ];
}
