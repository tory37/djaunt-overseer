// Pure: your own guy in the Office. He's always in, at his own two-monitor station in the middle of the room, and acts out the scene events (ERROR, HACK,
// DEFENSE) on the same beats as the other views: his screen changes, he jumps up, types like mad, and cheers.
// Between events he types, leans back, and gets up for a sip. Time is in seconds.

import type { Facing, Pose } from "./pixelGuy";
import { DEFENSE_BEATS, DEFENSE_SCRIPTS, ERROR_FLASH_SECONDS, EVENT_SECONDS, HACK_PHRASES, HACK_REVEAL_SECONDS, SceneEventKind } from "./sceneEventSchedule";

export const YOU_ID = "you";

// What his monitor shows: work, a red error, falling green code, access granted, a red alert, the defense progress
// bar, a blue shield, or the screensaver while he's away from the keys.
export type YourScreen = "code" | "error" | "matrix" | "granted" | "alert" | "progress" | "shield" | "idle";

export interface YourEvent {
  kind: SceneEventKind;
  variant: number;
  // Seconds since the event started.
  age: number;
}

export interface YourReaction {
  pose: Pose;
  facing: Facing;
  frame: number;
  seated: boolean;
  // Pixels he hops up off the floor.
  hop: number;
  bubble: string | undefined;
  screen: YourScreen;
  // The defense progress bar, 0 to 100.
  progress: number;
  // Pixels the room shakes this frame.
  shake: number;
}

// A short beat after each event before he's back to work.
export const AFTERMATH_SECONDS = 1.8;

const ERROR_LINES = [
  "WHAT?!", "NOOO", "not again", "it worked yesterday", "who pushed?!", "ugh", "WHY", "it was ONE line", "I didn't touch it!",
  "oh no oh no", "my code!", "it's on fire", "ctrl+z!!", "on a Friday?!", "but the tests!", "AAAA",
];
const ERROR_AFTER = [
  "*sigh*", "fine.", "git blame…", "rollback", "it's fine.", "coffee first", "it was DNS", "who wrote this? oh.",
  "revert revert", "I need a minute", "hotfix time", "*stares*",
];
const HACK_START = ["hmm", "watch this", "hold my coffee", "easy", "ok ok", "stand back", "let me try", "*cracks knuckles*"];
const HACK_IN = ["I'm in.", "we're in.", "I'm in. I think.", "too easy.", "bingo.", "and… in.", "jackpot.", "access!"];
const HACK_AFTER = ["B-)", "too easy", "heh", "nailed it", "hacker voice: I'm in", "10x dev", "mic drop", "no big deal", "ez", "*bows*"];
const DEFENSE_AFTER = ["phew", "close one", "B-)", "gg", "not on my watch", "I need a nap", "*wipes brow*", "back to work", "that was fun", "again? no."];

// What the rest of the room says when an event hits.
export const ROOM_REACTIONS: Record<SceneEventKind, readonly string[]> = {
  error: [
    "?!", "o_O", "!", "uh oh", "not me", "wasn't me", "who did it", "rip", "F", "oof", "yikes", "I saw nothing",
    "*hides*", "rollback!", "blame QA", "it's DNS", "my stuff's fine", "*backs away*",
  ],
  hack: [
    "!", "whoa", "o_O", "★", "lol", "nice!", "teach me", "is that legal?", "hacker!", "so cool", "matrix!",
    "I'm calling legal", "wow", "how?!", "show off", "+1",
  ],
  defense: [
    "!!", "eek", "!", "?!", "go go", "hurry!", "type faster!", "we're under attack!", "unplug it!", "*panics*",
    "you got this!", "help!", "I'll get the extinguisher", "is it safe?", "HOLD IT",
  ],
};

// The event plays for its length plus the aftermath.
export function yourEventSeconds(kind: SceneEventKind): number {
  return EVENT_SECONDS[kind] + AFTERMATH_SECONDS;
}

const pickLine = (lines: readonly string[], variant: number) => lines[((Math.floor(variant) % lines.length) + lines.length) % lines.length];
const typing = (time: number, rate: number) => Math.floor(time * rate) % 2;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const base = (time: number): YourReaction => ({
  pose: "type",
  facing: "up",
  frame: typing(time, 4),
  seated: true,
  hop: 0,
  bubble: undefined,
  screen: "code",
  progress: 0,
  shake: 0,
});

// Between events: a 26 second loop of typing, leaning back, and a stretch with a sip of coffee. The offset staggers
// where in the loop he starts.
export function yourIdleReaction(time: number, offset = 0): YourReaction {
  const reaction = base(time);
  const loop = (((time + offset) % 26) + 26) % 26;
  if (loop >= 17 && loop < 21) {
    return { ...reaction, pose: "sit", frame: 0, screen: "idle" };
  }
  if (loop >= 21 && loop < 24) {
    return { ...reaction, pose: "drink", facing: "down", frame: 0, seated: false, screen: "idle" };
  }
  if (loop >= 24) {
    return { ...reaction, pose: "stretch", facing: "down", frame: 0, seated: false, screen: "idle" };
  }
  return reaction;
}

export function yourReaction(event: YourEvent | undefined, time: number, offset = 0): YourReaction {
  if (event === undefined || event.age < 0 || event.age >= yourEventSeconds(event.kind)) {
    return yourIdleReaction(time, offset);
  }
  switch (event.kind) {
    case "error":
      return errorReaction(event, time);
    case "hack":
      return hackReaction(event, time);
    case "defense":
      return defenseReaction(event, time);
  }
}

function errorReaction({ age, variant }: YourEvent, time: number): YourReaction {
  const reaction = base(time);
  if (age >= EVENT_SECONDS.error) {
    return { ...reaction, pose: "sit", frame: 0, bubble: pickLine(ERROR_AFTER, variant), screen: "error" };
  }
  const flashing = age < ERROR_FLASH_SECONDS;
  if (age < 0.3) {
    return { ...reaction, screen: "error", shake: 1 };
  }
  if (age < 1.4) {
    // Jumps out of his chair and turns around.
    return { ...reaction, pose: "stand", facing: "down", frame: 0, seated: false, hop: Math.floor(age / 0.18) % 2 === 0 ? 2 : 0, bubble: "!!", screen: "error", shake: flashing ? 1 : 0 };
  }
  // Hands on his head.
  return { ...reaction, pose: "stretch", facing: "down", frame: 0, seated: false, bubble: pickLine(ERROR_LINES, variant), screen: "error", shake: flashing ? 1 : 0 };
}

function hackReaction({ age, variant }: YourEvent, time: number): YourReaction {
  const reaction = base(time);
  const [line, answer] = HACK_PHRASES[((variant % HACK_PHRASES.length) + HACK_PHRASES.length) % HACK_PHRASES.length];
  if (age >= EVENT_SECONDS.hack) {
    return { ...reaction, pose: "sit", frame: 0, bubble: pickLine(HACK_AFTER, variant), screen: "granted" };
  }
  if (age < 0.6) {
    return { ...reaction, frame: typing(time, 10), bubble: pickLine(HACK_START, variant), screen: "matrix" };
  }
  if (age < HACK_REVEAL_SECONDS) {
    return { ...reaction, frame: typing(time, 16), bubble: age >= 1.4 ? pickLine(HACK_IN, variant) : undefined, screen: "matrix" };
  }
  // Up out of the chair, arms in the air.
  const cheering = Math.floor(age / 0.3) % 2 === 0;
  return { ...reaction, pose: cheering ? "stretch" : "stand", facing: "down", frame: 0, seated: false, hop: cheering ? 2 : 0, bubble: age < 4 ? line : answer, screen: "granted" };
}

function defenseReaction({ age, variant }: YourEvent, time: number): YourReaction {
  const reaction = base(time);
  const lines = DEFENSE_SCRIPTS[((variant % DEFENSE_SCRIPTS.length) + DEFENSE_SCRIPTS.length) % DEFENSE_SCRIPTS.length];
  if (age >= EVENT_SECONDS.defense) {
    return { ...reaction, pose: "sit", frame: 0, bubble: pickLine(DEFENSE_AFTER, variant), screen: "shield", progress: 100 };
  }
  const beat = DEFENSE_BEATS.filter((start) => age >= start).length - 1;
  const beatAge = age - DEFENSE_BEATS[beat];
  const progress = defenseProgress(beat, beatAge, age);
  switch (beat) {
    case 0:
      // On his feet at the alarm.
      return { ...reaction, pose: "stand", facing: "down", frame: 0, seated: false, hop: Math.floor(age / 0.22) % 2 === 0 ? 1 : 0, bubble: lines[0], screen: "alert", progress };
    case 1:
      return { ...reaction, frame: typing(time, 12), bubble: lines[1], screen: "progress", progress };
    case 2:
      return { ...reaction, frame: typing(time, 20), bubble: lines[2], screen: "progress", progress, shake: beatAge > 0.8 ? 1 : 0 };
    default: {
      const cheering = Math.floor(beatAge / 0.3) % 2 === 0;
      return { ...reaction, pose: cheering ? "stretch" : "stand", facing: "down", frame: 0, seated: false, hop: cheering ? 2 : 0, bubble: beatAge < 1.1 ? lines[3] : lines[4], screen: "shield", progress };
    }
  }
}

// The same climb as the Djaunt view's percent: most of the way while blocking, then a crawl to 99, then 100.
export function defenseProgress(beat: number, beatAge: number, age: number): number {
  if (beat <= 0) {
    return 0;
  }
  if (beat >= 3) {
    return 100;
  }
  if (beat === 1) {
    return Math.floor(easeInOut(clamp01(beatAge / 2)) * 72);
  }
  const progress = clamp01(beatAge / 1.6);
  return Math.max(0, Math.min(99, Math.floor(72 + 27 * Math.sqrt(progress) + Math.sin(age * 31) * 2 * (1 - progress))));
}

// A line for someone else in the room, or undefined for a guy who doesn't look up.
export function roomReaction(kind: SceneEventKind, random: () => number): string | undefined {
  if (random() < 0.3) {
    return undefined;
  }
  const lines = ROOM_REACTIONS[kind];
  return lines[Math.min(lines.length - 1, Math.floor(random() * lines.length))];
}
