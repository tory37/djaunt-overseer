// Copied from vscode-office-simulation (api/officeSimulationApi.d.ts). Copy it again when its API grows; don't edit.
// The Office Simulation API: what `activate()` returns, for other extensions to drive the Office. This file has only
// types and imports nothing but `vscode`, so a host can copy it into its own source as is:
//
//   const office = vscode.extensions.getExtension<OfficeSimulationApi>("djaunt.office-simulation");
//   const api = office?.isActive ? office.exports : await office?.activate();
//   if (api?.apiVersion === 1) { api.setAgents([...]); }
//
// Version 1. New members only get added; anything else changes apiVersion.

import type * as vscode from "vscode";

export interface OfficeSimulationApi {
  readonly apiVersion: 1;

  // ----- Into the Office -----

  // The workers in the room besides your guy. Each gets a desk; send the whole list every time it changes. An agent
  // that drops off the list walks out the door.
  setAgents(agents: readonly OfficeAgent[]): void;
  // What your guy is up to: "busy" keeps him at his station, "idle" sends him on a break until it changes, and "auto"
  // (the default) works with a break now and then.
  setMainGuy(status: OfficeMainGuyStatus): void;
  // Plays a scene event in every open Office. The first call stops the Office's own event schedule for good, so your
  // extension decides when they play.
  playEvent(kind: OfficeEventKind, variant?: number): void;
  // Moves your guy's second monitor graph to a tint, an index into the spectrum Overseer's views share (it wraps). The
  // first call stops the Office's own tint cycle.
  setTint(index: number, burst?: boolean): void;
  // Stops the Office's own event schedule and tint cycle now, for a host that plays its own (playEvent and setTint
  // do this too, on their first call).
  takeOverEvents(): void;
  // Puts on a show now, opening the Office first if it isn't showing: a show id, or "random".
  playShow(kind?: OfficeShowKind | "random"): void;
  // Starts an invasion now, opening the Office first if it isn't showing: an invasion id, or "random". Nothing happens
  // while one is already on.
  startInvasion(kind?: OfficeInvasionKind | "random"): void;
  // Sends in a visitor now: a department id, or a random one.
  sendVisitor(kind?: OfficeVisitorKind): void;
  // Puts a line over a guy: an agent id, or "you" for your guy. Up to 80 characters; seconds is clamped to 1-20.
  say(agentId: string, text: string, seconds?: number): void;

  // ----- Looks -----

  // The look a seed gives, as the Office draws it.
  lookFromSeed(seed: string): OfficeLook;
  // The races, for a picker.
  races(): readonly { id: string; label: string }[];
  // The seed with its race set (or replaced), keeping everything else about the look.
  seedWithRace(seed: string, race: string): string;
  // The race a seed gives.
  raceOfSeed(seed: string): string;
  // Opens the character maker over the Office on a look, showing the Office first if it's hidden, and resolves to the
  // look the person saved, or undefined when they cancel. Save it yourself and send it back in setAgents. A new call
  // cancels one still open.
  editLook(initial: OfficeLook, title?: string): Promise<OfficeLook | undefined>;
  // A 16x16 SVG of the guy's head and shoulders, with an optional badge in the corner, for a tree item's icon.
  portraitSvg(look: OfficeLook, badge?: { color: string; pulse?: boolean }, dimmed?: boolean): string;

  // ----- Hosting -----

  // Draws the Office in a webview view your extension contributes, so it can sit in your own sidebar. Call it from
  // your WebviewViewProvider's resolveWebviewView. It behaves like the Office's own view, which hides while a host
  // view is attached.
  attachView(view: vscode.WebviewView): vscode.Disposable;

  // ----- Out of the Office -----

  // A guy was clicked: an agent id, or "you".
  readonly onDidClickAgent: vscode.Event<string>;
  // A show started or ended.
  readonly onDidStartShow: vscode.Event<OfficeShowKind>;
  readonly onDidEndShow: vscode.Event<OfficeShowKind>;
  // An invasion started, or ended (everyone back on his feet and the mess swept up).
  readonly onDidStartInvasion: vscode.Event<OfficeInvasionKind>;
  readonly onDidEndInvasion: vscode.Event<OfficeInvasionKind>;
  // Someone asked for a scene event in the Office (its Trigger Event button or Play Scene Event command) after your
  // extension took over events. Play it with playEvent, and anywhere else you show events, so they play together.
  // Until something listens, a request plays in the Office alone.
  readonly onDidRequestEvent: vscode.Event<OfficeEventKind>;
  // A scene event finished playing in an Office.
  readonly onDidFinishEvent: vscode.Event<OfficeEventKind>;
  // Your guy's look changed (the character maker or the officeSim.yourLook setting).
  readonly onDidChangeYourLook: vscode.Event<OfficeLook>;
  // An Office view started (yours or the Office's own). A good time to send anything that isn't in setAgents.
  readonly onDidOpenView: vscode.Event<void>;
}

export interface OfficeAgent {
  id: string;
  // Asleep (a suspended session) does the same idle things as idle, naps included.
  status: "busy" | "idle" | "asleep";
  // What his tooltip says.
  title?: string;
  // Picks his look, desk style, and personality. Defaults to the id.
  seed?: string;
  // A full look (from the character maker), instead of the one his seed gives. His personality still comes from the
  // seed.
  look?: OfficeLook;
  // Wears the crown: the one your extension is focused on.
  highlighted?: boolean;
}

export type OfficeMainGuyStatus = "auto" | "busy" | "idle";
export type OfficeEventKind = "error" | "hack" | "defense";
export type OfficeShowKind = "guitarist" | "band" | "lunch" | "snacks" | "comedian" | "magician" | "dj";
export type OfficeInvasionKind = "aliens" | "zombies" | "raiders" | "vampires";
export type OfficeVisitorKind =
  | "manager" | "vp" | "ceo" | "hr" | "it" | "sales" | "marketing" | "facilities" | "accounting" | "intern" | "legal" | "qa"
  | "security" | "design" | "product";

// Colors are "#rrggbb".
export interface OfficeLook {
  skin: string;
  hair: string;
  hairStyle: "short" | "long" | "spiky" | "bob" | "bald" | "mohawk" | "bun" | "curly" | "ponytail";
  shirt: string;
  pants: string;
  shoes: string;
  accessory: "none" | "glasses" | "headphones" | "cap" | "beard" | "fullBeard";
  accessoryColor: string;
  eyes?: string;
  beard?: string;
  sleeveless?: boolean;
  shorts?: boolean;
  flipFlops?: boolean;
  // A race id from races(); missing means human.
  race?: string;
  // The race's three mark colors (horns, scales, wings).
  marks?: [string, string, string];
  tie?: string;
}
