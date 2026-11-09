// Pure: the pixel guys' races. A seed picks one, every race as likely as any other, humans included. Each race has
// its own skins, hair, eyes, and three colors of its own (markA to markC), and draws over the plain guy after he's
// drawn: horns, ears, tusks, snouts, tails, wings, and for a few a new lower body.

import type { Accessory, HairStyle, Pose } from "./pixelGuy";
import { Canvas, PaletteKey } from "./pixelCanvas";

export const RACE_IDS = [
  "human", "orc", "goblin", "elf", "darkElf", "dwarf", "greyAlien", "greenAlien", "demon", "vampire", "zombie",
  "skeleton", "troll", "gnome", "fae", "undine", "lizardfolk", "catfolk", "wolffolk", "minotaur", "robot", "cyclops",
  "squidfolk", "mushroom", "golem", "ghost", "slime", "dryad", "jackalfolk", "harpy", "centaur", "naga", "merfolk",
  "satyr", "dragonkin", "ogre",
] as const;

export type RaceId = typeof RACE_IDS[number];

// Which way the guy is seen: front (facing down), back (facing up), or side (facing right; left is mirrored).
export type RaceSide = "front" | "back" | "side";

export interface RaceView {
  side: RaceSide;
  pose: Pose;
  step: number;
  seated: boolean;
  hairStyle: HairStyle;
}

export interface RaceSpec {
  id: RaceId;
  label: string;
  // Each list is picked from by the seed; a missing list keeps the plain guy's pick.
  skins?: readonly string[];
  hairs?: readonly string[];
  hairStyles?: readonly HairStyle[];
  eyes?: readonly string[];
  marks?: readonly [readonly string[], readonly string[], readonly string[]];
  // Accessories the race's head can't wear, like a cap over horns. They're skipped when drawn.
  blocks?: readonly Accessory[];
  // Always a full beard in the hair color.
  beard?: boolean;
  // Bare arms in the skin color: bones, bark, feathers.
  sleeveless?: boolean;
  // Short guys lose a row of leg; big guys fill out to the frame's edges.
  size?: "short" | "big";
  draw?: (canvas: Canvas, view: RaceView) => void;
}

const HUMAN_SKINS = ["#F9D4B4", "#EDB98A", "#D08B5B", "#AE5D29", "#8D4A28", "#614335"];
const HUMAN_HAIRS = ["#2C1B12", "#5A3825", "#A0522D", "#D9A441", "#E8D9A0", "#B8B8B8", "#E2504B", "#2E2E2E"];
const BALD: readonly HairStyle[] = ["bald"];
const HATLESS: readonly Accessory[] = ["cap", "headphones"];
// Faces a beard doesn't grow on: shells, snouts, beaks, and bone.
const BEARDLESS: readonly Accessory[] = ["beard", "fullBeard"];
const IVORY = "#F2EAD3";
const BONE = "#E8DCC0";
const GOLD = "#E8B931";
const DARK = "#1A1A22";

// Sets each point and its mirror across the middle of the frame, for front and back views.
function both(canvas: Canvas, points: readonly (readonly [number, number])[], key: PaletteKey): void {
  for (const [x, y] of points) {
    canvas.set(x, y, key);
    canvas.set(9 - x, y, key);
  }
}

function points(canvas: Canvas, list: readonly (readonly [number, number])[], key: PaletteKey): void {
  for (const [x, y] of list) {
    canvas.set(x, y, key);
  }
}

// Walking sways a tail or a coil one pixel each way.
function sway(view: RaceView): number {
  return view.pose === "walk" ? (view.step === 1 ? -1 : view.step === 3 ? 1 : 0) : 0;
}

function clearLegs(canvas: Canvas, fromY = 13): void {
  canvas.rect(0, fromY, 10, 16 - fromY, null);
}

// Ears out to the sides and up, for elves.
function pointedEars(canvas: Canvas, view: RaceView): void {
  if (view.side === "side") {
    points(canvas, [[4, 3], [3, 2], [2, 1]], "skin");
    canvas.set(4, 4, "skinShade");
    return;
  }
  both(canvas, [[1, 3], [1, 2], [0, 1]], "skin");
}

// Tall ears on top of the head, for cat, wolf, and jackal folk.
function topEars(canvas: Canvas, view: RaceView, tall: boolean, inner: PaletteKey | undefined): void {
  if (view.side === "side") {
    points(canvas, [[4, 0], [5, 0], [4, -1]], "skin");
    if (tall) {
      canvas.set(4, -2, "skin");
    }
    return;
  }
  both(canvas, [[2, 0], [3, 0], [2, -1]], "skin");
  if (tall) {
    both(canvas, [[2, -2]], "skin");
  }
  if (inner !== undefined && view.side === "front") {
    both(canvas, [[2, 0]], inner);
  }
}

// A snout out in front of the face in the side view; the front view gets a lighter muzzle.
function snout(canvas: Canvas, view: RaceView, muzzle: PaletteKey, nose: PaletteKey): void {
  if (view.side === "side") {
    canvas.rect(8, 4, 2, 2, muzzle);
    canvas.set(9, 4, nose);
    return;
  }
  if (view.side === "front") {
    canvas.rect(3, 5, 4, 2, muzzle);
    canvas.rect(4, 5, 2, 1, nose);
  }
}

function tusks(canvas: Canvas, view: RaceView): void {
  if (view.side === "front") {
    both(canvas, [[3, 5]], "markA");
  } else if (view.side === "side") {
    canvas.set(8, 5, "markA");
  }
}

// A tail off the back: down between the legs from behind, a tip past the hip from the front, out behind from the side.
function tail(canvas: Canvas, view: RaceView, key: PaletteKey, tip?: PaletteKey): void {
  const swing = sway(view);
  if (view.side === "side") {
    points(canvas, [[2, 11], [1, 12], [0, 12 + swing]], key);
    if (tip !== undefined) {
      canvas.set(0, 13 + swing, tip);
    }
  } else if (view.side === "back") {
    points(canvas, [[5, 12], [6, 13], [7 + swing, 14]], key);
    if (tip !== undefined) {
      canvas.set(8 + swing, 14, tip);
    }
  } else {
    points(canvas, [[9, 11 + swing], [9, 10 + swing]], key);
    if (tip !== undefined) {
      canvas.set(9, 9 + swing, tip);
    }
  }
}

// Wings on the back: spread from behind, their tips over the shoulders from the front, folded from the side.
function wings(canvas: Canvas, view: RaceView, membrane: PaletteKey, edge: PaletteKey): void {
  if (view.side === "back") {
    both(canvas, [[0, 6], [0, 7], [0, 8], [0, 9], [1, 6], [1, 7], [1, 8]], membrane);
    both(canvas, [[0, 5], [1, 5], [0, 10]], edge);
  } else if (view.side === "front") {
    both(canvas, [[0, 5], [0, 6], [0, 7]], membrane);
    both(canvas, [[0, 4]], edge);
  } else {
    canvas.rect(1, 6, 2, 5, membrane);
    points(canvas, [[2, 5], [1, 5], [0, 7]], edge);
  }
}

// A horse's body from the waist down, four hooves under it, and its tail. The human's hands rest on its back.
function centaurBody(canvas: Canvas, view: RaceView): void {
  const swing = sway(view);
  const hands = [0, 1, 8, 9].filter((x) => canvas.get(x, 11) === "skin");
  if (view.side === "side") {
    const hand = canvas.get(5 + Math.max(-1, Math.min(1, swing)), 11) === "skin";
    clearLegs(canvas, 10);
    canvas.rect(3, 10, 4, 1, "shirtShade");
    if (view.seated) {
      // Lying down, legs folded under.
      canvas.rect(1, 11, 7, 3, "markA");
      canvas.rect(1, 14, 7, 1, "markAShade");
      points(canvas, [[2, 15], [3, 15], [6, 15], [7, 15]], "markB");
      points(canvas, [[0, 11], [0, 12], [0, 13]], "hair");
      return;
    }
    canvas.rect(1, 11, 8, 2, "markA");
    canvas.rect(1, 13, 8, 1, "markAShade");
    canvas.set(8, 11, "markAShade");
    const front = 7 + swing;
    const back = 2 - swing;
    canvas.rect(front, 14, 1, 1, "markA");
    canvas.rect(back, 14, 1, 1, "markAShade");
    canvas.set(front - 1, 14, "markAShade");
    canvas.set(back + 1, 14, "markA");
    canvas.rect(front - 1, 15, 2, 1, "markB");
    canvas.rect(back, 15, 2, 1, "markB");
    points(canvas, [[0, 11], [0, 12], [0, 13], [0, 14 - Math.abs(swing)]], "hair");
    if (hand) {
      canvas.set(5, 10, "skin");
    }
    return;
  }
  clearLegs(canvas, 11);
  canvas.rect(1, 11, 8, 2, "markA");
  canvas.rect(2, 13, 6, 1, "markAShade");
  hands.forEach((x) => canvas.set(x, 10, "skin"));
  if (view.seated) {
    canvas.rect(1, 13, 8, 1, "markA");
    both(canvas, [[1, 14], [2, 14], [3, 14]], "markB");
  } else {
    const leftUp = view.pose === "walk" && view.step === 1;
    const rightUp = view.pose === "walk" && view.step === 3;
    canvas.rect(2, 14, 2, leftUp ? 0 : 1, "markA");
    canvas.rect(6, 14, 2, rightUp ? 0 : 1, "markA");
    canvas.rect(2, leftUp ? 14 : 15, 2, 1, "markB");
    canvas.rect(6, rightUp ? 14 : 15, 2, 1, "markB");
  }
  if (view.side === "back") {
    points(canvas, [[4, 11], [4, 12], [5, 12], [4, 13], [5, 13], [5, 14 + Math.abs(swing)]], "hair");
  }
}

function nagaBody(canvas: Canvas, view: RaceView): void {
  const swing = sway(view);
  if (view.side === "side") {
    clearLegs(canvas, 12);
    canvas.rect(3, 12, 4, 1, "markA");
    canvas.rect(4, 13, 4, 1, "markA");
    canvas.rect(3 + swing, 14, 6, 1, "markA");
    canvas.rect(1 - swing, 15, 8, 1, "markAShade");
    points(canvas, [[6, 12], [7, 13]], "markB");
    canvas.set(0, 15 - (swing === 0 ? 0 : 1), "markAShade");
    return;
  }
  clearLegs(canvas, 12);
  canvas.rect(2, 12, 6, 1, "markA");
  canvas.rect(3, 13, 4, 1, "markA");
  canvas.rect(2 + swing, 14, 6, 1, "markA");
  canvas.rect(1 + swing, 15, 8, 1, "markAShade");
  if (view.side === "front") {
    canvas.rect(4, 12, 2, 2, "markB");
  } else {
    canvas.set(9, 15, "markAShade");
  }
}

function merfolkBody(canvas: Canvas, view: RaceView): void {
  const swing = sway(view);
  clearLegs(canvas, 12);
  if (view.side === "side") {
    canvas.rect(3, 12, 4, 1, "markA");
    canvas.rect(4, 13, 3, 1, "markA");
    canvas.rect(5, 14, 3, 1, "markAShade");
    points(canvas, [[8, 13 + swing], [8, 14], [9, 15], [8, 15], [7, 15]], "markB");
    return;
  }
  canvas.rect(2, 12, 6, 1, "markA");
  canvas.rect(3, 13, 4, 1, "markA");
  canvas.rect(4, 14, 2, 1, "markAShade");
  canvas.rect(2 + swing, 15, 2, 1, "markB");
  canvas.rect(6 + swing, 15, 2, 1, "markB");
  canvas.rect(4 + swing, 15, 2, 1, "markAShade");
}

// Goat legs: the trousers stop at the hips, fur below, hooves for shoes.
function satyrLegs(canvas: Canvas, view: RaceView): void {
  canvas.recolor("pants", "markA", 13);
  canvas.recolor("pantsShade", "markAShade", 13);
  canvas.recolor("skin", "markA", 13, 14);
  canvas.recolor("shoes", "markB");
  if (view.side === "side" && !view.seated && view.pose !== "walk") {
    // The hock bends back.
    clearLegs(canvas, 13);
    canvas.rect(4, 13, 2, 1, "markA");
    canvas.rect(3, 14, 2, 1, "markAShade");
    canvas.rect(4, 15, 2, 1, "markB");
  }
  // Shaggy fur: every other pixel a shade darker, and a tuft over each hoof.
  canvas.each((key, x, y) => {
    if (key === "markA" && y >= 13 && (x + y) % 2 === 0) {
      canvas.set(x, y, "markAShade");
    }
    if (key === "markB" && canvas.get(x, y - 1) === null && view.side !== "side") {
      canvas.set(x, y - 1, "markAShade");
    }
  });
}

function sheet(canvas: Canvas, view: RaceView): void {
  for (const [from, to] of [["shirt", "skin"], ["shirtShade", "skinShade"], ["pants", "skinShade"], ["pantsShade", "skinShade"], ["sleeve", "skin"], ["sleeveShade", "skinShade"]] as const) {
    canvas.recolor(from, to);
  }
  clearLegs(canvas, 13);
  const left = view.side === "side" ? 3 : 2;
  const width = view.side === "side" ? 5 : 6;
  canvas.rect(left, 13, width, 1, "skin");
  const phase = view.step % 2;
  for (let x = left + phase; x < left + width; x += 2) {
    canvas.set(x, 14, "skinShade");
  }
}

function blob(canvas: Canvas, view: RaceView): void {
  const squish = view.pose === "walk" && view.step % 2 === 1;
  clearLegs(canvas, 13);
  canvas.rect(1, 13, 8, 1, "skin");
  canvas.rect(squish ? 1 : 0, 14, squish ? 8 : 10, 1, "skin");
  canvas.rect(squish ? 1 : 0, 15, squish ? 8 : 10, 1, "skinShade");
  if (view.side !== "side") {
    both(canvas, [[2, 1]], "markA");
    canvas.set(2, 1, null);
    canvas.set(7, 1, null);
    if (view.side === "front") {
      canvas.set(3, 2, "markA");
    }
  } else {
    canvas.set(3, 1, null);
    canvas.set(6, 2, "markA");
  }
}

export const RACES: readonly RaceSpec[] = [
  { id: "human", label: "Human" },
  {
    id: "orc", label: "Orc",
    skins: ["#6B8E3A", "#5A7D2E", "#7A9A4A", "#4E6B2A"],
    hairs: ["#1A1A1A", "#2C1B12", "#3B3B3B"],
    hairStyles: ["bald", "mohawk", "short", "long", "bun"],
    eyes: ["#C0392B", "#1A1A2E"],
    marks: [[IVORY], [IVORY], [IVORY]],
    size: "big",
    draw: (canvas, view) => {
      tusks(canvas, view);
      if (view.side === "front") {
        canvas.rect(3, 3, 4, 1, "skinShade");
        both(canvas, [[1, 3]], "skin");
      } else if (view.side === "side") {
        canvas.rect(5, 3, 3, 1, "skinShade");
      }
    },
  },
  {
    id: "goblin", label: "Goblin",
    skins: ["#9DB84A", "#8FAE3E", "#A9C25A", "#7FA03A"],
    hairs: ["#2C1B12", "#4A3A2A", "#1A1A1A"],
    hairStyles: ["bald", "bald", "spiky", "mohawk"],
    eyes: ["#E8C12A", "#E04A2A"],
    marks: [["#C77A5A"], [IVORY], [IVORY]],
    size: "short",
    draw: (canvas, view) => {
      if (view.side === "side") {
        points(canvas, [[3, 3], [2, 2], [1, 1]], "skin");
        canvas.set(2, 3, "skinShade");
        points(canvas, [[8, 4], [9, 5], [8, 5]], "skin");
        return;
      }
      both(canvas, [[1, 2], [1, 3], [0, 2], [0, 1]], "skin");
      both(canvas, [[1, 3]], "markA");
    },
  },
  {
    id: "elf", label: "Elf",
    skins: ["#F9D4B4", "#EDB98A", "#F3E0C8", "#D08B5B"],
    hairs: ["#E8D9A0", "#F2E6C8", "#D9A441", "#2C1B12", "#A0522D", "#E8E8F0"],
    hairStyles: ["long", "long", "bob", "bun", "short"],
    eyes: ["#2E86AB", "#4CB944", "#1A1A2E"],
    draw: pointedEars,
  },
  {
    id: "darkElf", label: "Dark Elf",
    skins: ["#6E5F86", "#5C4F73", "#7D6E94", "#4E4462"],
    hairs: ["#F2F2F2", "#D9D9E8", "#C8C8D8"],
    hairStyles: ["long", "long", "bob", "mohawk", "bun"],
    eyes: ["#E04A4A", "#F2A93B"],
    draw: pointedEars,
  },
  {
    id: "dwarf", label: "Dwarf",
    hairs: ["#A0522D", "#E2504B", "#5A3825", "#D9A441", "#B8B8B8", "#2C1B12"],
    hairStyles: ["bald", "short", "long", "bun"],
    beard: true,
    size: "short",
    marks: [[GOLD], [GOLD], [GOLD]],
    draw: (canvas, view) => {
      // A gold bead at the end of the beard.
      if (view.side === "front") {
        canvas.set(4, 7, "markA");
      }
    },
  },
  {
    id: "greyAlien", label: "Grey Alien",
    skins: ["#A9B1B8", "#9AA3AA", "#B8C0C6", "#8E979E"],
    hairStyles: BALD,
    marks: [["#0B0B12"], ["#5A6A7A"], ["#0B0B12"]],
    blocks: [...HATLESS, ...BEARDLESS],
    draw: (canvas, view) => {
      if (view.side === "side") {
        canvas.rect(3, -1, 4, 1, "skin");
        canvas.rect(2, 0, 6, 1, "skin");
        canvas.rect(2, 1, 1, 3, "skin");
        canvas.set(8, 4, null);
        points(canvas, [[6, 3], [7, 3], [7, 4]], "markA");
        canvas.set(6, 4, "skin");
        canvas.set(4, 6, null);
        return;
      }
      canvas.rect(3, -1, 4, 1, "skin");
      canvas.rect(2, 0, 6, 1, "skin");
      both(canvas, [[1, 1], [1, 2], [1, 3]], "skin");
      canvas.set(2, 6, null);
      if (view.side === "front") {
        canvas.rect(3, 4, 4, 1, "skin");
        both(canvas, [[2, 3], [3, 3], [3, 4]], "markA");
        canvas.rect(4, 6, 2, 1, "skinShade");
        canvas.set(3, 6, null);
        canvas.set(6, 6, null);
      }
    },
  },
  {
    id: "greenAlien", label: "Green Alien",
    skins: ["#7BD389", "#5FC46F", "#8EE0A0", "#6CC9B0"],
    hairStyles: BALD,
    eyes: ["#1A1A2E", "#D7263D"],
    marks: [["#4E9A5B"], ["#F2E14C", "#F28FB8", "#7CF2E0"], ["#1A1A2E"]],
    blocks: ["cap", ...BEARDLESS],
    draw: (canvas, view) => {
      if (view.side === "side") {
        points(canvas, [[5, 0], [6, -1]], "markA");
        canvas.set(7, -2, "markB");
        points(canvas, [[4, 0], [3, -1]], "markA");
        canvas.set(3, -2, "markB");
        return;
      }
      both(canvas, [[3, 0], [2, -1]], "markA");
      both(canvas, [[2, -2]], "markB");
      if (view.side === "front") {
        // A third eye.
        canvas.set(4, 3, "eye");
      }
    },
  },
  {
    id: "demon", label: "Demon",
    skins: ["#C0392B", "#A93226", "#D35445", "#8E2C48"],
    hairs: ["#1A1A1A", "#2C1B12", "#3B2142"],
    hairStyles: ["long", "short", "bob", "bald", "spiky"],
    eyes: ["#F5D04A"],
    marks: [[BONE, "#C9B8A0", "#F2E6C8"], ["#4A3A3A"], ["#8E2C48"]],
    blocks: ["cap"],
    draw: (canvas, view) => {
      if (view.side === "side") {
        points(canvas, [[5, 0], [5, -1], [4, -2]], "markA");
      } else {
        both(canvas, [[2, 0], [1, -1], [2, -2]], "markA");
      }
      tail(canvas, view, "skinShade", "markA");
    },
  },
  {
    id: "vampire", label: "Vampire",
    skins: ["#EDE6E3", "#DCD6E0", "#F2ECEA"],
    hairs: ["#111111", "#2C1B12", "#3A3A4A", "#E8E8F0"],
    hairStyles: ["short", "short", "long", "bob"],
    eyes: ["#C0392B"],
    marks: [["#2A0F17", "#1A1A22"], ["#FFFFFF"], ["#8E1B2B"]],
    draw: (canvas, view) => {
      if (view.side === "side") {
        points(canvas, [[2, 5], [2, 6], [3, 6], [2, 7]], "markA");
        canvas.set(7, 6, "markB");
        return;
      }
      both(canvas, [[2, 6], [1, 5], [1, 6], [1, 7]], "markA");
      if (view.side === "front") {
        both(canvas, [[2, 7]], "markC");
        both(canvas, [[4, 6]], "markB");
        if (view.hairStyle !== "bald") {
          canvas.rect(4, 2, 2, 1, "hair");
        }
      } else {
        canvas.rect(2, 6, 6, 1, "markA");
      }
    },
  },
  {
    id: "zombie", label: "Zombie",
    skins: ["#8FA67A", "#7E9670", "#9DAF8A", "#A0A88A"],
    hairs: ["#4A4A3A", "#6A5A4A", "#3A3A3A"],
    hairStyles: ["short", "long", "bald", "spiky"],
    marks: [["#E6E6D0"], ["#5A2A2A"], ["#6A7A5A"]],
    draw: (canvas, view) => {
      if (view.side === "front") {
        canvas.set(3, 4, "markA");
        canvas.set(6, 4, "markB");
        canvas.set(5, 2, "markC");
        canvas.set(7, 11, "skin");
        canvas.set(6, 10, "skin");
      } else if (view.side === "side") {
        canvas.set(6, 4, "markA");
        canvas.set(5, 11, "skin");
      }
    },
  },
  {
    id: "skeleton", label: "Skeleton",
    skins: ["#E8E4D4", "#DCD6C4", "#F0ECE0"],
    hairStyles: BALD,
    marks: [[DARK], ["#B8B2A0"], [DARK]],
    sleeveless: true,
    blocks: BEARDLESS,
    draw: (canvas, view) => {
      if (view.side === "front") {
        canvas.rect(3, 3, 1, 2, "markA");
        canvas.rect(6, 3, 1, 2, "markA");
        canvas.set(4, 5, "markB");
        canvas.set(5, 5, "markB");
        [3, 5].forEach((x) => canvas.set(x, 6, "markB"));
      } else if (view.side === "side") {
        canvas.rect(6, 3, 1, 2, "markA");
        canvas.set(8, 4, null);
        canvas.set(7, 6, "markB");
        canvas.set(5, 6, "markB");
      }
    },
  },
  {
    id: "troll", label: "Troll",
    skins: ["#7F9AA8", "#6E8B8F", "#8BA3A0", "#6A8A7A"],
    hairs: ["#3D6B4F", "#E2504B", "#2E2E2E", "#7C5CE0"],
    hairStyles: ["mohawk", "mohawk", "spiky", "long"],
    eyes: ["#F2C94C"],
    marks: [[IVORY], [IVORY], [IVORY]],
    size: "big",
    draw: (canvas, view) => {
      if (view.side === "side") {
        points(canvas, [[8, 4], [9, 4], [8, 5], [9, 5]], "skinShade");
        canvas.set(7, 6, "markA");
        points(canvas, [[3, 3], [2, 2]], "skin");
        return;
      }
      both(canvas, [[1, 3], [0, 2]], "skin");
      if (view.side === "front") {
        canvas.rect(4, 4, 2, 2, "skinShade");
        both(canvas, [[3, 6]], "markA");
      }
    },
  },
  {
    id: "gnome", label: "Gnome",
    hairs: ["#F2F2F2", "#E8E8E0", "#B8B8B8"],
    hairStyles: ["bald", "short", "curly"],
    marks: [["#C0392B", "#2E86AB", "#4CB944", "#7950F2"], ["#F2F2F2"], ["#F2C94C"]],
    blocks: HATLESS,
    size: "short",
    draw: (canvas, view) => {
      // A tall pointed hat, its tip flopped back, and a white beard.
      if (view.side === "side") {
        canvas.rect(2, 0, 6, 2, "markA");
        canvas.rect(3, -1, 4, 1, "markA");
        canvas.rect(2, -2, 3, 1, "markA");
        canvas.set(1, -2, "markA");
        canvas.rect(5, 6, 3, 1, "markB");
        canvas.set(7, 5, "markB");
        return;
      }
      canvas.rect(1, 1, 8, 1, "markA");
      canvas.rect(2, 0, 6, 1, "markA");
      canvas.rect(3, -1, 4, 1, "markA");
      canvas.rect(4, -2, 3, 1, "markA");
      canvas.set(7, -2, "markA");
      if (view.side === "front") {
        canvas.rect(3, 6, 4, 2, "markB");
        both(canvas, [[2, 5], [3, 5]], "markB");
      }
    },
  },
  {
    id: "fae", label: "Fae",
    skins: ["#F7D6E6", "#D6F0E6", "#E3DCF7", "#FCE7C8"],
    hairs: ["#F28FB8", "#8FD3F2", "#B8F28F", "#F2E28F", "#C79BF2"],
    hairStyles: ["long", "bob", "curly", "bun", "spiky"],
    eyes: ["#7950F2", "#12B886", "#E64980"],
    marks: [["#CFEFFF", "#FFD6F0", "#E0FFD6"], ["#8FC9F2", "#F28FC9", "#9FE08F"], ["#FFF6A8"]],
    draw: (canvas, view) => {
      wings(canvas, view, "markA", "markB");
      canvas.set(view.side === "side" ? 1 : 9, view.step % 2 === 0 ? 3 : 2, "markC");
    },
  },
  {
    id: "undine", label: "Undine",
    skins: ["#5DADE2", "#48C9B0", "#76D7EA", "#5B8DEF"],
    hairs: ["#1F618D", "#2E86C1", "#17A589", "#E8F8F5"],
    hairStyles: ["long"],
    eyes: ["#0B3D5C", "#E8F8FF"],
    marks: [["#F2FBFF"], ["#A8E6FF"], ["#F2FBFF"]],
    blocks: ["cap"],
    draw: (canvas, view) => {
      // The hair breaks over the head like a wave, with foam on the crest.
      if (view.side === "side") {
        points(canvas, [[4, -1], [5, -1], [6, -1], [7, 0], [3, -1]], "hair");
        points(canvas, [[5, -2], [6, -2], [8, 0]], "markA");
        return;
      }
      points(canvas, [[4, -1], [5, -1], [6, -1], [7, -1], [8, 0], [8, 1]], "hair");
      points(canvas, [[5, -2], [6, -2], [7, -2], [9, 0]], "markA");
      if (view.side === "front") {
        canvas.set(2, 7, "markB");
      }
    },
  },
  {
    id: "lizardfolk", label: "Lizardfolk",
    skins: ["#4E9A5B", "#3D8B6E", "#7A9A3A", "#8B6E3D"],
    hairStyles: BALD,
    eyes: ["#E8C12A", "#E07B2A"],
    marks: [["#C0392B", "#E8C12A", "#2E86AB"], ["#A8C77A"], [DARK]],
    blocks: ["cap", ...BEARDLESS],
    draw: (canvas, view) => {
      if (view.side === "side") {
        snout(canvas, view, "skin", "markC");
        points(canvas, [[3, 0], [5, 0], [2, 2], [2, 4]], "markA");
        canvas.set(8, 5, "markB");
        canvas.set(9, 5, "markB");
      } else {
        points(canvas, [[4, 0], [5, 0], [4, -1]], "markA");
        if (view.side === "front") {
          canvas.rect(3, 5, 4, 2, "markB");
          points(canvas, [[4, 5], [5, 5]], "skinShade");
          points(canvas, [[3, 2], [6, 2]], "skinShade");
        } else {
          points(canvas, [[4, 2], [5, 4], [4, 6]], "markA");
        }
      }
      tail(canvas, view, "skinShade");
    },
  },
  {
    id: "catfolk", label: "Catfolk",
    skins: ["#E8A15C", "#D9D2C5", "#8A8A8A", "#3A3A3A", "#C47A3A", "#F2E6D0"],
    hairs: ["#C47A3A", "#2E2E2E", "#E8D9A0", "#F2F2F2", "#8A8A8A"],
    hairStyles: ["short", "bob", "long", "spiky", "curly"],
    eyes: ["#7BC043", "#F2C94C", "#4FA3F7"],
    marks: [["#F2A6B8"], ["#F2F2F2"], ["#F2A6B8"]],
    blocks: BEARDLESS,
    draw: (canvas, view) => {
      topEars(canvas, view, false, "markA");
      if (view.side === "front") {
        both(canvas, [[1, 5], [0, 4]], "markB");
        canvas.set(4, 5, "markC");
      } else if (view.side === "side") {
        points(canvas, [[9, 5], [8, 5]], "markB");
        canvas.set(8, 4, "markC");
      }
      tail(canvas, view, "skin", "skinShade");
    },
  },
  {
    id: "wolffolk", label: "Wolffolk",
    skins: ["#7D7D7D", "#A0A0A0", "#5A4A3A", "#3A3A3A", "#C9B79C"],
    hairs: ["#5A5A5A", "#3A3A3A", "#8A7A6A", "#D9D9D9"],
    hairStyles: ["short", "spiky", "long", "bald"],
    eyes: ["#F2A93B", "#F2E14C", "#4FA3F7"],
    marks: [["#E8E0D0", "#D9C9A8"], [DARK], ["#5A4A3A"]],
    blocks: BEARDLESS,
    draw: (canvas, view) => {
      topEars(canvas, view, true, undefined);
      snout(canvas, view, "markA", "markB");
      tail(canvas, view, "skinShade", "markA");
    },
  },
  {
    id: "minotaur", label: "Minotaur",
    skins: ["#6B4E3D", "#4A3528", "#8B6E4E", "#2E2E2E", "#A0703A"],
    hairStyles: BALD,
    eyes: ["#1A1A2E", "#C0392B"],
    marks: [[BONE], ["#C9A68A", "#B8957A"], [GOLD]],
    blocks: [...HATLESS, ...BEARDLESS],
    size: "big",
    draw: (canvas, view) => {
      if (view.side === "side") {
        points(canvas, [[4, 1], [5, 0], [6, -1], [7, -1]], "markA");
        canvas.rect(8, 4, 2, 2, "markB");
        canvas.set(9, 4, DARK_KEY);
        canvas.set(9, 6, "markC");
        canvas.set(3, 2, "skin");
        return;
      }
      both(canvas, [[1, 1], [0, 0], [0, -1], [1, -2]], "markA");
      both(canvas, [[1, 2]], "skin");
      if (view.side === "front") {
        canvas.rect(3, 5, 4, 2, "markB");
        both(canvas, [[4, 5]], DARK_KEY);
        canvas.rect(4, 7, 2, 1, "markC");
      }
    },
  },
  {
    id: "robot", label: "Robot",
    skins: ["#B0B8C0", "#8E9AA6", "#C9A86B", "#6E7F8E", "#D9DEE3"],
    hairStyles: BALD,
    marks: [["#4FE3F7", "#7CF27C", "#F25C5C", "#F2C94C"], ["#3A3F48"], ["#E63946"]],
    blocks: ["cap", ...BEARDLESS],
    draw: (canvas, view) => {
      if (view.side === "side") {
        canvas.set(3, 6, "skin");
        canvas.set(8, 4, null);
        canvas.set(7, 4, "markA");
        canvas.set(6, 4, "skin");
        points(canvas, [[5, 0], [5, -1]], "markB");
        canvas.set(5, -2, "markC");
        canvas.set(4, 3, "skinShade");
        return;
      }
      canvas.set(2, 6, "skin");
      canvas.set(7, 6, "skin");
      points(canvas, [[4, 0], [4, -1]], "markB");
      canvas.set(4, -2, "markC");
      both(canvas, [[1, 3], [1, 4]], "markB");
      if (view.side === "front") {
        canvas.rect(3, 4, 4, 1, "markB");
        both(canvas, [[3, 4]], "markA");
        [3, 5].forEach((x) => canvas.set(x, 6, "skinShade"));
        canvas.rect(3, 6, 4, 1, "skinShade");
        [4, 6].forEach((x) => canvas.set(x, 6, "markB"));
      }
    },
  },
  {
    id: "cyclops", label: "Cyclops",
    skins: ["#9BB6D6", "#D08B5B", "#EDB98A", "#8DA77A", "#B88A6A"],
    hairs: HUMAN_HAIRS,
    hairStyles: ["bald", "short", "curly", "mohawk"],
    marks: [["#FFFFFF"], ["#1A1A2E"], ["#4C6EF5", "#4CB944", "#A0522D"]],
    blocks: ["glasses"],
    size: "big",
    draw: (canvas, view) => {
      if (view.side === "front") {
        canvas.set(3, 4, "skin");
        canvas.set(6, 4, "skin");
        canvas.rect(4, 3, 2, 2, "markA");
        canvas.set(4, 4, "markC");
        canvas.set(5, 4, "markB");
        canvas.rect(3, 2, 4, 1, "skinShade");
      } else if (view.side === "side") {
        canvas.rect(6, 3, 2, 2, "markA");
        canvas.set(7, 4, "markB");
        canvas.set(6, 4, "markA");
      }
    },
  },
  {
    id: "squidfolk", label: "Squidfolk",
    skins: ["#9B6BB3", "#7B5BA0", "#5FA8A0", "#C77DA8"],
    hairStyles: BALD,
    eyes: ["#F5E663", "#FFFFFF"],
    marks: [["#6A4A80", "#4A7A74"], [DARK], ["#E8C8F0"]],
    blocks: [...HATLESS, ...BEARDLESS],
    draw: (canvas, view) => {
      // A tall soft head, and tentacles hanging over the chest.
      if (view.side === "side") {
        canvas.rect(3, -1, 4, 1, "skin");
        canvas.rect(2, 0, 6, 1, "skin");
        canvas.rect(2, 1, 1, 3, "skin");
        canvas.set(8, 4, null);
        points(canvas, [[7, 5], [7, 6], [7, 7], [6, 6], [6, 8], [8, 6]], "markA");
        return;
      }
      canvas.rect(3, -1, 4, 1, "skin");
      canvas.rect(2, 0, 6, 1, "skin");
      both(canvas, [[1, 1], [1, 2]], "skin");
      if (view.side === "front") {
        points(canvas, [[3, 6], [4, 6], [5, 6], [6, 6], [3, 7], [5, 7], [4, 8], [6, 8], [3, 9]], "markA");
        canvas.set(4, 7, "markC");
        canvas.set(6, 7, "markC");
      }
    },
  },
  {
    id: "mushroom", label: "Mushroom Folk",
    skins: ["#F2E6D0", "#E8D9BC", "#F7EEDF"],
    hairStyles: BALD,
    marks: [["#D7263D", "#8B5A2B", "#7B4BB3", "#2E86C1", "#E07B2A"], ["#FFFFFF"], ["#D9C9A8"]],
    blocks: [...HATLESS, ...BEARDLESS],
    draw: (canvas, view) => {
      // A wide spotted cap, gills underneath.
      canvas.rect(3, -2, 4, 1, "markA");
      canvas.rect(1, -1, 8, 1, "markA");
      canvas.rect(0, 0, 10, 2, "markA");
      canvas.rect(1, 2, 8, 1, "markC");
      if (view.side !== "side") {
        canvas.set(0, 2, null);
        canvas.set(9, 2, null);
      }
      points(canvas, [[3, -1], [7, 0], [1, 1], [5, 1]], "markB");
    },
  },
  {
    id: "golem", label: "Golem",
    skins: ["#8A8A80", "#7A7065", "#9A9488", "#6E6A5E"],
    hairStyles: BALD,
    marks: [["#7CF2E0", "#F2A93B", "#B07CF2"], ["#5A5650"], ["#7CF2E0"]],
    blocks: ["cap", ...BEARDLESS],
    sleeveless: true,
    size: "big",
    draw: (canvas, view) => {
      if (view.side === "side") {
        canvas.set(6, 4, "markA");
        canvas.set(3, 6, "skin");
        points(canvas, [[4, 2], [5, 3]], "markB");
        return;
      }
      canvas.set(2, 6, "skinShade");
      canvas.set(7, 6, "skinShade");
      points(canvas, [[4, 1], [5, 2], [4, 3]], "markB");
      if (view.side === "front") {
        both(canvas, [[3, 4]], "markA");
        canvas.rect(3, 6, 4, 1, "markB");
      }
    },
  },
  {
    id: "ghost", label: "Ghost",
    skins: ["#EEF2F7", "#E3ECF5", "#F0F0FF", "#E8F7F0"],
    hairStyles: BALD,
    marks: [["#C8D4E8"], [DARK], ["#C8D4E8"]],
    blocks: ["cap", "headphones", "glasses", ...BEARDLESS],
    draw: (canvas, view) => {
      sheet(canvas, view);
      if (view.side === "front") {
        canvas.rect(3, 3, 1, 2, "eye");
        canvas.rect(6, 3, 1, 2, "eye");
        canvas.set(2, 6, "skin");
        canvas.set(7, 6, "skin");
      } else if (view.side === "side") {
        canvas.rect(6, 3, 1, 2, "eye");
        canvas.set(8, 4, null);
        canvas.set(3, 6, "skin");
      } else {
        canvas.set(2, 6, "skin");
        canvas.set(7, 6, "skin");
      }
    },
  },
  {
    id: "slime", label: "Slime",
    skins: ["#7CD67C", "#6EC1E4", "#E46ECF", "#F2C94C", "#B07CF2"],
    hairStyles: BALD,
    marks: [["#FFFFFF"], ["#FFFFFF"], ["#FFFFFF"]],
    blocks: ["cap", ...BEARDLESS],
    draw: blob,
  },
  {
    id: "dryad", label: "Dryad",
    skins: ["#8B5A2B", "#6B4423", "#A0703A", "#7A6A4A"],
    hairs: ["#4CB944", "#2E8B57", "#E07B2A", "#C0392B", "#F2C94C", "#F28FB8"],
    hairStyles: ["curly", "long"],
    eyes: ["#F2E14C", "#7CF27C"],
    marks: [["#5A3A1A"], ["#9BE07B", "#F2A93B", "#FFD6E8"], ["#4A2A10"]],
    blocks: ["cap"],
    sleeveless: true,
    draw: (canvas, view) => {
      // Leaves for hair, a few sprouting above, and grain in the bark.
      points(canvas, [[3, -1], [5, -1], [7, -1], [4, -2]], "hair");
      points(canvas, [[5, -2], [3, 0]], "markB");
      if (view.side === "front") {
        points(canvas, [[2, 5], [7, 3]], "markA");
      } else if (view.side === "side") {
        points(canvas, [[5, 5]], "markA");
      }
    },
  },
  {
    id: "jackalfolk", label: "Jackalfolk",
    skins: ["#1E1E24", "#2A2A30", "#3A2E24"],
    hairStyles: BALD,
    eyes: ["#F2C94C", "#7CF2E0"],
    marks: [[GOLD], ["#14141A"], ["#2E86AB", "#C0392B"]],
    blocks: [...HATLESS, ...BEARDLESS],
    draw: (canvas, view) => {
      topEars(canvas, view, true, view.side === "front" ? "markA" : undefined);
      snout(canvas, view, "skin", "markB");
      if (view.side === "front") {
        canvas.rect(2, 7, 6, 1, "markA");
        both(canvas, [[3, 7]], "markC");
        canvas.set(4, 6, "skinShade");
      } else if (view.side === "back") {
        canvas.rect(2, 7, 6, 1, "markA");
      } else {
        canvas.rect(3, 7, 4, 1, "markA");
      }
    },
  },
  {
    id: "harpy", label: "Harpy",
    hairs: HUMAN_HAIRS,
    hairStyles: ["long", "bob", "curly", "spiky"],
    eyes: ["#F2A93B", "#1A1A2E"],
    marks: [["#8B5A2B", "#5A5A5A", "#C0392B", "#2E86AB", "#E8E0D0"], ["#F2B233"], ["#D9952A"]],
    blocks: ["cap", ...BEARDLESS],
    draw: (canvas, view) => {
      // Feathered arms that fan past the body, a beak, a crest, and talons.
      canvas.recolor("sleeve", "markA");
      canvas.recolor("sleeveShade", "markAShade");
      canvas.recolor("shoes", "markB");
      points(canvas, [[4, -1], [5, -2], [6, -1]], "markA");
      if (view.side === "side") {
        canvas.set(8, 4, "markB");
        canvas.set(8, 5, "markC");
        canvas.set(9, 5, "markB");
        points(canvas, [[3, 9], [3, 10]], "markA");
        return;
      }
      both(canvas, [[0, 8], [0, 9], [0, 10]], "markA");
      if (view.side === "front") {
        canvas.rect(4, 5, 2, 1, "markB");
        canvas.rect(4, 6, 2, 1, "markC");
      }
    },
  },
  {
    id: "centaur", label: "Centaur",
    hairs: HUMAN_HAIRS,
    hairStyles: ["long", "long", "short", "bun", "curly"],
    marks: [["#8B5A2B", "#5A3825", "#C9A27A", "#2E2E2E", "#E8E4D8", "#A0522D"], ["#2B2020"], [IVORY]],
    draw: centaurBody,
  },
  {
    id: "naga", label: "Naga",
    skins: ["#7FA35A", "#5E8C61", "#D08B5B", "#C9B07A", "#EDB98A"],
    hairs: HUMAN_HAIRS,
    hairStyles: ["long", "bob", "bun", "bald"],
    eyes: ["#E8C12A"],
    marks: [["#4E8A3A", "#3A7A6A", "#8A6A2A", "#7A3A8A"], ["#E8D9A0", "#D9C08A"], [DARK]],
    draw: nagaBody,
  },
  {
    id: "merfolk", label: "Merfolk",
    skins: [...HUMAN_SKINS, "#9BD3E0"],
    hairs: ["#E2504B", "#2E86AB", "#12B886", "#F2E28F", "#7C5CE0", "#2C1B12"],
    hairStyles: ["long", "long", "curly", "bob"],
    marks: [["#2EC4B6", "#3A86FF", "#8338EC", "#FF6B9A"], ["#A0F0E8", "#BFD7FF", "#E0C3FF", "#FFC2D4"], ["#FFFFFF"]],
    draw: merfolkBody,
  },
  {
    id: "satyr", label: "Satyr",
    hairs: ["#5A3825", "#2C1B12", "#A0522D", "#3A2B26"],
    hairStyles: ["curly", "curly", "short", "bun"],
    marks: [["#6B4E3D", "#8B6E4E", "#3A2B26", "#A88A6A"], ["#2B2020"], ["#D9C9A8", "#8A7A6A"]],
    blocks: ["cap"],
    draw: (canvas, view) => {
      satyrLegs(canvas, view);
      if (view.side === "side") {
        points(canvas, [[5, 0], [4, -1]], "markC");
      } else {
        both(canvas, [[3, 0], [2, -1]], "markC");
      }
    },
  },
  {
    id: "dragonkin", label: "Dragonkin",
    skins: ["#C0392B", "#2E86AB", "#4CB944", "#8E44AD", "#D4AC0D"],
    hairStyles: BALD,
    eyes: ["#F2E14C", "#F2A93B"],
    marks: [[BONE], ["#5A2A3A", "#2A3A5A", "#2A5A3A"], ["#F2D16B"]],
    blocks: ["cap", ...BEARDLESS],
    draw: (canvas, view) => {
      wings(canvas, view, "markB", "markA");
      if (view.side === "side") {
        points(canvas, [[3, 1], [2, 0], [1, -1]], "markA");
        canvas.set(9, 4, "skin");
        canvas.set(8, 5, "skin");
        points(canvas, [[5, 8], [5, 9]], "markC");
      } else {
        both(canvas, [[2, 1], [2, 0], [1, -1]], "markA");
        if (view.side === "front") {
          canvas.rect(4, 8, 2, 3, "markC");
        }
      }
      tail(canvas, view, "skin", "skinShade");
    },
  },
  {
    id: "ogre", label: "Ogre",
    skins: ["#9AA15A", "#B5A76A", "#8C8A5E", "#A08A6A"],
    hairs: ["#2C1B12", "#3A3A3A", "#5A3825"],
    hairStyles: ["bald", "bald", "short", "mohawk"],
    eyes: ["#1A1A2E"],
    marks: [[IVORY], [IVORY], [IVORY]],
    size: "big",
    draw: (canvas, view) => {
      if (view.side === "side") {
        canvas.set(3, 6, "skin");
        canvas.set(8, 6, "skin");
        canvas.set(8, 5, "markA");
        canvas.rect(5, 3, 3, 1, "skinShade");
        return;
      }
      canvas.set(2, 6, "skin");
      canvas.set(7, 6, "skin");
      both(canvas, [[1, 4], [1, 5]], "skin");
      if (view.side === "front") {
        canvas.rect(2, 3, 6, 1, "skinShade");
        canvas.rect(3, 6, 4, 1, "skinShade");
        canvas.set(3, 5, "markA");
        canvas.set(6, 6, "markA");
      }
    },
  },
];

// Nostrils, slits, and other near-black details share the eye color's key.
const DARK_KEY: PaletteKey = "eye";

const RACE_BY_ID = new Map<RaceId, RaceSpec>(RACES.map((race) => [race.id, race]));

export function raceSpec(id: RaceId | undefined): RaceSpec {
  return RACE_BY_ID.get(id ?? "human") ?? RACES[0];
}

export function isRaceId(value: unknown): value is RaceId {
  return typeof value === "string" && RACE_BY_ID.has(value as RaceId);
}

// A seed can carry a picked race after this marker; the rest of the seed still picks the look.
const RACE_MARKER = "#race=";

export function seedWithRace(seed: string, race: RaceId): string {
  return `${seedWithoutRace(seed)}${RACE_MARKER}${race}`;
}

export function seedWithoutRace(seed: string): string {
  const at = seed.indexOf(RACE_MARKER);
  return at < 0 ? seed : seed.slice(0, at);
}

export function pickedRace(seed: string): RaceId | undefined {
  const at = seed.indexOf(RACE_MARKER);
  const value = at < 0 ? undefined : seed.slice(at + RACE_MARKER.length);
  return isRaceId(value) ? value : undefined;
}
