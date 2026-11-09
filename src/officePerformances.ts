import type { Accessory } from "./pixelGuy";
import type { Personality } from "./officeVisitors";

// Pure: the shows that come to the Office now and then. Someone walks in (a guitarist, a whole band, a caterer with a
// lunch trolley, a comedian, a magician, a DJ), sets up in the middle of the room, and puts on a show. The idle and
// sleeping guys gather round to watch, cheer, laugh, and eat; the busy ones keep typing (lunch gets left on their
// desks). A show's script is a list of lines its lead says over the show's length; some lines cue the crowd.

export type PerformanceKindId = "guitarist" | "band" | "lunch" | "snacks" | "comedian" | "magician" | "dj";

export const PERFORMANCE_KINDS: readonly PerformanceKindId[] = ["guitarist", "band", "lunch", "snacks", "comedian", "magician", "dj"];

// What each performer does: plays an instrument, sings or talks into a mic, pushes the food trolley, does tricks, or
// spins records.
export type ShowRole = "guitar" | "bass" | "drums" | "singer" | "cart" | "comic" | "magician" | "dj";

// How the crowd answers a line.
export type ShowCue = "laugh" | "cheer" | "gasp" | "applause";

export interface ShowLine {
  text: string;
  cue?: ShowCue;
}

export type FoodKind = "pizza" | "taco" | "burger" | "sushi" | "donut" | "cookie" | "iceCream" | "popcorn";

export const FOOD_NAMES: Record<FoodKind, string> = {
  pizza: "pizza", taco: "tacos", burger: "burgers", sushi: "sushi", donut: "donuts", cookie: "cookies", iceCream: "ice cream", popcorn: "popcorn",
};

// The room's effect while the show is on: music notes, a spotlight, disco lights, sparkles, or steam off the food.
export type ShowEffect = "notes" | "spotlight" | "disco" | "sparkles" | "food";

export interface PerformanceSpec {
  id: PerformanceKindId;
  label: string;
  effect: ShowEffect;
  // The first role leads: he says the lines.
  roles: readonly ShowRole[];
  // Seconds of show, low and high.
  length: readonly [number, number];
}

export const PERFORMANCES: Record<PerformanceKindId, PerformanceSpec> = {
  guitarist: { id: "guitarist", label: "Guitarist", effect: "notes", roles: ["guitar"], length: [45, 70] },
  band: { id: "band", label: "Band", effect: "notes", roles: ["singer", "guitar", "bass", "drums"], length: [55, 85] },
  lunch: { id: "lunch", label: "Lunch", effect: "food", roles: ["cart"], length: [40, 60] },
  snacks: { id: "snacks", label: "Snack Cart", effect: "food", roles: ["cart"], length: [30, 45] },
  comedian: { id: "comedian", label: "Comedian", effect: "spotlight", roles: ["comic"], length: [50, 75] },
  magician: { id: "magician", label: "Magician", effect: "sparkles", roles: ["magician"], length: [45, 65] },
  dj: { id: "dj", label: "Dance Party", effect: "disco", roles: ["dj"], length: [45, 70] },
};

// What each role wears. A tie doubles as the magician's bow tie and the singer's scarf.
export interface RoleOutfit {
  shirt: string;
  pants: string;
  accessory?: Accessory;
  accessoryColor?: string;
  tie?: string;
}

export const ROLE_OUTFITS: Record<ShowRole, RoleOutfit> = {
  guitar: { shirt: "#2B2B2B", pants: "#3A4A6B", accessory: "none" },
  singer: { shirt: "#B0303A", pants: "#1D1D1D", accessory: "none", tie: "#F1C24B" },
  bass: { shirt: "#5E3A8C", pants: "#2B2D42", accessory: "none" },
  drums: { shirt: "#F3A712", pants: "#2F3A4A", accessory: "headphones", accessoryColor: "#222831" },
  cart: { shirt: "#F4F4F4", pants: "#2E2E2E", accessory: "none" },
  comic: { shirt: "#3B5BA5", pants: "#22252E", accessory: "glasses", accessoryColor: "#222831" },
  magician: { shirt: "#141620", pants: "#141620", accessory: "none", tie: "#C0392B" },
  dj: { shirt: "#12B886", pants: "#1F1F24", accessory: "headphones", accessoryColor: "#F06595" },
};

const BAND_NAMES = ["Merge Conflict", "The Null Pointers", "Stack Overflow", "Segfault", "The Hotfixes", "Kernel Panic", "Off By One", "The Race Conditions"];
const DJ_NAMES = ["DJ Null", "DJ Segfault", "DJ Byte", "DJ Cache", "DJ Lambda", "DJ 404"];
const MAGICIAN_NAMES = ["The Great Zippo", "Mysterio the Magnificent", "The Amazing Regex", "Dave the Wizard"];
const GUITARIST_NAMES = ["Busker", "Folk Singer", "Guitarist"];
const COMIC_NAMES = ["Comedian", "Open Mic Guy", "Stand-up Comic"];
const LUNCH_MENU: readonly FoodKind[] = ["pizza", "taco", "burger", "sushi"];
const SNACK_MENU: readonly FoodKind[] = ["donut", "cookie", "iceCream", "popcorn"];

const GUITAR_LINES: readonly string[] = [
  "♪ la la la ♪", "Any requests?", "No, not Wonderwall.", "This one's an original.", "♪ my code compiles… ♪", "♪ …on the first try ♪",
  "This one's about a merge conflict.", "♪ ooh, rebase me baby ♪", "Thank you, thank you.", "♪ git push, git pull ♪",
  "This next one's sad. It's about Jira.", "♪ it works on my machine ♪", "♪ sudo make me a sandwich ♪",
];
const BAND_LINES: readonly string[] = [
  "♪ Push it to prod! ♪", "♪ It works on my machine! ♪", "This next one's a ballad.", "♪ Oh, rebase, my rebase ♪",
  "♪ Ninety-nine bugs in the code ♪", "♪ Take one down, patch it around ♪", "Bass solo!", "Drum solo!", "♪ Hello, world ♪",
  "♪ Don't stop deployin' ♪", "♪ We will, we will, mock you ♪", "This one's off our new EP.", "♪ Sweet child of mine (#42) ♪",
];
const DJ_LINES: readonly string[] = [
  "Hands up!", "This one's called 'Merge to Main'!", "Drop the beat!", "Left side, make some noise!", "Right side!",
  "Bass is dropping in 3… 2…", "Everybody, jump!", "Remix of the build server!", "This track compiles!", "One more time!",
];
const MAGIC_TRICKS: readonly ShowLine[][] = [
  [{ text: "Pick a card. Any card." }, { text: "…is this your card?", cue: "gasp" }],
  [{ text: "Nothing up my sleeve…" }, { text: "Abracadabra!", cue: "gasp" }, { text: "Ta-da!", cue: "applause" }],
  [{ text: "For my next trick, I'll make this bug disappear." }, { text: "…and now it's in production.", cue: "laugh" }],
  [{ text: "I will now saw a laptop in half." }, { text: "Don't worry, it's IT's.", cue: "laugh" }],
  [{ text: "Watch the rabbit…" }, { text: "Presto!", cue: "gasp" }],
  [{ text: "Think of a number…" }, { text: "It's 42!", cue: "gasp" }],
  [{ text: "I'll now pull a feature out of this hat." }, { text: "Oh no, it's scope creep.", cue: "laugh" }],
];
const JOKES: readonly [string, string][] = [
  ["Why do programmers prefer dark mode?", "Because light attracts bugs!"],
  ["How many devs to change a light bulb?", "None. That's a hardware problem."],
  ["I'd tell you a UDP joke…", "…but you might not get it."],
  ["Why did the dev go broke?", "He used up all his cache!"],
  ["A SQL query walks into a bar…", "…sees two tables: 'Can I join you?'"],
  ["There are 10 kinds of people.", "Those who get binary, and those who don't."],
  ["Knock knock.", "Race condition. Who's there?"],
  ["I asked the AI to fix my bug.", "Now I have three bugs and a poem."],
  ["Why was the function sad?", "Nobody called it back."],
  ["Debugging is like a crime movie…", "…where you're also the murderer."],
  ["My code works and I don't know why.", "My code broke and I don't know why."],
  ["What's a pirate's favorite language?", "You'd think R, but it's the C!"],
  ["I named my dog 'Five Minutes'.", "Now I tell everyone the build takes Five Minutes."],
  ["Why do Java devs wear glasses?", "Because they don't C#!"],
  ["Our standup is like my standup.", "Too long, and nobody laughs."],
  ["Two bytes meet.", "One asks: 'Are you ill?' 'No, just feeling a bit off.'"],
];
const LUNCH_LINES: readonly string[] = [
  "Come and get it!", "Fresh {food}!", "One each. Okay, two.", "Busy ones, yours is on your desk!", "Hot {food}, coming through!",
  "Who ordered extra {food}?", "There's plenty!", "No pushing!", "Napkins are on the cart.", "Gluten-free on the left!",
];
const SNACK_LINES: readonly string[] = [
  "Snack time!", "Fresh {food}!", "Sugar rush incoming!", "Take two, I won't tell.", "Busy ones, I left some on your desk!",
  "Who wants {food}?", "Last batch!", "Sprinkles are extra. Kidding!",
];

export interface PerformancePlan {
  kind: PerformanceKindId;
  title: string;
  // The performers' titles, in the order of the spec's roles; the first one leads.
  titles: string[];
  lines: ShowLine[];
  closer: ShowLine;
  length: number;
  // What's on the trolley, for the food shows.
  food: FoodKind[];
}

export function planPerformance(random: () => number, kind: PerformanceKindId = pick(PERFORMANCE_KINDS, random)): PerformancePlan {
  const spec = PERFORMANCES[kind];
  const length = spec.length[0] + random() * (spec.length[1] - spec.length[0]);
  switch (kind) {
    case "guitarist": {
      const title = pick(GUITARIST_NAMES, random);
      return {
        kind, title, titles: [title], length, food: [],
        lines: [{ text: "This one's for the night shift.", cue: "cheer" }, ...sample(GUITAR_LINES, 5, random).map((text) => ({ text }))],
        closer: { text: "You've been great! Tip jar's by the door.", cue: "applause" },
      };
    }
    case "band": {
      const name = pick(BAND_NAMES, random);
      return {
        kind, title: `Band: ${name}`, titles: [`${name}: vocals`, `${name}: guitar`, `${name}: bass`, `${name}: drums`], length, food: [],
        lines: [
          { text: `We're ${name}! One, two, three, four!`, cue: "cheer" },
          ...sample(BAND_LINES, 5, random).map((text) => ({ text })),
          { text: "Make some noise!", cue: "cheer" },
        ],
        closer: { text: "Goodnight, office!", cue: "cheer" },
      };
    }
    case "lunch":
    case "snacks": {
      const food = sample(kind === "lunch" ? LUNCH_MENU : SNACK_MENU, 2, random);
      const name = FOOD_NAMES[food[0]];
      const title = kind === "lunch" ? "Lunch Lady" : "Snack Cart";
      return {
        kind, title, titles: [title], length, food,
        lines: [
          { text: kind === "lunch" ? `Lunch is served! ${capitalize(name)} today!` : `Snack cart! ${capitalize(name)}!`, cue: "cheer" },
          ...sample(kind === "lunch" ? LUNCH_LINES : SNACK_LINES, 4, random).map((text) => ({ text: text.replace("{food}", FOOD_NAMES[pick(food, random)]) })),
        ],
        closer: { text: kind === "lunch" ? "Enjoy! Trays back on the cart!" : "That's all, folks!", cue: "applause" },
      };
    }
    case "comedian": {
      const title = pick(COMIC_NAMES, random);
      return {
        kind, title, titles: [title], length, food: [],
        lines: [
          { text: "Is this thing on?" },
          ...sample(JOKES, 4, random).flatMap(([setup, punchline]): ShowLine[] => [{ text: setup }, { text: punchline, cue: "laugh" }]),
        ],
        closer: { text: "You've been a great crowd! Tip your QA!", cue: "applause" },
      };
    }
    case "magician": {
      const title = pick(MAGICIAN_NAMES, random);
      return {
        kind, title, titles: [title], length, food: [],
        lines: [{ text: `Behold! ${title}!`, cue: "applause" }, ...sample(MAGIC_TRICKS, 3, random).flat()],
        closer: { text: "Thank you! I'm here all week!", cue: "applause" },
      };
    }
    case "dj": {
      const title = pick(DJ_NAMES, random);
      return {
        kind, title, titles: [title], length, food: [],
        lines: [{ text: `${title} in the house! Is everybody ready?!`, cue: "cheer" }, ...sample(DJ_LINES, 5, random).map((text) => ({ text, cue: random() < 0.5 ? "cheer" as const : undefined }))],
        closer: { text: "Peace out, office!", cue: "cheer" },
      };
    }
  }
}

// What a guy in the crowd says: his answer to a cue, or now and then something to nobody ("idle"). Asleep guys were
// woken up for it and are a little slow.
const CUE_LINES: Record<ShowCue, Record<Personality | "any", readonly string[]>> = {
  laugh: {
    any: ["HAHA", "lol", "HAHAHA", "*snort*", "lmao", "good one!", "hahaha", "*wheeze*"],
    suckUp: ["HAHAHA! Classic!", "So funny!", "Genius!"],
    grumbler: ["heh.", "*grudging chuckle*", "ok that's funny."],
    deadpan: ["haha. good.", "funny.", "lol."],
    snark: ["I've heard it.", "*snort* fine.", "boo! …lol"],
    eager: ["HAHAHA!!", "I GET IT!", "again! again!"],
  },
  cheer: {
    any: ["WOOO!", "YEAH!", "woo!", "encore!", "\\o/", "let's go!", "WOOHOO!"],
    suckUp: ["Best show ever!", "WOOO!", "Amazing!"],
    grumbler: ["…not bad.", "*nods*", "ok, ok."],
    deadpan: ["woo.", "yay.", "nice."],
    snark: ["play Freebird!", "sellout!", "woo, I guess"],
    eager: ["WOOOOO!", "YEAAAH!", "AAAAH!"],
  },
  gasp: {
    any: ["whoa!", "how?!", "no way!", "!!", "magic!", "*gasp*"],
    suckUp: ["Incredible!", "How?!"],
    grumbler: ["it's a trick.", "*squints*"],
    deadpan: ["huh.", "neat."],
    snark: ["up his sleeve.", "saw that coming."],
    eager: ["HOW?!", "DO IT AGAIN!"],
  },
  applause: {
    any: ["*clap clap*", "bravo!", "encore!", "*claps*", "*applause*"],
    suckUp: ["Bravo! Bravo!", "*standing ovation*"],
    grumbler: ["*slow clap*", "*polite clap*"],
    deadpan: ["*clap.*", "*clap*"],
    snark: ["*slow clap*", "*sarcastic clap*"],
    eager: ["*CLAP CLAP CLAP*", "ENCORE!"],
  },
};

const IDLE_LINES: Record<ShowEffect, readonly string[]> = {
  notes: ["♪", "♪♪", "*bobs head*", "*dances*", "this slaps", "banger", "*air guitar*", "♪ la la ♪"],
  disco: ["♪", "*dances*", "*robot*", "*moonwalks*", "woo!", "*the floss*", "this slaps", "*sprinkler*"],
  food: ["nom", "nom nom", "mmm!", "so good", "*munch*", "best {food} ever", "*crunch*", "seconds?"],
  spotlight: ["hehe", "*sips*", "heh", "*listens*"],
  sparkles: ["how…", "*watches closely*", "ooh", "hmm…"],
};

const SLEEPY_LINES = ["*yawn*", "wha—? oh, nice.", "zz… ♪ …zz", "is it lunch?", "*rubs eyes*"];

export function audienceLine(kind: PerformanceKindId, cue: ShowCue | "idle", personality: Personality, asleep: boolean, random: () => number, food?: FoodKind): string {
  if (asleep && random() < 0.3) {
    return pick(SLEEPY_LINES, random);
  }
  if (cue === "idle") {
    return pick(IDLE_LINES[PERFORMANCES[kind].effect], random).replace("{food}", food === undefined ? "lunch" : FOOD_NAMES[food]);
  }
  const lines = CUE_LINES[cue];
  return random() < 0.35 ? pick(lines[personality], random) : pick(lines.any, random);
}

// How often a show comes (overseer.office.performances), as minutes between shows.
export type PerformanceFrequency = "off" | "rare" | "normal" | "often";

export const PERFORMANCE_FREQUENCIES: Record<Exclude<PerformanceFrequency, "off">, readonly [number, number]> = {
  rare: [30, 60],
  normal: [12, 25],
  often: [4, 8],
};

export function performanceFrequency(value: unknown): PerformanceFrequency {
  if (value === false) {
    return "off";
  }
  return value === "off" || (typeof value === "string" && value in PERFORMANCE_FREQUENCIES) ? (value as PerformanceFrequency) : "normal";
}

// Seconds until the next show; the first one comes a little sooner.
export function performanceGap(random: () => number, frequency: Exclude<PerformanceFrequency, "off"> = "normal", first = false): number {
  const [low, high] = PERFORMANCE_FREQUENCIES[frequency];
  const minutes = first ? low * (0.4 + random() * 0.6) : low + random() * (high - low);
  return minutes * 60;
}

export function isPerformanceKind(value: unknown): value is PerformanceKindId {
  return typeof value === "string" && (PERFORMANCE_KINDS as readonly string[]).includes(value);
}

function pick<T>(list: readonly T[], random: () => number): T {
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}

// Up to count items in a random order, no repeats.
function sample<T>(list: readonly T[], count: number, random: () => number): T[] {
  const pool = [...list];
  const result: T[] = [];
  while (result.length < count && pool.length > 0) {
    result.push(pool.splice(Math.min(pool.length - 1, Math.floor(random() * pool.length)), 1)[0]);
  }
  return result;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
