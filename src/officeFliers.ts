// Pure: the creatures that fly over the Office now and then, themed by scene, apart from the critters on the floor.
// Every 25-60 seconds one flight (a lone hawk, a V of geese, a swarm of fireflies, a space whale) crosses the room
// from off one edge to off the other. Each kind has its own way of moving: flapping, gliding, swooping low over the
// guys, darting about like a bug, drifting like a balloon, or streaking down like a meteor. Outdoors, some only come
// out by day or by night.

import type { OfficeLayout, OfficeSceneId } from "./officeLayout";

export type FlierKind =
  | "pigeon" | "paperPlane" | "moth" | "balloon" | "sparrow"
  | "fly" | "microDrone" | "robotBird" | "ghost"
  | "owl" | "crow" | "bluebird" | "hawk" | "firefly"
  | "goose" | "swallow" | "bee" | "hotAirBalloon"
  | "heron" | "dragonfly" | "kingfisher" | "gull" | "mallard"
  | "dragon" | "wisp" | "phoenix"
  | "rocket" | "satellite" | "spaceWhale" | "meteor" | "starJelly";

// flap: a steady bob with the wingbeat. glide: long and level, a few beats then a glide. swoop: dips low over the
// room mid-crossing and climbs out. dart: a bug's jittery zigzag that hangs in the air now and then. drift: slow
// and floaty, swaying. streak: fast and straight, dropping as it goes.
export type FlierMotion = "flap" | "glide" | "swoop" | "dart" | "drift" | "streak";

// How a flight of several holds together: a V, one behind the other, or a loose cloud.
export type FlierFormation = "v" | "line" | "swarm";

export interface FlierSpec {
  motion: FlierMotion;
  // Pixels a second.
  speed: number;
  // Sprite width in pixels, so a flight starts and ends fully off the room.
  width: number;
  // Wingbeats a second; 0 keeps the first frame (the second may still blink on its own beat).
  flap: number;
  formation: FlierFormation;
  // Lights itself: drawn over the room's night tint instead of under it.
  glow?: boolean;
  // See-through, for ghosts.
  alpha?: number;
  // Leaves a short trail of this color behind it.
  trail?: string;
  // Big enough to throw a shadow on the floor as it passes.
  shadow?: boolean;
  // Outdoors, only comes out then.
  time?: "day" | "night";
}

export const FLIERS: Record<FlierKind, FlierSpec> = {
  pigeon: { motion: "flap", speed: 30, width: 11, flap: 5, formation: "line" },
  paperPlane: { motion: "glide", speed: 26, width: 10, flap: 0, formation: "line" },
  moth: { motion: "dart", speed: 14, width: 7, flap: 9, formation: "swarm" },
  balloon: { motion: "drift", speed: 8, width: 5, flap: 1, formation: "line" },
  sparrow: { motion: "flap", speed: 36, width: 10, flap: 7, formation: "line" },
  fly: { motion: "dart", speed: 20, width: 5, flap: 14, formation: "swarm" },
  microDrone: { motion: "dart", speed: 22, width: 7, flap: 12, formation: "swarm" },
  robotBird: { motion: "flap", speed: 30, width: 11, flap: 5, formation: "line" },
  ghost: { motion: "drift", speed: 10, width: 7, flap: 2, formation: "swarm", glow: true, alpha: 0.7 },
  owl: { motion: "glide", speed: 24, width: 11, flap: 3, formation: "line", time: "night" },
  crow: { motion: "flap", speed: 32, width: 11, flap: 5, formation: "line" },
  bluebird: { motion: "flap", speed: 30, width: 9, flap: 7, formation: "line", time: "day" },
  hawk: { motion: "swoop", speed: 42, width: 13, flap: 3, formation: "line", shadow: true, time: "day" },
  firefly: { motion: "dart", speed: 10, width: 3, flap: 2, formation: "swarm", glow: true, time: "night" },
  goose: { motion: "flap", speed: 30, width: 14, flap: 4, formation: "v" },
  swallow: { motion: "swoop", speed: 50, width: 11, flap: 8, formation: "line", time: "day" },
  bee: { motion: "dart", speed: 16, width: 6, flap: 16, formation: "swarm", time: "day" },
  hotAirBalloon: { motion: "drift", speed: 6, width: 11, flap: 1, formation: "line", shadow: true, time: "day" },
  heron: { motion: "glide", speed: 22, width: 16, flap: 2, formation: "line", shadow: true },
  dragonfly: { motion: "dart", speed: 30, width: 11, flap: 16, formation: "swarm", time: "day" },
  kingfisher: { motion: "swoop", speed: 48, width: 10, flap: 9, formation: "line", time: "day" },
  gull: { motion: "glide", speed: 28, width: 13, flap: 3, formation: "line" },
  mallard: { motion: "flap", speed: 34, width: 12, flap: 6, formation: "v" },
  dragon: { motion: "flap", speed: 30, width: 20, flap: 2.5, formation: "line", shadow: true },
  wisp: { motion: "drift", speed: 12, width: 5, flap: 4, formation: "swarm", glow: true },
  phoenix: { motion: "glide", speed: 40, width: 13, flap: 3, formation: "line", glow: true, trail: "#F8A23A" },
  rocket: { motion: "glide", speed: 45, width: 13, flap: 10, formation: "line", trail: "#F8C84A" },
  satellite: { motion: "glide", speed: 12, width: 13, flap: 1, formation: "line" },
  spaceWhale: { motion: "drift", speed: 9, width: 22, flap: 0.8, formation: "line", shadow: true },
  meteor: { motion: "streak", speed: 90, width: 4, flap: 8, formation: "line", glow: true, trail: "#F8A23A" },
  starJelly: { motion: "drift", speed: 8, width: 7, flap: 1.5, formation: "swarm", glow: true },
};

// The flights each scene picks from. A flight moves together at its first member's speed.
export const SCENE_FLIERS: Record<OfficeSceneId, FlierKind[][]> = {
  office: [["pigeon"], ["pigeon", "pigeon"], ["paperPlane"], ["moth"], ["balloon"], ["sparrow", "sparrow", "sparrow"]],
  serverRoom: [["fly"], ["fly", "fly"], ["microDrone", "microDrone", "microDrone"], ["robotBird"], ["ghost"], ["paperPlane"]],
  forest: [["owl"], ["crow", "crow", "crow"], ["bluebird", "bluebird"], ["hawk"], ["firefly", "firefly", "firefly", "firefly", "firefly"], ["crow"]],
  field: [["goose", "goose", "goose", "goose", "goose"], ["swallow", "swallow"], ["bee"], ["bee", "bee"], ["hotAirBalloon"], ["crow", "crow"]],
  riverbed: [["heron"], ["dragonfly"], ["dragonfly", "dragonfly"], ["kingfisher"], ["gull", "gull"], ["mallard", "mallard", "mallard"]],
  cave: [["dragon"], ["wisp", "wisp", "wisp"], ["phoenix"], ["ghost"], ["moth", "moth"]],
  moon: [["rocket"], ["satellite"], ["spaceWhale"], ["meteor"], ["meteor", "meteor"], ["starJelly", "starJelly"]],
};

// Seconds between one flight leaving and the next one starting.
export const FLIER_GAP_SECONDS = { min: 25, max: 60 };

export function flierGap(random: () => number): number {
  return FLIER_GAP_SECONDS.min + random() * (FLIER_GAP_SECONDS.max - FLIER_GAP_SECONDS.min);
}

// The flights a scene can send now. Night is undefined indoors, where nothing keeps hours.
export function fliersNow(sceneId: OfficeSceneId, night: boolean | undefined): FlierKind[][] {
  const troupes = SCENE_FLIERS[sceneId];
  if (night === undefined) {
    return troupes;
  }
  return troupes.filter((troupe) => {
    const time = FLIERS[troupe[0]].time;
    return time === undefined || time === (night ? "night" : "day");
  });
}

export interface Flight {
  members: FlierKind[];
  start: number;
  // Pixels; the lead flies from fromX toward toX at speed.
  fromX: number;
  toX: number;
  direction: 1 | -1;
  speed: number;
  // The lead's cruising height in pixels: the middle of its body.
  baseY: number;
  // How far a swoop dips or a streak drops over the crossing, in pixels.
  drop: number;
  // Each member's place behind and beside the lead, in pixels, and its own phase for bobbing.
  offsets: { back: number; y: number; phase: number }[];
  // Where a big flier's shadow runs along the floor, in pixels.
  shadowY: number;
}

export function planFlight(layout: OfficeLayout, sceneId: OfficeSceneId, now: number, random: () => number, tile: number, night?: boolean): Flight | undefined {
  const troupes = fliersNow(sceneId, night);
  if (troupes.length === 0 || layout.rows < 3) {
    return undefined;
  }
  const members = troupes[Math.floor(random() * troupes.length) % troupes.length];
  const lead = FLIERS[members[0]];
  const direction: 1 | -1 = random() < 0.5 ? 1 : -1;
  const roomWidth = layout.cols * tile;
  const roomHeight = layout.rows * tile;
  const widest = Math.max(...members.map((kind) => FLIERS[kind].width));
  const offsets = members.map((_, index) => formationSpot(lead.formation, index, widest, random));
  const trail = Math.max(...offsets.map((offset) => offset.back)) + (lead.trail === undefined ? 0 : 24);
  const margin = widest + 4;
  const fromX = direction === 1 ? -margin : roomWidth + margin;
  const toX = direction === 1 ? roomWidth + margin + trail : -margin - trail;
  // Up in the room's top part; drifters and big ones keep a little lower so they're seen.
  const high = lead.motion === "streak" ? 0.08 : 0.15;
  const baseY = roomHeight * (high + random() * 0.25) + 4;
  let drop = 0;
  if (lead.motion === "swoop") {
    drop = roomHeight * (0.3 + random() * 0.2);
  } else if (lead.motion === "streak") {
    drop = roomHeight * (0.15 + random() * 0.2);
  }
  return {
    members,
    start: now,
    fromX,
    toX,
    direction,
    speed: lead.speed * (0.85 + random() * 0.3),
    baseY,
    drop,
    offsets,
    shadowY: roomHeight * (0.55 + random() * 0.3),
  };
}

function formationSpot(formation: FlierFormation, index: number, width: number, random: () => number): { back: number; y: number; phase: number } {
  const phase = random() * Math.PI * 2;
  if (index === 0) {
    return { back: 0, y: 0, phase };
  }
  if (formation === "v") {
    const rank = Math.ceil(index / 2);
    return { back: rank * (width * 0.7), y: (index % 2 === 1 ? -1 : 1) * rank * 4, phase };
  }
  if (formation === "swarm") {
    return { back: index * width * 0.6 + random() * width, y: (random() - 0.5) * 14, phase };
  }
  return { back: index * (width + 4), y: (random() - 0.5) * 6, phase };
}

export interface FlierPose {
  kind: FlierKind;
  // The middle of the sprite, in pixels.
  x: number;
  y: number;
  facing: 1 | -1;
  // 0 or 1: which of the two sprite frames.
  frame: number;
}

function leadDistance(flight: Flight, elapsed: number): number {
  return flight.speed * elapsed;
}

export function flierPoses(flight: Flight, now: number): FlierPose[] {
  const elapsed = Math.max(0, now - flight.start);
  const lead = FLIERS[flight.members[0]];
  const total = Math.abs(flight.toX - flight.fromX);
  const distance = leadDistance(flight, elapsed);
  return flight.members.map((kind, index) => {
    const spec = FLIERS[kind];
    const offset = flight.offsets[index];
    const t = elapsed + offset.phase;
    let along = distance - offset.back;
    let y = flight.baseY + offset.y;
    let frame = Math.floor(t * spec.flap * 2) % 2;
    const progress = Math.max(0, Math.min(1, along / total));
    switch (lead.motion) {
      case "flap":
        y += Math.sin(t * spec.flap * Math.PI * 2) * 1.5 + Math.sin(t * 0.9) * 3;
        break;
      case "glide":
        y += Math.sin(t * 0.7) * 4;
        // A few beats, then a long glide with the wings held.
        if (Math.sin(t * 0.8) > -0.3) {
          frame = 0;
        }
        break;
      case "swoop":
        y += Math.sin(progress * Math.PI) * flight.drop + Math.sin(t * 1.3) * 2;
        // Wings tucked through the low part of the dive.
        if (progress > 0.3 && progress < 0.7) {
          frame = 1;
        }
        break;
      case "dart":
        along += Math.sin(t * 2.7) * 10 + Math.sin(t * 6.1) * 3;
        y += Math.sin(t * 3.3) * 6 + Math.sin(t * 7.9) * 2;
        break;
      case "drift":
        along += Math.sin(t * 0.5) * 4;
        y += Math.sin(t * 0.8) * 5;
        break;
      case "streak":
        y += progress * flight.drop;
        break;
    }
    return { kind, x: flight.fromX + flight.direction * along, y, facing: flight.direction, frame };
  });
}

// Done once the last member (and its trail) is past the far edge.
export function flightDone(flight: Flight, now: number): boolean {
  return leadDistance(flight, Math.max(0, now - flight.start)) >= Math.abs(flight.toX - flight.fromX) + 12;
}

// What an idle guy says when one flies over.
const ANY_LINES = ["look up!", "whoa", "o_O", "!", "up there!", "what was that?", "did you see that?", "incoming!", "*ducks*", "so high!", "bye!"];
const KIND_LINES: Record<FlierKind, string[]> = {
  pigeon: ["coo", "a pigeon?", "how'd it get in", "it wants my sandwich", "office pigeon", "coo coo"],
  paperPlane: ["nice throw", "who made that", "wheee", "it's a memo", "air mail!", "10/10 fold"],
  moth: ["moth!", "lamp's over there", "it loves my monitor", "the light!", "brother?"],
  balloon: ["a balloon!", "party?", "bye balloon", "whose birthday?", "it's getting away", "99 of those?"],
  sparrow: ["tweet!", "birds!", "tweet tweet", "small birb", "chirp"],
  fly: ["bzzz", "a bug!", "found the bug", "it's in my coffee", "swat it!", "debug it"],
  microDrone: ["bzzz", "swarm!", "who's flying those", "are they mapping us?", "drone show!"],
  robotBird: ["beep tweet", "robo bird!", "tweet.exe", "it's a bot", "firmware bird"],
  ghost: ["ghost!", "boo?", "ghost in the machine", "it's the old server", "who you gonna call?", "*shivers*"],
  owl: ["hoo?", "owl!", "hoo hoo", "night owl", "it's judging me", "wise"],
  crow: ["caw!", "crows", "omen?", "a murder!", "they remember faces", "caw caw"],
  bluebird: ["bluebird!", "tweet!", "pretty", "so blue", "a happy little bird"],
  hawk: ["hawk!", "duck!", "hide the mice", "it's diving!", "hawk eye", "screech!"],
  firefly: ["fireflies!", "pretty", "ooh", "tiny lights", "make a wish", "blink blink"],
  goose: ["honk!", "geese!", "honk honk", "peace was never an option", "don't make eye contact", "HONK"],
  swallow: ["zoom!", "swallows!", "African or European?", "so fast", "aerobatics!"],
  bee: ["bzzz", "bee!", "don't move", "save the bees", "busy bee", "it's just a bee!"],
  hotAirBalloon: ["balloon!", "hi up there!", "take me", "drop a sandbag", "nice basket", "up up and away"],
  heron: ["heron!", "so graceful", "long legs", "fishing trip", "it's tall"],
  dragonfly: ["dragonfly!", "zip zip", "tiny dragon", "helicopter bug", "so shiny"],
  kingfisher: ["kingfisher!", "so blue", "dive!", "got a fish!", "fancy bird"],
  gull: ["gulls!", "mine?", "watch your lunch", "MINE MINE", "fries thief", "squawk"],
  mallard: ["quack!", "ducks!", "V for victory", "flying ducks!", "duck squad"],
  dragon: ["DRAGON!", "hide the gold", "run!", "it's beautiful", "I'm calling HR", "accounting will hear about this", "fire!"],
  wisp: ["wisps…", "don't follow them", "ooh", "it's calling me", "spooky", "don't."],
  phoenix: ["phoenix!", "so warm", "make a wish", "it's on fire. on purpose.", "rise!", "it'll be back"],
  rocket: ["rocket!", "launch!", "o7", "3… 2… 1…", "to the moon!", "deploy!"],
  satellite: ["satellite!", "wave!", "hi nasa", "is it watching?", "5 bars!", "ping!"],
  spaceWhale: ["space whale!", "it's huge", "hello friend", "it's singing", "so majestic", "whale hello there"],
  meteor: ["shooting star!", "make a wish", "meteor!", "is that coming here?", "wish: no bugs"],
  starJelly: ["space jellies", "glowy", "ooh", "don't touch them", "so floaty", "jelly!"],
};

export function flierLines(kind: FlierKind): string[] {
  return [...KIND_LINES[kind], ...ANY_LINES];
}
