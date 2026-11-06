// Pure: the decorative views' scene events (ERROR, HACK, DEFENSE), which are on, and when the next one plays.

export type SceneEventKind = "error" | "hack" | "defense";

export const SCENE_EVENT_KINDS: readonly SceneEventKind[] = ["error", "hack", "defense"];

// The setting under `overseer` that turns each kind on.
export const SCENE_EVENT_SETTING: Record<SceneEventKind, string> = {
  error: "views.errorEvents",
  hack: "views.hackEvents",
  defense: "views.defenseEvents",
};

// Each HACK pair: the Djaunt view's big line, then the Core view's answer.
export const HACK_PHRASES: readonly (readonly [string, string])[] = [
  ["HACK SUCCEEDED", "ACCESS GRANTED"],
  ["MAINFRAME BREACHED", "I'M IN"],
  ["ROOT ACCESS", "FIREWALL DOWN"],
  ["SYSTEM PWNED", "ALL YOUR BASE"],
  ["ENHANCE", "IT'S A UNIX SYSTEM"],
  ["GIBSON HACKED", "HACK THE PLANET"],
  ["DOWNLOADING THE INTERNET", "ALL OF IT"],
  ["SATELLITE HIJACKED", "REDIRECTING ORBIT"],
  ["ENCRYPTION CRACKED", "256 BITS 0 PROBLEMS"],
  ["KERNEL OWNED", "SUDO SAYS YES"],
];

// Each DEFENSE script, one line per beat: incoming, blocking, almost there, safe. The last is the Core view's answer.
export const DEFENSE_SCRIPTS: readonly (readonly [string, string, string, string, string])[] = [
  ["INTRUSION DETECTED", "DEPLOYING COUNTERMEASURES", "HOLD THE LINE!!", "THREAT NEUTRALIZED", "NOT TODAY"],
  ["THEY'RE IN THE MAINFRAME", "REROUTING PACKETS", "ONE MORE SECOND!!", "TRACED AND BLOCKED", "GG EZ"],
  ["HOSTILE UPLINK", "SEALING EVERY PORT", "SO CLOSE!!", "GOT 'EM", "ALL CLEAR"],
  ["BREACH IN PROGRESS", "ENCRYPTING EVERYTHING", "COME ON COME ON!!", "LOCKED THEM OUT", "NICE TRY"],
  ["DDOS INBOUND", "SPINNING UP THE FIREWALL", "IT'S HOLDING!!", "ATTACK REPELLED", "SYSTEMS GREEN"],
];

const VARIANT_COUNT: Record<SceneEventKind, number> = {
  error: 1,
  hack: HACK_PHRASES.length,
  defense: DEFENSE_SCRIPTS.length,
};

// `overseer.views.eventMinutes`: the average gap. Each gap is a random 0.6x to 1.6x of it.
export const DEFAULT_EVENT_MINUTES = 5;
export const MIN_EVENT_MINUTES = 0.5;
export const MAX_EVENT_MINUTES = 60;
export const MIN_GAP_FACTOR = 0.6;
export const MAX_GAP_FACTOR = 1.6;
const FIRST_EVENT_MINUTES = 2;

export const EVENT_FREQUENCY_PRESETS: readonly { label: string; minutes: number }[] = [
  { label: "Chaos", minutes: 0.5 },
  { label: "Frequent", minutes: 2 },
  { label: "Normal", minutes: 5 },
  { label: "Rare", minutes: 15 },
  { label: "Very rare", minutes: 45 },
];

export interface SceneEventMessage {
  type: "sceneEvent";
  kind: SceneEventKind;
  variant: number;
}

export function enabledSceneEvents(isEnabled: (kind: SceneEventKind) => boolean): SceneEventKind[] {
  return SCENE_EVENT_KINDS.filter(isEnabled);
}

export function pickSceneEvent(enabled: readonly SceneEventKind[], random: () => number): SceneEventKind | undefined {
  if (enabled.length === 0) {
    return undefined;
  }
  return enabled[Math.min(enabled.length - 1, Math.floor(random() * enabled.length))];
}

// A setting that is missing, not a number, or out of range falls back to the default or the nearest bound.
export function eventMinutes(setting: unknown): number {
  if (typeof setting !== "number" || !Number.isFinite(setting)) {
    return DEFAULT_EVENT_MINUTES;
  }
  return Math.min(MAX_EVENT_MINUTES, Math.max(MIN_EVENT_MINUTES, setting));
}

// The text of a custom frequency, or an error message for the input box.
export function validateEventMinutes(text: string): string | undefined {
  const minutes = Number(text.trim());
  if (text.trim() === "" || !Number.isFinite(minutes)) {
    return "Enter a number of minutes.";
  }
  if (minutes < MIN_EVENT_MINUTES || minutes > MAX_EVENT_MINUTES) {
    return `Enter ${MIN_EVENT_MINUTES} to ${MAX_EVENT_MINUTES} minutes.`;
  }
  return undefined;
}

export function nextSceneEventDelayMs(minutes: number, random: () => number): number {
  const factor = MIN_GAP_FACTOR + random() * (MAX_GAP_FACTOR - MIN_GAP_FACTOR);
  return Math.round(eventMinutes(minutes) * factor * 60_000);
}

export function firstSceneEventDelayMs(minutes: number): number {
  return Math.round(Math.min(FIRST_EVENT_MINUTES, eventMinutes(minutes)) * 60_000);
}

// Both views get the same message, so they play the same phrase pair or script.
export function sceneEventMessage(kind: SceneEventKind, random: () => number): SceneEventMessage {
  const count = VARIANT_COUNT[kind];
  return { type: "sceneEvent", kind, variant: Math.min(count - 1, Math.floor(random() * count)) };
}
