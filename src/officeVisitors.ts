import { Accessory, hashSeed } from "./pixelGuy";

// Pure: people from other departments who drop by the Office now and then, up to five at once. Each walks in and says
// a line or two to the room. Some walk right back out; others hang around a while, chatting, getting coffee, and
// looming over busy guys' desks. Sometimes it's a manager. Each guy has a personality, picked from his seed, that
// decides how he answers: the suck-up says "OK BOSS!", the reasonable ones grumble.

export type Personality = "suckUp" | "grumbler" | "deadpan" | "snark" | "eager";

export interface VisitorKind {
  id: string;
  // Shown when you hover over the visitor.
  title: string;
  boss: boolean;
  shirt: string;
  pants: string;
  // A tie for the bosses, drawn over the shirt.
  tie?: string;
  // Fixed for some departments (IT's glasses); otherwise the visitor's own.
  accessory?: Accessory;
  weight: number;
  openers: readonly string[];
  closers: readonly string[];
  // What he says while hanging around, on top of his openers.
  smallTalk: readonly string[];
}

const BOSS_CLOSERS = ["Carry on!", "My door is always open!", "Love it. Carry on.", "Anyway!", "Great chat.", "Keep it up!"];
const DEPT_CLOSERS = ["ok bye!", "thx!", "…", "Carry on.", "Just a heads up!", "That's all!"];
const BOSS_TALK = ["How's it going?", "What are we working on?", "Is that done yet?", "Walk me through it.", "Love it. Ship it.", "Any blockers?", "Let's sync later."];
const DEPT_TALK = ["Busy day?", "Did you see the game?", "Weekend plans?", "Is that coffee fresh?", "Nice setup.", "So what do you do here?", "Love the plant."];

export const VISITOR_KINDS: readonly VisitorKind[] = [
  {
    id: "manager", title: "Manager", boss: true, shirt: "#E8E8E8", pants: "#3A3F58", tie: "#C0392B", accessory: "none", weight: 4,
    openers: [
      "Are you all getting work done in here?", "Keep up the synergy!", "Let's circle back on that.", "Quick sync? No? Great.",
      "Who's on the TPS reports?", "Let's move the needle, people!", "Can we take this offline?", "Remember, we're a family!",
      "Great hustle, team!", "Pizza party Friday. Probably.", "Let's put a pin in it.", "Love the energy in here!",
    ],
    closers: BOSS_CLOSERS,
    smallTalk: BOSS_TALK,
  },
  {
    id: "vp", title: "VP of Synergy", boss: true, shirt: "#2B2D42", pants: "#1D1E2C", tie: "#F1C24B", accessory: "none", weight: 1,
    openers: [
      "Let's leverage our core synergies.", "We're pivoting. Again.", "Think outside the box!", "I needed this yesterday.",
      "Can we make it more AI?", "Let's boil the ocean!", "Big things coming, team.",
    ],
    closers: BOSS_CLOSERS,
    smallTalk: BOSS_TALK,
  },
  {
    id: "hr", title: "HR", boss: false, shirt: "#E07A9B", pants: "#5B4B5E", weight: 1,
    openers: ["Mandatory fun at 3pm!", "Who has the birthday card?", "Please finish your trainings.", "Who microwaved fish?", "Benefits close today!"],
    closers: DEPT_CLOSERS,
    smallTalk: DEPT_TALK,
  },
  {
    id: "it", title: "IT", boss: false, shirt: "#4A7C59", pants: "#2F3A33", accessory: "glasses", weight: 1,
    openers: ["Have you tried turning it off and on?", "Who clicked the phishing link?", "Rebooting everything. Don't panic.", "Passwords need 40 chars now.", "Is this plugged in?"],
    closers: DEPT_CLOSERS,
    smallTalk: DEPT_TALK,
  },
  {
    id: "sales", title: "Sales", boss: false, shirt: "#F4A259", pants: "#3D3B4F", weight: 1,
    openers: ["Can it do this by Friday?", "I already sold that feature.", "The client wants it to pop.", "Can we add AI to it?", "Need a demo in 5 min!"],
    closers: DEPT_CLOSERS,
    smallTalk: DEPT_TALK,
  },
  {
    id: "marketing", title: "Marketing", boss: false, shirt: "#B56CE0", pants: "#33264A", weight: 1,
    openers: ["Can the logo be bigger?", "We need it to go viral.", "Let's rebrand!", "More gradients!", "Is this on brand?"],
    closers: DEPT_CLOSERS,
    smallTalk: DEPT_TALK,
  },
  {
    id: "facilities", title: "Facilities", boss: false, shirt: "#E8C547", pants: "#3B4A5A", accessory: "cap", weight: 1,
    openers: ["Fire drill at 2!", "Don't touch the thermostat.", "Who unplugged the fridge?", "Wet floor. Probably."],
    closers: DEPT_CLOSERS,
    smallTalk: DEPT_TALK,
  },
  {
    id: "accounting", title: "Accounting", boss: false, shirt: "#8D99AE", pants: "#2B2D42", accessory: "glasses", weight: 1,
    openers: ["Who expensed a dragon?", "Receipts, people!", "Budget's frozen. Again.", "Was that a business lunch?"],
    closers: DEPT_CLOSERS,
    smallTalk: DEPT_TALK,
  },
  {
    id: "intern", title: "Intern", boss: false, shirt: "#6FB3E0", pants: "#44546A", weight: 1,
    openers: ["Where's the printer?", "Is this the meeting?", "Coffee run, anyone?", "What does a PR do?", "Am I paid for this?"],
    closers: DEPT_CLOSERS,
    smallTalk: DEPT_TALK,
  },
  {
    id: "legal", title: "Legal", boss: false, shirt: "#5C4B51", pants: "#2A2326", weight: 1,
    openers: ["Don't put that in writing.", "Stop naming servers after exes.", "Allegedly.", "Did anyone sign this?"],
    closers: DEPT_CLOSERS,
    smallTalk: DEPT_TALK,
  },
];

// How each personality answers a boss, and anyone else.
const REACTIONS: Record<Personality, { boss: readonly string[]; other: readonly string[] }> = {
  suckUp: {
    boss: ["OK BOSS!", "You got it, boss!", "Love that, boss!", "Synergy!!", "Yes sir!", "Great idea, boss!"],
    other: ["Great point!", "Totally!", "So true!", "Love it!"],
  },
  grumbler: {
    boss: ["*grumble*", "*grumble grumble*", "*sigh*", "mhm.", "sure."],
    other: ["*grumble*", "*sigh*", "not now…", "ugh."],
  },
  deadpan: {
    boss: ["Wow ok.", "cool.", "noted.", "k.", "riveting."],
    other: ["Wow ok.", "cool.", "neat.", "k."],
  },
  snark: {
    boss: ["lol", "uh huh.", "*eye roll*", "sure thing.", "classic."],
    other: ["lol no.", "sure, buddy.", "*eye roll*", "lmao"],
  },
  eager: {
    boss: ["On it!", "!", "can do!", "aye aye!"],
    other: ["ooh!", "me!", "!", "yes!"],
  },
};

// Most of the room is reasonable; a couple are suck-ups.
const PERSONALITIES: readonly [Personality, number][] = [["suckUp", 2], ["grumbler", 4], ["deadpan", 3], ["snark", 2], ["eager", 1]];

export function personalityOf(seed: string): Personality {
  const total = PERSONALITIES.reduce((sum, [, weight]) => sum + weight, 0);
  // A different stream of the hash than the look uses, so personality doesn't follow hair color.
  let roll = hashSeed(`${seed}|personality`) % total;
  for (const [personality, weight] of PERSONALITIES) {
    roll -= weight;
    if (roll < 0) {
      return personality;
    }
  }
  return "grumbler";
}

export interface VisitPlan {
  kind: VisitorKind;
  // Said to the room on arrival.
  lines: string[];
  // Seconds he hangs around after his lines; 0 walks right back out.
  stay: number;
  // Said on the way out after hanging around.
  farewell: string | undefined;
}

// At most this many visitors in the room at once.
export const MAX_VISITORS = 5;

export function planVisit(random: () => number): VisitPlan {
  const total = VISITOR_KINDS.reduce((sum, kind) => sum + kind.weight, 0);
  let roll = random() * total;
  let kind = VISITOR_KINDS[VISITOR_KINDS.length - 1];
  for (const candidate of VISITOR_KINDS) {
    roll -= candidate.weight;
    if (roll < 0) {
      kind = candidate;
      break;
    }
  }
  const lines = [pick(kind.openers, random)];
  const stay = visitorStay(random);
  const closer = random() < 0.7 ? pick(kind.closers, random) : undefined;
  if (stay === 0 && closer !== undefined) {
    lines.push(closer);
  }
  return { kind, lines, stay, farewell: stay === 0 ? undefined : closer };
}

// How long a visitor hangs around: a few say their piece and go, most stay a minute or two, some settle in.
export function visitorStay(random: () => number): number {
  const roll = random();
  if (roll < 0.35) {
    return 0;
  }
  if (roll < 0.75) {
    return 45 + random() * 105;
  }
  return 180 + random() * 420;
}

// What a visitor says while hanging around.
export function visitorSmallTalk(kind: VisitorKind): string[] {
  return [...kind.openers, ...kind.smallTalk];
}

// What a guy says back, or undefined when he lets it go. A suck-up never lets a boss go; asleep guys mumble.
export function visitorReaction(personality: Personality, boss: boolean, asleep: boolean, random: () => number): string | undefined {
  if (asleep) {
    return random() < 0.4 ? "zzz…" : undefined;
  }
  if (!(personality === "suckUp" && boss) && random() >= 0.65) {
    return undefined;
  }
  return pick(REACTIONS[personality][boss ? "boss" : "other"], random);
}

// How often visitors come (overseer.office.visitors), as seconds between arrivals.
export type VisitorFrequency = "off" | "rare" | "normal" | "often" | "packed";

export const VISITOR_FREQUENCIES: Record<Exclude<VisitorFrequency, "off">, readonly [number, number]> = {
  rare: [180, 360],
  normal: [60, 150],
  often: [25, 75],
  packed: [8, 30],
};

export function visitorFrequency(value: unknown): VisitorFrequency {
  if (value === false) {
    return "off";
  }
  return value === "off" || (typeof value === "string" && value in VISITOR_FREQUENCIES) ? (value as VisitorFrequency) : "normal";
}

// Seconds until the next visitor arrives; the first comes sooner.
export function visitorGap(random: () => number, frequency: Exclude<VisitorFrequency, "off"> = "normal", first = false): number {
  const [low, high] = VISITOR_FREQUENCIES[frequency];
  return first ? low * 0.4 + random() * low * 0.6 : low + random() * (high - low);
}

function pick<T>(list: readonly T[], random: () => number): T {
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}
