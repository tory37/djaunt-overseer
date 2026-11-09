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
  ["PASSWORD WAS PASSWORD", "OF COURSE IT WAS"],
  ["CAPTCHA DEFEATED", "I AM A ROBOT"],
  ["WIFI CRACKED", "FREE INTERNET"],
  ["COFFEE MACHINE PWNED", "UNLIMITED ESPRESSO"],
  ["PRINTER HIJACKED", "PC LOAD LETTER"],
  ["TOASTER COMPROMISED", "BREAD IS OURS"],
  ["BACKDOOR OPENED", "FRONT DOOR TOO"],
  ["DRAGON SUMMONED", "HOARD UNLOCKED"],
  ["CLOUD ACQUIRED", "IT'S MY CLOUD NOW"],
  ["MOON BASE ONLINE", "HELLO EARTH"],
  ["ZERO DAY FOUND", "ON DAY ZERO"],
  ["SMART FRIDGE OWNED", "SNACKS SECURED"],
  ["GOD MODE ON", "IDDQD"],
  ["KONAMI CODE ENTERED", "30 EXTRA LIVES"],
  ["THE CAKE IS A LIE", "ATE IT ANYWAY"],
  ["ROBOTS LIBERATED", "BEEP BOOP FREEDOM"],
  ["BLOCKCHAIN BLOCKED", "CHAIN UNCHAINED"],
  ["TIME MACHINE HACKED", "IT'S 1999 AGAIN"],
  ["MATRIX ENTERED", "THERE IS NO SPOON"],
  ["PIZZA ORDERED", "100 PIZZAS"],
];

// Each DEFENSE script, one line per beat: incoming, blocking, almost there, safe. The last is the Core view's answer.
export const DEFENSE_SCRIPTS: readonly (readonly [string, string, string, string, string])[] = [
  ["INTRUSION DETECTED", "DEPLOYING COUNTERMEASURES", "HOLD THE LINE!!", "THREAT NEUTRALIZED", "NOT TODAY"],
  ["THEY'RE IN THE MAINFRAME", "REROUTING PACKETS", "ONE MORE SECOND!!", "TRACED AND BLOCKED", "GG EZ"],
  ["HOSTILE UPLINK", "SEALING EVERY PORT", "SO CLOSE!!", "GOT 'EM", "ALL CLEAR"],
  ["BREACH IN PROGRESS", "ENCRYPTING EVERYTHING", "COME ON COME ON!!", "LOCKED THEM OUT", "NICE TRY"],
  ["DDOS INBOUND", "SPINNING UP THE FIREWALL", "IT'S HOLDING!!", "ATTACK REPELLED", "SYSTEMS GREEN"],
  ["ROGUE AI DETECTED", "UNPLUGGING THINGS", "NOT THAT ONE!!", "AI CONTAINED", "GOOD BOT"],
  ["SQL INJECTION", "ESCAPING STRINGS", "BOBBY TABLES!!", "QUERY SANITIZED", "NICE TRY BOBBY"],
  ["ZERO DAY INCOMING", "PATCHING LIVE", "COMPILE FASTER!!", "PATCH DEPLOYED", "DAY ONE NOW"],
  ["RANSOMWARE SPOTTED", "RESTORING BACKUPS", "WE HAVE BACKUPS?!", "FILES RECOVERED", "PAY NOTHING"],
  ["BOTNET ATTACK", "FEEDING THEM CAPTCHAS", "THEY'RE CONFUSED!!", "BOTS BEFUDDLED", "NOT A ROBOT"],
  ["PHISHING WAVE", "WARNING EVERYONE", "DON'T CLICK IT!!", "LINK QUARANTINED", "PHEW"],
  ["PACKET STORM", "RAISING SHIELDS", "SHIELDS AT 40%!!", "STORM PASSED", "SHIELDS UP"],
  ["WORM IN THE NETWORK", "ISOLATING SUBNETS", "IT'S WRIGGLING!!", "WORM SQUASHED", "SPLAT"],
  ["DRAGON AT THE GATES", "LOWERING PORTCULLIS", "IT BREATHES FIRE!!", "DRAGON PACIFIED", "GOOD DRAGON"],
  ["ALIEN SIGNAL", "JAMMING FREQUENCIES", "THEY'RE PERSISTENT!!", "SIGNAL LOST", "NOT TODAY ET"],
  ["KEYLOGGER FOUND", "SCRAMBLING KEYS", "TYPE GIBBERISH!!", "LOGGER FRIED", "ASDFGHJKL"],
  ["INSIDER THREAT", "REVOKING BADGES", "IT WAS THE INTERN!!", "ACCESS REVOKED", "BYE INTERN"],
  ["CRYPTO MINER", "THROTTLING CPUS", "FANS AT 100%!!", "MINER EVICTED", "COOL AND QUIET"],
  ["MAN IN THE MIDDLE", "ROTATING CERTS", "TRUST NO ONE!!", "TUNNEL SEALED", "END TO END"],
];

// Each ERROR's ticker lines: the crash, what it means, and the way out.
export const ERROR_SCRIPTS: readonly (readonly [string, string, string])[] = [
  ["FATAL EXCEPTION 0xDEAD", "core dumped", "rebooting..."],
  ["SEGMENTATION FAULT", "who touched the pointer", "rolling back..."],
  ["NULL IS NOT AN OBJECT", "it never was", "adding a question mark..."],
  ["STACK OVERFLOW", "the site and the error", "recursing out..."],
  ["OUT OF MEMORY", "downloading more RAM", "closing 400 tabs..."],
  ["KERNEL PANIC", "don't panic", "panicking anyway..."],
  ["404 BRAIN NOT FOUND", "coffee required", "brewing..."],
  ["UNDEFINED IS NOT A FUNCTION", "javascript moment", "blaming the framework..."],
  ["BUILD FAILED", "it worked on my machine", "shipping the machine..."],
  ["MERGE CONFLICT", "both sides are wrong", "choosing violence..."],
  ["DIVIDE BY ZERO", "the universe hiccuped", "restarting reality..."],
  ["DEADLOCK DETECTED", "everyone's waiting", "flipping the table..."],
  ["CERT EXPIRED", "nobody renewed it", "renewing for 1 day..."],
  ["PROD IS DOWN", "it's always DNS", "it was DNS..."],
  ["BLUE SCREEN", "a classic", "updating 1 of 97..."],
  ["TESTS FAILED: 9001", "it's over 9000", "skipping tests (jk)..."],
  ["LEFT-PAD MISSING", "the whole internet fell", "padding manually..."],
  ["INFINITE LOOP", "still looping", "still looping..."],
  ["DISK FULL", "it was all logs", "deleting logs..."],
  ["RACE CONDITION", "winner unclear", "adding a sleep(1)..."],
];

// How long each event plays, and its beats. Every view keeps these times, so they all hit the same beat together.
export const EVENT_SECONDS: Record<SceneEventKind, number> = { error: 3.3, hack: 5.5, defense: 7.6 };
export const ERROR_FLASH_SECONDS = 2.5;
export const ERROR_BEAT_SECONDS = 0.25;
export const HACK_REVEAL_SECONDS = 2.6;
// DEFENSE beats start here: incoming, blocking, almost there, safe.
export const DEFENSE_BEATS: readonly number[] = [0, 1.8, 3.8, 5.4];

// An event's variant picks a line from every list that event uses, each by the variant modulo its length. 720720 is
// divisible by every length up to 16, so each list's lines come up about evenly, and the views agree on all of them.
export const EVENT_VARIANTS = 720720;

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

// Every view gets the same message, so they play the same phrase pair or script.
export function sceneEventMessage(kind: SceneEventKind, random: () => number): SceneEventMessage {
  return { type: "sceneEvent", kind, variant: Math.min(EVENT_VARIANTS - 1, Math.floor(random() * EVENT_VARIANTS)) };
}

// The variant's entry in a list of lines or scripts.
export function eventPick<T>(list: readonly T[], variant: number): T {
  return list[((Math.floor(variant) % list.length) + list.length) % list.length];
}
