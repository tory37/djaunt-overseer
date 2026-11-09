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
  | "otter" | "crab" | "slime" | "moonBunny" | "ufo" | "astronaut"
  | "hermitCrab" | "sandpiper" | "penguin" | "arcticFox" | "polarBear" | "seal"
  | "lizard" | "scorpion" | "camel" | "tumbleweed" | "roadrunner"
  | "starfish" | "octopus" | "seahorse" | "book" | "broom";

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
  hermitCrab: { gait: "waddle", speed: 12, width: 9, pauses: true },
  sandpiper: { gait: "run", speed: 48, width: 8, pauses: true },
  penguin: { gait: "waddle", speed: 14, width: 7, pauses: true },
  arcticFox: { gait: "run", speed: 44, width: 15, pauses: false },
  polarBear: { gait: "waddle", speed: 14, width: 16, pauses: true },
  seal: { gait: "waddle", speed: 12, width: 12, pauses: true },
  lizard: { gait: "run", speed: 46, width: 12, pauses: true },
  scorpion: { gait: "run", speed: 24, width: 11, pauses: true },
  camel: { gait: "waddle", speed: 14, width: 16, pauses: true },
  tumbleweed: { gait: "hop", speed: 36, width: 9, pauses: false },
  roadrunner: { gait: "run", speed: 64, width: 14, pauses: true },
  starfish: { gait: "waddle", speed: 8, width: 9, pauses: false },
  octopus: { gait: "waddle", speed: 14, width: 10, pauses: true },
  seahorse: { gait: "hop", speed: 12, width: 7, pauses: true, floaty: true },
  book: { gait: "hop", speed: 22, width: 8, pauses: true },
  broom: { gait: "hop", speed: 20, width: 7, pauses: true },
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
  beach: [["crab"], ["crab", "crab", "crab"], ["hermitCrab"], ["sandpiper", "sandpiper", "sandpiper"], ["turtle"], ["corgi"]],
  snowfield: [["penguin"], ["penguin", "penguin", "penguin", "penguin"], ["arcticFox"], ["polarBear"], ["seal"], ["rabbit"]],
  desert: [["lizard"], ["lizard", "lizard"], ["scorpion"], ["camel"], ["camel", "camel"], ["tumbleweed"], ["roadrunner"]],
  reef: [["crab"], ["crab", "crab"], ["starfish"], ["octopus"], ["hermitCrab"], ["seahorse", "seahorse"]],
  library: [["cat"], ["mouse"], ["mouse", "cat"], ["book"], ["book", "book", "book"], ["broom"], ["slime"]],
  rooftop: [["rat"], ["rat", "cat"], ["raccoon"], ["raccoon", "raccoon"], ["cat"], ["drone"], ["corgi"]],
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
const ANY_LINES = ["aww", "!", "<3", "lol", "o_O", "look!"];
const KIND_LINES: Record<CritterKind, string[]> = {
  mouse: ["eek!", "a mouse!", "squeak"],
  cat: ["kitty!", "pspsps", "meow?"],
  robot: ["beep?", "roomba!", "go lil guy"],
  fox: ["a fox!", "foxy", "run bun!"],
  rabbit: ["bunny!", "hop hop"],
  squirrel: ["nuts?", "squirrel!"],
  hedgehog: ["spiky!", "hedgie!"],
  chicken: ["bawk?", "chicken!"],
  chick: ["peep!", "babies!"],
  sheep: ["baa", "fluffy"],
  frog: ["ribbit", "froggy!"],
  duck: ["quack!", "ducks!"],
  duckling: ["babies!", "quack"],
  turtle: ["go go!", "slow…"],
  bat: ["eek!", "bats!", "duck!"],
  rat: ["eek!", "rat!"],
  beetle: ["bug!", "shiny"],
  alien: ["hi!", "take me!", "ayy", "o_O"],
  rover: ["rover!", "beep?"],
  corgi: ["doggo!", "corgi!", "good boy"],
  hamster: ["go go!", "hammy!", "wheee"],
  spider: ["eek!", "spider!", "nope"],
  drone: ["drone?", "bzzz", "o_O"],
  raccoon: ["trash panda", "bandit!"],
  pig: ["oink", "piggy!"],
  butterfly: ["pretty", "~", "ooh"],
  otter: ["otter!", "sleek"],
  crab: ["crab!", "snip snip", "pinchy"],
  slime: ["slime!", "blorp", "ew"],
  moonBunny: ["moon bun!", "hop hop"],
  ufo: ["UFO!", "they're here", "o_O"],
  astronaut: ["hi!", "o7", "space!"],
  hermitCrab: ["nice shell", "house hunting?"],
  sandpiper: ["peep peep", "zoom!"],
  penguin: ["penguin!", "waddle waddle", "noot"],
  arcticFox: ["snow fox!", "so fluffy"],
  polarBear: ["BEAR", "don't move", "big floof"],
  seal: ["seal!", "arf arf", "blubber buddy"],
  lizard: ["lizard!", "zip"],
  scorpion: ["nope", "scorpion!", "check your boots"],
  camel: ["camel!", "humps!", "spits?"],
  tumbleweed: ["tumbleweed…", "…", "*whistles*"],
  roadrunner: ["meep meep", "so fast", "zoom!"],
  starfish: ["starfish!", "go go go", "patrick?"],
  octopus: ["octopus!", "8 arms", "so smart"],
  seahorse: ["seahorse!", "tiny horse", "ooh"],
  book: ["a book!", "come back", "overdue"],
  broom: ["it sweeps itself", "magic!", "o_O"],
};

export function critterLines(kind: CritterKind): string[] {
  return [...KIND_LINES[kind], ...ANY_LINES];
}
