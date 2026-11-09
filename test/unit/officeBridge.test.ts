import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type * as vscode from "vscode";
import { OfficeBridge, OfficeBridgeDeps } from "../../src/officeBridge";
import type { OfficeAgent, OfficeLook, OfficeSimulationApi } from "../../src/officeSimulationApi";
import { fake, FakeWebviewView, EventEmitter } from "../fakes/vscode";

// A stand-in for the Office's API that records what Overseer sends it.
function fakeOffice() {
  const clicks = new EventEmitter<string>();
  const opened = new EventEmitter<void>();
  const calls: { name: string; args: unknown[] }[] = [];
  const record = (name: string) => (...args: unknown[]) => void calls.push({ name, args });
  const look = (seed: string): OfficeLook => ({ skin: "#000000", hair: "#111111", hairStyle: "short", shirt: seed.length > 3 ? "#222222" : "#333333", pants: "#444444", shoes: "#555555", accessory: "none", accessoryColor: "#666666" });
  const api = {
    apiVersion: 1,
    setAgents: record("setAgents"),
    setMainGuy: record("setMainGuy"),
    playEvent: record("playEvent"),
    setTint: record("setTint"),
    takeOverEvents: record("takeOverEvents"),
    playShow: record("playShow"),
    sendVisitor: record("sendVisitor"),
    say: record("say"),
    lookFromSeed: look,
    races: () => [{ id: "human", label: "Human" }, { id: "orc", label: "Orc" }],
    seedWithRace: (seed: string, race: string) => `${seed}#race=${race}`,
    raceOfSeed: () => "human",
    editLook: async (initial: OfficeLook) => ({ ...initial, shirt: "#ABCDEF" }),
    portraitSvg: () => "<svg/>",
    attachView: (view: vscode.WebviewView) => {
      calls.push({ name: "attachView", args: [view] });
      return { dispose: () => calls.push({ name: "detach", args: [view] }) };
    },
    onDidClickAgent: clicks.event,
    onDidStartShow: new EventEmitter<string>().event,
    onDidEndShow: new EventEmitter<string>().event,
    onDidFinishEvent: new EventEmitter<string>().event,
    onDidOpenView: opened.event,
    onDidChangeYourLook: new EventEmitter<OfficeLook>().event,
  } as unknown as OfficeSimulationApi;
  return { api, calls, clicks, opened, last: (name: string) => calls.filter((call) => call.name === name).at(-1)?.args };
}

function memento(): vscode.Memento {
  const values = new Map<string, unknown>();
  return {
    keys: () => [...values.keys()],
    get: <T>(key: string, fallback?: T) => (values.has(key) ? (values.get(key) as T) : fallback),
    update: async (key: string, value: unknown) => void values.set(key, value),
  } as vscode.Memento;
}

function deps() {
  const seeds = new Map<string, string>();
  const looks = new Map<string, unknown>();
  const registryChange = new EventEmitter<void>();
  const played = new EventEmitter<{ type: "sceneEvent"; kind: "error" | "hack" | "defense"; variant: number }>();
  const tinted = new EventEmitter<number>();
  const value: OfficeBridgeDeps = {
    liveMonitor: { onDidChange: new EventEmitter<void>().event, get: (id: string) => (id === "a" ? { status: "busy" } : undefined) } as never,
    registry: {
      onDidChange: registryChange.event,
      avatarSeed: (id: string) => seeds.get(id) ?? id,
      setAvatarSeed: async (id: string, seed: string) => void seeds.set(id, seed),
      avatarLook: (id: string) => looks.get(id),
      setAvatarLook: async (id: string, look: unknown) => void (look === undefined ? looks.delete(id) : looks.set(id, look)),
    } as never,
    pinnedSessions: () => [{ sessionId: "a" }, { sessionId: "b" }] as never,
    sessionTitle: (id) => `Session ${id}`,
    sceneEvents: { onDidPlay: played.event, onDidTint: tinted.event, currentTint: () => 4 } as never,
    focusedSessionId: () => "a",
    onDidChangeFocus: new EventEmitter<void>().event,
    globalState: memento(),
  };
  return { value, seeds, looks, played, tinted };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const bridges: OfficeBridge[] = [];
const track = (bridge: OfficeBridge) => (bridges.push(bridge), bridge);

describe("OfficeBridge", () => {
  beforeEach(() => fake.reset());
  afterEach(() => bridges.splice(0).forEach((bridge) => bridge.dispose()));

  it("offers to install the Office when it's missing", async () => {
    const bridge = track(new OfficeBridge(deps().value));
    const view = new FakeWebviewView();
    bridge.resolveWebviewView(view as unknown as vscode.WebviewView);
    expect(view.webview.html).toContain("Office Simulation");
    view.send({ type: "install" });
    expect(fake.opened[0]).toContain("vscode-office-simulation/releases");
    await bridge.customize("a");
    expect(fake.shown).toHaveLength(1);
    expect(bridge.api).toBeUndefined();
  });

  it("hooks in when the Office shows up: workers, events, tint, clicks, and the view", async () => {
    const { value, played, tinted } = deps();
    const bridge = track(new OfficeBridge(value));
    const view = new FakeWebviewView();
    bridge.resolveWebviewView(view as unknown as vscode.WebviewView);
    const office = fakeOffice();
    fake.setExtension("djaunt.office-simulation", office.api);
    await settle();
    expect(bridge.api).toBe(office.api);
    expect(office.last("attachView")).toEqual([view]);
    expect(office.calls.map((call) => call.name)).toContain("takeOverEvents");
    expect(office.last("setTint")).toEqual([4, false]);
    expect(office.last("setAgents")?.[0]).toEqual([
      { id: "a", seed: "a", status: "busy", title: "Session a", highlighted: true },
      { id: "b", seed: "b", status: "asleep", title: "Session b" },
    ] satisfies OfficeAgent[]);
    played.fire({ type: "sceneEvent", kind: "hack", variant: 42 });
    tinted.fire(5);
    expect(office.last("playEvent")).toEqual(["hack", 42]);
    expect(office.last("setTint")).toEqual([5]);
    office.clicks.fire("b");
    office.clicks.fire("you");
    expect(fake.commands.filter((command) => command.command === "overseer.clickSession")).toEqual([{ command: "overseer.clickSession", args: ["b"] }]);
    expect(fake.commands).toContainEqual({ command: "setContext", args: ["overseer.officeConnected", true] });
  });

  it("customizes, re-rolls, resets, and picks a race for a session's guy", async () => {
    const { value, seeds, looks } = deps();
    const office = fakeOffice();
    fake.setExtension("djaunt.office-simulation", office.api);
    const bridge = track(new OfficeBridge(value));
    await settle();
    await bridge.customize("a");
    expect((looks.get("a") as OfficeLook).shirt).toBe("#ABCDEF");
    await bridge.reroll("a");
    expect(looks.has("a")).toBe(false);
    expect(seeds.get("a")).not.toBe("a");
    await bridge.reset("a");
    expect(seeds.get("a")).toBe("a");
  });

  it("copies the old settings you set to the Office's once", async () => {
    fake.settings.set("overseer.office.scene", "moon");
    fake.settings.set("overseer.office.chatter", "log");
    fake.settings.set("officeSim.chatter", "quiet");
    const { value } = deps();
    fake.setExtension("djaunt.office-simulation", fakeOffice().api);
    track(new OfficeBridge(value));
    await settle();
    expect(fake.settings.get("officeSim.scene")).toBe("moon");
    expect(fake.settings.get("officeSim.chatter")).toBe("quiet");
    expect(value.globalState.get("overseer.officeSettingsMoved")).toBe(true);
  });

  it("falls back to the install note when the Office goes away", async () => {
    const office = fakeOffice();
    fake.setExtension("djaunt.office-simulation", office.api);
    const bridge = track(new OfficeBridge(deps().value));
    const view = new FakeWebviewView();
    bridge.resolveWebviewView(view as unknown as vscode.WebviewView);
    await settle();
    fake.setExtension("djaunt.office-simulation", undefined);
    await settle();
    expect(bridge.api).toBeUndefined();
    expect(office.last("detach")).toEqual([view]);
    expect(view.webview.html).toContain("Get Office Simulation");
  });
});
