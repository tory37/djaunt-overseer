// Pure: the little critters that dash across the Office now and then, themed by scene. Every 10-25 seconds one
// troupe (a lone critter, a hen and her chicks, a fox after a rabbit) crosses the room along an open aisle, edge
// to edge. Bats fly over the room instead. Some stop halfway to look around before they run on.

import type { OfficeLayout, OfficeSceneId } from "./officeLayout";

export type CritterKind =
  | "mouse" | "cat" | "robot"
  | "fox" | "rabbit" | "squirrel" | "hedgehog"
  | "chicken" | "chick" | "sheep"
  | "frog" | "duck" | "duckling" | "turtle"
  | "bat" | "rat" | "beetle"
  | "alien" | "rover"
  | "corgi" | "hamster" | "spider" | "drone" | "raccoon" | "pig" | "butterfly"
  | "otter" | "crab" | "slime" | "moonBunny" | "ufo" | "astronaut";

// run: a quick two-frame scamper. hop: arcs off the ground. fly: flaps over the room. waddle: a slow side-to-side
// rock. roll: glides on wheels.
export type CritterGait = "run" | "hop" | "fly" | "waddle" | "roll";

export interface CritterSpec {
  gait: CritterGait;
  // Pixels a second.
  speed: number;
  // Sprite width in pixels, so a run starts and ends fully off the room.
  width: number;
  // Stops once on the way to look around.
  pauses: boolean;
  // Low-gravity hops: slower and higher.
  floaty?: boolean;
}

export const CRITTERS: Record<CritterKind, CritterSpec> = {
  mouse: { gait: "run", speed: 46, width: 8, pauses: true },
  cat: { gait: "run", speed: 40, width: 12, pauses: false },
  robot: { gait: "roll", speed: 22, width: 10, pauses: true },
  fox: { gait: "run", speed: 44, width: 14, pauses: false },
  rabbit: { gait: "hop", speed: 34, width: 10, pauses: true },
  squirrel: { gait: "run", speed: 42, width: 10, pauses: true },
  hedgehog: { gait: "waddle", speed: 18, width: 9, pauses: false },
  chicken: { gait: "waddle", speed: 20, width: 9, pauses: true },
  chick: { gait: "waddle", speed: 20, width: 5, pauses: false },
  sheep: { gait: "waddle", speed: 16, width: 12, pauses: true },
  frog: { gait: "hop", speed: 24, width: 8, pauses: true },
  duck: { gait: "waddle", speed: 18, width: 9, pauses: false },
  duckling: { gait: "waddle", speed: 18, width: 5, pauses: false },
  turtle: { gait: "waddle", speed: 10, width: 10, pauses: false },
  bat: { gait: "fly", speed: 38, width: 11, pauses: false },
  rat: { gait: "run", speed: 44, width: 10, pauses: true },
  beetle: { gait: "waddle", speed: 16, width: 6, pauses: false },
  alien: { gait: "hop", speed: 22, width: 8, pauses: true, floaty: true },
  rover: { gait: "roll", speed: 18, width: 13, pauses: true },
  corgi: { gait: "run", speed: 40, width: 14, pauses: true },
  hamster: { gait: "roll", speed: 26, width: 8, pauses: false },
  spider: { gait: "run", speed: 34, width: 9, pauses: true },
  drone: { gait: "fly", speed: 30, width: 11, pauses: false },
  raccoon: { gait: "run", speed: 32, width: 14, pauses: true },
  pig: { gait: "waddle", speed: 16, width: 12, pauses: true },
  butterfly: { gait: "fly", speed: 18, width: 7, pauses: false },
  otter: { gait: "run", speed: 36, width: 14, pauses: true },
  crab: { gait: "waddle", speed: 14, width: 9, pauses: true },
  slime: { gait: "hop", speed: 16, width: 8, pauses: true },
  moonBunny: { gait: "hop", speed: 20, width: 10, pauses: true, floaty: true },
  ufo: { gait: "fly", speed: 34, width: 11, pauses: false },
  astronaut: { gait: "hop", speed: 14, width: 7, pauses: true, floaty: true },
};

// The troupes each scene picks from. A troupe moves together at its first member's speed, one behind the other.
export const SCENE_CRITTERS: Record<OfficeSceneId, CritterKind[][]> = {
  office: [["mouse"], ["mouse"], ["cat"], ["mouse", "cat"], ["robot"], ["corgi"], ["hamster"], ["cat", "corgi"]],
  serverRoom: [["mouse"], ["robot"], ["rat"], ["spider"], ["drone"], ["mouse", "robot"], ["drone", "drone"]],
  forest: [["fox"], ["rabbit"], ["squirrel"], ["hedgehog"], ["raccoon"], ["rabbit", "fox"], ["squirrel", "squirrel"]],
  field: [["chicken", "chick", "chick", "chick"], ["sheep"], ["sheep", "sheep"], ["rabbit"], ["pig"], ["butterfly"], ["butterfly", "butterfly"]],
  riverbed: [["frog"], ["frog", "frog"], ["duck", "duckling", "duckling", "duckling"], ["turtle"], ["otter"], ["crab"], ["crab", "crab"]],
  cave: [["bat"], ["bat", "bat"], ["bat", "bat", "bat"], ["rat"], ["beetle"], ["spider"], ["slime"], ["slime", "slime"]],
  moon: [["alien"], ["alien", "alien"], ["alien", "alien", "alien"], ["rover"], ["moonBunny"], ["ufo"], ["astronaut"], ["rover", "astronaut"]],
};

// Seconds between one troupe leaving and the next one starting.
export const CRITTER_GAP_SECONDS = { min: 10, max: 25 };

export function critterGap(random: () => number): number {
  return CRITTER_GAP_SECONDS.min + random() * (CRITTER_GAP_SECONDS.max - CRITTER_GAP_SECONDS.min);
}

export interface CritterRun {
  members: CritterKind[];
  start: number;
  // Pixels; the run goes from fromX toward toX at speed.
  fromX: number;
  toX: number;
  direction: 1 | -1;
  speed: number;
  // Where the critters stand: the bottom of their lane in pixels. A flier's is its cruising height.
  groundY: number;
  // The tile row the troupe crosses on, for drawing it in front of and behind the right things.
  row: number;
  // Pixels between one member and the next.
  spacing: number;
  // Pixels from fromX where the lead stops, and for how long. Undefined for no stop.
  pauseAt: number | undefined;
  pauseSeconds: number;
}

// Rows a troupe can cross without running through desks or props: every tile is plain floor.
export function critterLanes(layout: OfficeLayout): number[] {
  const lanes: number[] = [];
  for (let y = 1; y < layout.rows - 1; y++) {
    if (layout.tiles[y].every((tile) => tile === "floor" || tile === "door")) {
      lanes.push(y);
    }
  }
  return lanes;
}

export function planCritterRun(layout: OfficeLayout, sceneId: OfficeSceneId, now: number, random: () => number, tile: number): CritterRun | undefined {
  const troupes = SCENE_CRITTERS[sceneId];
  const members = troupes[Math.floor(random() * troupes.length) % troupes.length];
  const lead = CRITTERS[members[0]];
  const flies = lead.gait === "fly";
  const lanes = critterLanes(layout);
  if (!flies && lanes.length === 0) {
    return undefined;
  }
  const direction: 1 | -1 = random() < 0.5 ? 1 : -1;
  const roomWidth = layout.cols * tile;
  const widest = Math.max(...members.map((kind) => CRITTERS[kind].width));
  const spacing = widest + 3;
  const trail = spacing * (members.length - 1);
  const margin = widest + 2;
  const fromX = direction === 1 ? -margin : roomWidth + margin;
  const toX = direction === 1 ? roomWidth + margin + trail : -margin - trail;
  let row: number;
  let groundY: number;
  if (flies) {
    // Over everything, somewhere in the room's upper half.
    row = layout.rows;
    groundY = tile * (1.5 + random() * Math.max(1, layout.rows / 2 - 1));
  } else {
    row = lanes[Math.floor(random() * lanes.length) % lanes.length];
    groundY = row * tile + tile - 3;
  }
  const pauses = lead.pauses && random() < 0.6;
  return {
    members,
    start: now,
    fromX,
    toX,
    direction,
    speed: lead.speed * (0.85 + random() * 0.3),
    groundY,
    row,
    spacing,
    pauseAt: pauses ? roomWidth * (0.3 + random() * 0.4) + margin : undefined,
    pauseSeconds: 0.8 + random() * 1.2,
  };
}

export interface CritterPose {
  kind: CritterKind;
  // Center x and the feet's y, in pixels.
  x: number;
  y: number;
  facing: 1 | -1;
  // 0 or 1: which of the two sprite frames.
  frame: number;
  // Stopped to look around.
  still: boolean;
}

// How far the lead has gone after this many seconds, with its stop taken out.
function travelled(run: CritterRun, elapsed: number): { distance: number; still: boolean } {
  const moving = run.speed * elapsed;
  if (run.pauseAt === undefined || moving < run.pauseAt) {
    return { distance: moving, still: false };
  }
  const pauseEnd = run.pauseAt / run.speed + run.pauseSeconds;
  if (elapsed < pauseEnd) {
    return { distance: run.pauseAt, still: true };
  }
  return { distance: run.pauseAt + run.speed * (elapsed - pauseEnd), still: false };
}

export function critterPoses(run: CritterRun, now: number): CritterPose[] {
  const elapsed = Math.max(0, now - run.start);
  const { distance, still } = travelled(run, elapsed);
  return run.members.map((kind, index) => {
    const spec = CRITTERS[kind];
    const x = run.fromX + run.direction * (distance - index * run.spacing);
    // Members step on their own beat so a line of chicks doesn't move in lockstep.
    const beat = elapsed + index * 0.17;
    let y = run.groundY;
    let frame = Math.floor(beat * (spec.gait === "run" ? 10 : 5)) % 2;
    if (!still) {
      if (spec.gait === "hop") {
        const period = spec.floaty === true ? 0.9 : kind === "slime" ? 0.6 : 0.45;
        const phase = (beat % period) / period;
        y -= Math.sin(phase * Math.PI) * (spec.floaty === true ? 9 : kind === "slime" ? 3 : 5);
        frame = phase < 0.85 ? 1 : 0;
      } else if (spec.gait === "fly") {
        y += Math.sin(beat * 3 + index) * 4;
        frame = Math.floor(beat * 8) % 2;
      } else if (spec.gait === "roll") {
        frame = Math.floor(beat * 4) % 2;
      }
    } else {
      // Looking around: the frame flips slowly.
      frame = Math.floor(beat * 1.5) % 2;
    }
    return { kind, x, y, facing: run.direction, frame, still: still && spec.gait !== "fly" };
  });
}

// Done once the last member is past the far edge.
export function critterRunDone(run: CritterRun, now: number): boolean {
  const { distance } = travelled(run, Math.max(0, now - run.start));
  return distance >= Math.abs(run.toX - run.fromX);
}

// What an idle guy says when one runs past.
const ANY_LINES = [
  "aww", "!", "<3", "lol", "o_O", "look!", "who let that in?", "so cute", "hi friend!", "where's it going?", "zoomies!",
  "new coworker?", "is it on payroll?", "I'm naming it", "can we keep it?", "it has places to be", "bye buddy!", "*gasp*",
];
const KIND_LINES: Record<CritterKind, string[]> = {
  mouse: ["eek!", "a mouse!", "squeak", "it took my cheese", "mouse! not the USB kind", "get on a chair!"],
  cat: ["kitty!", "pspsps", "meow?", "it's on the keyboard", "asdfjkl;", "office cat!", "it judged me"],
  robot: ["beep?", "roomba!", "go lil guy", "it's vacuuming my feet", "is it sentient?", "bonk!"],
  fox: ["a fox!", "foxy", "run bun!", "what does it say?", "sly", "a fox in the hen house"],
  rabbit: ["bunny!", "hop hop", "follow it?", "late for a meeting?", "so fluffy", "binky!"],
  squirrel: ["nuts?", "squirrel!", "it has a plan", "parkour!", "it stole my granola"],
  hedgehog: ["spiky!", "hedgie!", "gotta go fast", "tiny feet", "don't pet it"],
  chicken: ["bawk?", "chicken!", "why'd it cross?", "to get to prod", "egg-cellent"],
  chick: ["peep!", "babies!", "tiny!", "following mom", "peep peep"],
  sheep: ["baa", "fluffy", "counting sheep…", "zzz… 1… 2…", "ewe!", "woolly"],
  frog: ["ribbit", "froggy!", "hop!", "it's a prince?", "toad-ally"],
  duck: ["quack!", "ducks!", "rubber duck debugging", "the duck knows", "ask it about the bug"],
  duckling: ["babies!", "quack", "in a row!", "tiny ducks!", "so organized"],
  turtle: ["go go!", "slow…", "steady wins", "our build speed", "slow and steady", "turbo turtle"],
  bat: ["eek!", "bats!", "duck!", "na na na na", "it's in my hair!", "batman?"],
  rat: ["eek!", "rat!", "it's huge", "ratatouille?", "it's a chef"],
  beetle: ["bug!", "shiny", "found the bug", "file a ticket", "it's a feature"],
  alien: ["hi!", "take me!", "ayy", "o_O", "we come in peace", "is it hiring?", "nice antenna"],
  rover: ["rover!", "beep?", "go rover!", "6 wheels!", "sample collected"],
  corgi: ["doggo!", "corgi!", "good boy", "loaf!", "smol legs", "who's a good boy", "zoom zoom"],
  hamster: ["go go!", "hammy!", "wheee", "powering the servers", "cheeks!", "it escaped!"],
  spider: ["eek!", "spider!", "nope", "nope nope nope", "web dev!", "burn it"],
  drone: ["drone?", "bzzz", "o_O", "who's flying that", "delivery!", "it's watching"],
  raccoon: ["trash panda", "bandit!", "it took my lunch", "tiny hands", "it's in the bin"],
  pig: ["oink", "piggy!", "bacon?", "rude.", "when pigs fly…", "mud day!"],
  butterfly: ["pretty", "~", "ooh", "butterfly effect", "don't step on it", "flutter"],
  otter: ["otter!", "sleek", "holding hands?", "it has a rock", "otterly cute"],
  crab: ["crab!", "snip snip", "pinchy", "sideways!", "rustacean!", "crab rave"],
  slime: ["slime!", "blorp", "ew", "it ate my mouse", "gelatinous", "don't touch it"],
  moonBunny: ["moon bun!", "hop hop", "it's making mochi", "space bun", "low-g hops"],
  ufo: ["UFO!", "they're here", "o_O", "beam me up", "act natural", "take the intern"],
  astronaut: ["hi!", "o7", "space!", "nice suit", "hello, houston", "one small step"],
};

export function critterLines(kind: CritterKind): string[] {
  return [...KIND_LINES[kind], ...ANY_LINES];
}
