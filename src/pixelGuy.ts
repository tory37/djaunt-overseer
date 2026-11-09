// Pure: a session's pixel guy. A seed (the session id, or a re-roll) picks a race, skin, hair, clothes, and an
// accessory, so the same session always gets the same guy. Frames are small grids of colors that the Office view
// draws, and the portrait is an SVG for the session row with a state badge in its corner.

import { Canvas, HEAD_ROOM, isStepping, INNER_HEIGHT, INNER_WIDTH, mixHex, PaletteKey, shadeHex } from "./pixelCanvas";
import { isRaceId, pickedRace, RACE_IDS, RaceId, RaceSide, raceSpec, RaceSpec, seedWithoutRace } from "./pixelRaces";

export { HEAD_ROOM, mixHex, shadeHex };

// Ponytail (with one side shaved) is only for your own guy; random guys never get it.
export type HairStyle = "short" | "long" | "spiky" | "bob" | "bald" | "mohawk" | "bun" | "curly" | "ponytail";
// The full beard is only for your own guy, like the ponytail.
export type Accessory = "none" | "glasses" | "headphones" | "cap" | "beard" | "fullBeard";
export type Facing = "down" | "up" | "left" | "right";
// Carry walks with both arms up, holding something overhead; build stands working at something in front of him.
// Cheer stands with his arms up (waving, on the second frame); eat holds something up to his mouth.
export type Pose = "stand" | "walk" | "type" | "sit" | "stretch" | "drink" | "talk" | "sleep" | "carry" | "build" | "cheer" | "eat";

export interface PixelGuyLook {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  shirt: string;
  pants: string;
  shoes: string;
  accessory: Accessory;
  accessoryColor: string;
  // Optional details, used by your own guy: eye and beard colors, bare arms, bare shins, and bare toes.
  eyes?: string;
  beard?: string;
  sleeveless?: boolean;
  shorts?: boolean;
  flipFlops?: boolean;
  // Missing means human. Marks are the race's own three colors (horns, scales, wings); missing uses its defaults.
  race?: RaceId;
  marks?: [string, string, string];
  // A boss's tie, down the middle of the shirt from the front.
  tie?: string;
}

// A frame: rows of CSS colors, or null where the pixel is empty. Every frame is FRAME_WIDTH by FRAME_HEIGHT.
export type PixelGrid = (string | null)[][];

// The frame is the body plus the head room above it, outlined.
export const FRAME_WIDTH = INNER_WIDTH + 2;
export const FRAME_HEIGHT = INNER_HEIGHT + 2;
// Walk frames loop over four steps; type and talk over two.
// Sleep breathes: the head sinks a pixel on the second frame.
export const POSE_FRAMES: Record<Pose, number> = { stand: 1, walk: 4, type: 2, sit: 1, stretch: 1, drink: 1, talk: 2, sleep: 2, carry: 4, build: 2, cheer: 2, eat: 2 };

const SKINS = ["#F9D4B4", "#EDB98A", "#D08B5B", "#AE5D29", "#8D4A28", "#614335"];
const HAIRS = ["#2C1B12", "#5A3825", "#A0522D", "#D9A441", "#E8D9A0", "#B8B8B8", "#E2504B", "#7C5CE0", "#3FA7D6", "#2E2E2E"];
const SHIRTS = ["#E4572E", "#F3A712", "#4C6EF5", "#2E86AB", "#4CB944", "#A23B72", "#F06595", "#12B886", "#7950F2", "#FAB005", "#E03131", "#E9ECEF"];
const PANTS = ["#2B2D42", "#3D5A80", "#4A4E69", "#6B4E3D", "#1F3B2C", "#8D99AE"];
const SHOES = ["#1E1E1E", "#5C3D2E", "#EDEDED", "#9B2226"];
const ACCESSORY_COLORS = ["#222831", "#E63946", "#F1FAEE", "#457B9D", "#FFB703"];
const HAIR_STYLES: HairStyle[] = ["short", "long", "spiky", "bob", "bald", "mohawk", "bun", "curly"];
// Half the guys wear nothing extra.
const ACCESSORIES: Accessory[] = ["none", "none", "none", "none", "glasses", "headphones", "cap", "beard"];

const EYE = "#1A1A2E";
const MOUTH = "#7A2E2E";
const CUP = "#FFFFFF";
const OUTLINE = "#14141C";

// FNV-1a, so a seed string becomes a 32-bit number.
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// Mulberry32: small, fast, and good enough to pick clothes.
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const pickFrom = (random: () => number) => <Item>(items: readonly Item[]): Item => items[Math.floor(random() * items.length) % items.length];

// The race comes from its own stream of the hash, every race as likely as any other, so the clothes a seed picked
// before races stay the same. A seed with a picked race (`seedWithRace`) keeps it. With races off, everyone's human.
export function pixelGuyLook(seed: string, races = true): PixelGuyLook {
  const base = seedWithoutRace(seed);
  const pick = pickFrom(seededRandom(hashSeed(base)));
  const look: PixelGuyLook = {
    skin: pick(SKINS),
    hair: pick(HAIRS),
    hairStyle: pick(HAIR_STYLES),
    shirt: pick(SHIRTS),
    pants: pick(PANTS),
    shoes: pick(SHOES),
    accessory: pick(ACCESSORIES),
    accessoryColor: pick(ACCESSORY_COLORS),
  };
  const race = pickedRace(seed) ?? (races ? RACE_IDS[hashSeed(`${base}|race`) % RACE_IDS.length] : "human");
  return withRace(look, race, seededRandom(hashSeed(`${base}|${race}`)));
}

export function raceOfSeed(seed: string, races = true): RaceId {
  return pixelGuyLook(seed, races).race ?? "human";
}

// Puts a race on a look: its skin, hair, eyes, and marks from its own lists. A human look comes back unchanged.
function withRace(look: PixelGuyLook, race: RaceId, random: () => number): PixelGuyLook {
  if (race === "human") {
    return look;
  }
  const spec = raceSpec(race);
  const pick = pickFrom(random);
  const next: PixelGuyLook = { ...look, race, marks: defaultMarks(spec, pick) };
  if (spec.skins !== undefined) {
    next.skin = pick(spec.skins);
  }
  if (spec.hairs !== undefined) {
    next.hair = pick(spec.hairs);
  }
  if (spec.hairStyles !== undefined) {
    next.hairStyle = pick(spec.hairStyles);
  }
  if (spec.eyes !== undefined) {
    next.eyes = pick(spec.eyes);
  }
  if (spec.sleeveless === true) {
    next.sleeveless = true;
  }
  return next;
}

function defaultMarks(spec: RaceSpec, pick: <Item>(items: readonly Item[]) => Item = (items) => items[0]): [string, string, string] {
  const marks = spec.marks ?? [["#FFFFFF"], ["#FFFFFF"], ["#FFFFFF"]];
  return [pick(marks[0]), pick(marks[1]), pick(marks[2])];
}

// One frame of the guy, outlined, as colors. Left is the right-facing frame mirrored.
export function pixelGuyFrame(look: PixelGuyLook, pose: Pose, facing: Facing, frame: number): PixelGrid {
  const step = ((Math.floor(frame) % POSE_FRAMES[pose]) + POSE_FRAMES[pose]) % POSE_FRAMES[pose];
  const race = raceSpec(look.race);
  const side = facing === "left" || facing === "right";
  let canvas: Canvas;
  if (side) {
    canvas = drawSide(look, race, pose, step);
    if (facing === "left") {
      canvas = canvas.mirrored();
    }
  } else {
    canvas = drawFront(look, race, pose, step, facing === "up");
  }
  dressed(canvas, look, pose, facing);
  if (pose === "sleep") {
    canvas = slumped(canvas, step);
  }
  if (race.size === "short") {
    canvas = shortened(canvas);
  } else if (race.size === "big" && !side) {
    widened(canvas);
  }
  return outlined(colorize(canvas, look));
}

function drawRace(canvas: Canvas, look: PixelGuyLook, race: RaceSpec, pose: Pose, step: number, side: RaceSide): void {
  race.draw?.(canvas, { side, pose, step, seated: isSeatedPose(pose), hairStyle: look.hairStyle });
}

// A short guy loses a row of body and a row of leg; everything above them drops.
function shortened(canvas: Canvas): Canvas {
  const result = new Canvas();
  canvas.each((key, x, y) => {
    if (y >= 14) {
      result.set(x, y, key);
    } else if (y >= 11 && y <= 12) {
      result.set(x, y + 1, key);
    } else if (y <= 9) {
      result.set(x, y + 2, key);
    }
  });
  return result;
}

// A big guy's arms move out to the frame's edges and his body fills in behind them.
function widened(canvas: Canvas): void {
  for (let y = 7; y <= 12; y++) {
    for (const [arm, edge, inner] of [[1, 0, 2], [8, 9, 7]] as const) {
      const key = canvas.get(arm, y);
      if (key !== null && canvas.get(edge, y) === null) {
        canvas.set(edge, y, key);
        canvas.set(arm, y, canvas.get(inner, y) ?? key);
      }
    }
  }
}

function canWear(race: RaceSpec, accessory: Accessory): Accessory {
  return race.blocks?.includes(accessory) === true ? "none" : accessory;
}

function drawFront(look: PixelGuyLook, race: RaceSpec, pose: Pose, step: number, isBack: boolean): Canvas {
  const canvas = new Canvas();
  // Head, with its two bottom corners cut for a chin.
  canvas.rect(2, 1, 6, 6, "skin");
  canvas.set(2, 6, null);
  canvas.set(7, 6, null);
  // Body and hips.
  canvas.rect(2, 7, 6, 5, "shirt");
  canvas.rect(2, 11, 6, 1, "shirtShade");
  canvas.rect(2, 12, 6, 1, "pants");
  drawFrontLegs(canvas, pose, step);
  drawFrontArms(canvas, pose, step, isBack);
  if (isBack) {
    drawBackHair(canvas, look.hairStyle);
  } else {
    canvas.set(3, 4, "eye");
    canvas.set(6, 4, "eye");
    if ((pose === "talk" || pose === "cheer" || pose === "eat") && step === 1) {
      canvas.rect(4, 5, 2, 1, "mouth");
    }
    drawFrontHair(canvas, look.hairStyle);
  }
  if (race.beard === true) {
    drawFrontAccessory(canvas, "fullBeard", isBack);
  }
  drawFrontAccessory(canvas, canWear(race, look.accessory), isBack);
  drawRace(canvas, look, race, pose, step, isBack ? "back" : "front");
  if (look.tie !== undefined && !isBack) {
    // A knot, then the blade.
    canvas.rect(4, 7, 2, 1, "tieShade");
    canvas.rect(4, 8, 2, 2, "tie");
    canvas.set(4, 10, "tie");
  }
  if (pose === "drink" && !isBack) {
    canvas.set(7, 5, "cup");
    canvas.set(7, 6, "cup");
  }
  return canvas;
}

const isSeatedPose = (pose: Pose) => pose === "type" || pose === "sit" || pose === "sleep";

// Shorts bare the shins, and flip flops bare the toes: the middle of each shoe from the front, its tip from the side.
function dressed(canvas: Canvas, look: PixelGuyLook, pose: Pose, facing: Facing): void {
  const seated = isSeatedPose(pose);
  canvas.each((key, x, y) => {
    if (look.shorts === true && !seated && y >= 14 && (key === "pants" || key === "pantsShade")) {
      canvas.set(x, y, key === "pants" ? "skin" : "skinShade");
    }
  });
  if (look.flipFlops !== true || seated) {
    return;
  }
  const side = facing === "left" || facing === "right";
  canvas.cells.forEach((row, index) => {
    const y = index - HEAD_ROOM;
    let runStart = -1;
    for (let x = 0; x <= row.length; x++) {
      const isShoe = x < row.length && row[x] === "shoes";
      if (isShoe && runStart < 0) {
        runStart = x;
      } else if (!isShoe && runStart >= 0) {
        // Side by side, the two feet make one run; each three pixels is a foot.
        for (let foot = runStart; foot + 3 <= x; foot += 3) {
          canvas.set(side ? (facing === "right" ? foot + 2 : foot) : foot + 1, y, "skin");
        }
        runStart = -1;
      }
    }
  });
}

// Head down on folded arms: the head drops onto the shoulders, one more pixel on the out-breath.
function slumped(canvas: Canvas, step: number): Canvas {
  const drop = 2 + step;
  const result = new Canvas();
  canvas.each((key, x, y) => {
    if (y >= 7) {
      result.set(x, y, key);
    }
  });
  canvas.each((key, x, y) => {
    if (y < 7 && key !== null) {
      result.set(x, y + drop, key);
    }
  });
  return result;
}

function drawFrontLegs(canvas: Canvas, pose: Pose, step: number): void {
  if (isSeatedPose(pose)) {
    // Seated: knees forward, so the legs look short.
    canvas.rect(2, 13, 3, 1, "pantsShade");
    canvas.rect(5, 13, 3, 1, "pantsShade");
    canvas.rect(2, 14, 2, 1, "shoes");
    canvas.rect(6, 14, 2, 1, "shoes");
    return;
  }
  const leftUp = isStepping(pose) && step === 1;
  const rightUp = isStepping(pose) && step === 3;
  canvas.rect(3, 13, 2, leftUp ? 1 : 2, "pants");
  canvas.rect(5, 13, 2, rightUp ? 1 : 2, "pantsShade");
  canvas.rect(2, leftUp ? 14 : 15, 3, 1, "shoes");
  canvas.rect(5, rightUp ? 14 : 15, 3, 1, "shoes");
}

function drawFrontArms(canvas: Canvas, pose: Pose, step: number, isBack: boolean): void {
  if (pose === "build") {
    // Hands out in front, working, one up at a time.
    canvas.rect(1, 7, 1, 2, "sleeve");
    canvas.rect(8, 7, 1, 2, "sleeve");
    canvas.set(isBack ? 1 : 2, step === 0 ? 8 : 9, "skin");
    canvas.set(isBack ? 8 : 7, step === 1 ? 8 : 9, "skin");
    return;
  }
  if (pose === "cheer") {
    // Both arms up, then one waving lower.
    canvas.rect(1, 3, 1, 5, "sleeve");
    canvas.set(1, 2, "skin");
    canvas.rect(8, step === 0 ? 3 : 5, 1, step === 0 ? 5 : 3, "sleeve");
    canvas.set(8, step === 0 ? 2 : 4, "skin");
    return;
  }
  if (pose === "eat" && !isBack) {
    // One hand down, the other up at his mouth, lowered a little between bites.
    canvas.rect(1, 7, 1, 4, "sleeve");
    canvas.set(1, 11, "skin");
    canvas.rect(8, 7, 1, step === 0 ? 1 : 2, "sleeve");
    canvas.set(step === 0 ? 7 : 8, step === 0 ? 6 : 9, "skin");
    return;
  }
  if (pose === "stretch" || pose === "carry") {
    canvas.rect(1, 2, 1, 6, "sleeve");
    canvas.rect(8, 2, 1, 6, "sleeve");
    canvas.set(1, 1, "skin");
    canvas.set(8, 1, "skin");
    return;
  }
  if (pose === "sleep") {
    // Arms folded on the desk under the head.
    canvas.rect(1, 7, 8, 2, "sleeve");
    canvas.rect(2, 8, 6, 1, "sleeveShade");
    canvas.set(1, 9, "skin");
    canvas.set(8, 9, "skin");
    return;
  }
  if (pose === "type") {
    // Elbows out, hands on the keys, one hand up at a time.
    canvas.rect(1, 7, 1, 3, "sleeve");
    canvas.rect(8, 7, 1, 3, "sleeve");
    canvas.set(isBack ? 1 : 2, step === 0 ? 9 : 10, "skin");
    canvas.set(isBack ? 8 : 7, step === 1 ? 9 : 10, "skin");
    return;
  }
  if (pose === "drink" && !isBack) {
    canvas.rect(1, 7, 1, 4, "sleeve");
    canvas.set(1, 11, "skin");
    canvas.rect(8, 7, 1, 1, "sleeve");
    canvas.set(8, 6, "skin");
    return;
  }
  const swing = pose === "walk" ? (step === 1 ? -1 : step === 3 ? 1 : 0) : 0;
  canvas.rect(1, 7, 1, 4 + Math.min(0, swing), "sleeve");
  canvas.rect(8, 7, 1, 4 - Math.max(0, swing), "sleeve");
  canvas.set(1, 11 + Math.min(0, swing), "skin");
  canvas.set(8, 11 - Math.max(0, swing), "skin");
}

function drawFrontHair(canvas: Canvas, style: HairStyle): void {
  switch (style) {
    case "bald":
      return;
    case "short":
      canvas.rect(3, 0, 4, 1, "hair");
      canvas.rect(2, 1, 6, 1, "hair");
      canvas.set(2, 2, "hair");
      canvas.set(7, 2, "hair");
      return;
    case "long":
      canvas.rect(2, 0, 6, 1, "hair");
      canvas.rect(2, 1, 6, 1, "hair");
      canvas.rect(1, 1, 1, 7, "hair");
      canvas.rect(8, 1, 1, 7, "hair");
      canvas.set(2, 2, "hair");
      canvas.set(7, 2, "hair");
      return;
    case "spiky":
      [2, 4, 6].forEach((x) => canvas.set(x, 0, "hair"));
      [3, 5, 7].forEach((x) => canvas.set(x, 0, null));
      canvas.rect(2, 1, 6, 1, "hair");
      canvas.set(2, 2, "hair");
      canvas.set(7, 2, "hair");
      canvas.set(4, 2, "hair");
      return;
    case "bob":
      canvas.rect(3, 0, 4, 1, "hair");
      canvas.rect(2, 1, 6, 1, "hair");
      canvas.rect(1, 2, 1, 4, "hair");
      canvas.rect(8, 2, 1, 4, "hair");
      canvas.rect(2, 2, 1, 3, "hair");
      canvas.rect(7, 2, 1, 3, "hair");
      return;
    case "mohawk":
      canvas.rect(4, 0, 2, 3, "hair");
      return;
    case "bun":
      canvas.rect(4, 0, 2, 1, "hair");
      canvas.rect(2, 1, 6, 1, "hair");
      canvas.set(2, 2, "hair");
      canvas.set(7, 2, "hair");
      return;
    case "ponytail":
      // Swept over to the right, the left side shaved, the tail showing past the right ear.
      canvas.rect(3, 0, 5, 1, "hair");
      canvas.rect(3, 1, 5, 1, "hair");
      canvas.set(7, 2, "hair");
      canvas.rect(2, 1, 1, 3, "stubble");
      canvas.rect(8, 2, 1, 4, "hair");
      return;
    case "curly":
      canvas.rect(2, 0, 6, 1, "hair");
      canvas.rect(1, 1, 8, 1, "hair");
      canvas.rect(1, 2, 2, 1, "hair");
      canvas.rect(7, 2, 2, 1, "hair");
      canvas.set(1, 3, "hair");
      canvas.set(8, 3, "hair");
      return;
  }
}

function drawBackHair(canvas: Canvas, style: HairStyle): void {
  if (style === "bald") {
    return;
  }
  if (style === "mohawk") {
    canvas.rect(4, 0, 2, 6, "hair");
    return;
  }
  if (style === "ponytail") {
    canvas.rect(3, 0, 4, 1, "hair");
    canvas.rect(3, 1, 5, 3, "hair");
    canvas.rect(2, 1, 1, 4, "stubble");
    canvas.rect(4, 4, 2, 1, "hairTie");
    canvas.rect(4, 5, 2, 3, "hair");
    canvas.set(5, 8, "hair");
    return;
  }
  canvas.rect(2, 1, 6, style === "short" || style === "spiky" ? 4 : 5, "hair");
  canvas.rect(3, 0, 4, 1, "hair");
  if (style === "long") {
    canvas.rect(2, 6, 6, 2, "hair");
    canvas.rect(1, 1, 1, 7, "hair");
    canvas.rect(8, 1, 1, 7, "hair");
  }
  if (style === "bun") {
    canvas.rect(4, 0, 2, 1, "hair");
    canvas.rect(4, 2, 2, 1, "skinShade");
  }
  if (style === "curly") {
    canvas.rect(1, 1, 8, 3, "hair");
  }
  if (style === "spiky") {
    [3, 5].forEach((x) => canvas.set(x, 0, null));
    [2, 4, 6].forEach((x) => canvas.set(x, 0, "hair"));
  }
}

function drawFrontAccessory(canvas: Canvas, accessory: Accessory, isBack: boolean): void {
  switch (accessory) {
    case "glasses":
      if (!isBack) {
        [2, 4, 5, 7].forEach((x) => canvas.set(x, 4, "accessory"));
        canvas.set(3, 3, "accessoryLight");
        canvas.set(6, 3, "accessoryLight");
      }
      return;
    case "headphones":
      canvas.rect(2, 0, 6, 1, "accessory");
      canvas.rect(1, 3, 1, 3, "accessory");
      canvas.rect(8, 3, 1, 3, "accessory");
      return;
    case "cap":
      canvas.rect(2, 0, 6, 2, "accessory");
      if (!isBack) {
        canvas.rect(1, 2, 8, 1, "accessoryLight");
      }
      return;
    case "beard":
      if (!isBack) {
        canvas.rect(3, 6, 4, 1, "beard");
        canvas.set(2, 5, "beard");
        canvas.set(7, 5, "beard");
        canvas.set(3, 5, "beard");
        canvas.set(6, 5, "beard");
      }
      return;
    case "fullBeard":
      if (!isBack) {
        // Sideburns, the whole jaw, and down onto the chest, with the mouth showing through.
        canvas.rect(2, 3, 1, 3, "beard");
        canvas.rect(7, 3, 1, 3, "beard");
        canvas.rect(2, 5, 6, 2, "beard");
        canvas.rect(3, 7, 4, 1, "beard");
        canvas.rect(4, 5, 2, 1, "mouth");
      }
      return;
    case "none":
      return;
  }
}

// Facing right. The left frames mirror these.
function drawSide(look: PixelGuyLook, race: RaceSpec, pose: Pose, step: number): Canvas {
  const canvas = new Canvas();
  canvas.rect(3, 1, 5, 6, "skin");
  canvas.set(3, 6, null);
  canvas.set(8, 4, "skin");
  canvas.set(6, 4, "eye");
  if ((pose === "talk" || pose === "cheer" || pose === "eat") && step === 1) {
    canvas.set(7, 5, "mouth");
  }
  canvas.rect(3, 7, 4, 5, "shirt");
  canvas.rect(3, 11, 4, 1, "shirtShade");
  canvas.rect(3, 12, 4, 1, "pants");
  drawSideLegs(canvas, pose, step);
  drawSideArm(canvas, pose, step);
  drawSideHair(canvas, look.hairStyle);
  if (race.beard === true) {
    drawSideAccessory(canvas, "fullBeard");
  }
  drawSideAccessory(canvas, canWear(race, look.accessory));
  drawRace(canvas, look, race, pose, step, "side");
  return canvas;
}

function drawSideLegs(canvas: Canvas, pose: Pose, step: number): void {
  if (isStepping(pose) && (step === 1 || step === 3)) {
    // Mid-stride: one leg forward, one back.
    canvas.rect(5, 13, 2, 2, step === 1 ? "pants" : "pantsShade");
    canvas.rect(3, 13, 2, 2, step === 1 ? "pantsShade" : "pants");
    canvas.rect(6, 15, 2, 1, "shoes");
    canvas.rect(2, 15, 2, 1, "shoes");
    return;
  }
  canvas.rect(4, 13, 2, 2, "pants");
  canvas.rect(4, 15, 3, 1, "shoes");
}

function drawSideArm(canvas: Canvas, pose: Pose, step: number): void {
  if (pose === "cheer") {
    canvas.rect(5, step === 0 ? 2 : 3, 1, step === 0 ? 6 : 5, "sleeveShade");
    canvas.set(step === 0 ? 5 : 6, step === 0 ? 1 : 2, "skin");
    return;
  }
  if (pose === "eat") {
    // Forearm up in front of him, hand at his mouth.
    canvas.rect(4, 7, 2, 2, "sleeveShade");
    canvas.set(6, step === 0 ? 6 : 7, "sleeveShade");
    canvas.set(7, step === 0 ? 5 : 7, "skin");
    return;
  }
  if (pose === "carry") {
    canvas.rect(5, 2, 1, 6, "sleeveShade");
    canvas.set(5, 1, "skin");
    return;
  }
  if (pose === "build") {
    canvas.rect(4, 7, 2, 1, "sleeveShade");
    canvas.rect(6, 8, 2, 1, "sleeveShade");
    canvas.set(8, step === 0 ? 8 : 9, "skin");
    return;
  }
  const reach = pose === "walk" ? (step === 1 ? 1 : step === 3 ? -1 : 0) : 0;
  canvas.rect(4, 7, 2, 3, "sleeveShade");
  canvas.set(4 + Math.max(0, reach) + (reach < 0 ? -1 : 0), 10, "sleeveShade");
  canvas.set(5 + reach, 11, "skin");
}

function drawSideHair(canvas: Canvas, style: HairStyle): void {
  switch (style) {
    case "bald":
      return;
    case "mohawk":
      canvas.rect(3, 0, 4, 1, "hair");
      return;
    case "long":
      canvas.rect(3, 0, 4, 1, "hair");
      canvas.rect(2, 1, 6, 1, "hair");
      canvas.rect(2, 2, 2, 6, "hair");
      return;
    case "bob":
      canvas.rect(3, 0, 4, 1, "hair");
      canvas.rect(2, 1, 6, 1, "hair");
      canvas.rect(2, 2, 3, 4, "hair");
      return;
    case "curly":
      canvas.rect(2, 0, 6, 1, "hair");
      canvas.rect(2, 1, 7, 1, "hair");
      canvas.rect(2, 2, 3, 3, "hair");
      return;
    case "bun":
      canvas.set(2, 0, "hair");
      canvas.rect(3, 0, 4, 1, "hair");
      canvas.rect(2, 1, 6, 1, "hair");
      canvas.rect(2, 2, 2, 2, "hair");
      return;
    case "spiky":
      [3, 5, 7].forEach((x) => canvas.set(x, 0, "hair"));
      canvas.rect(2, 1, 6, 1, "hair");
      canvas.rect(2, 2, 2, 2, "hair");
      return;
    case "short":
      canvas.rect(3, 0, 4, 1, "hair");
      canvas.rect(2, 1, 6, 1, "hair");
      canvas.rect(2, 2, 2, 2, "hair");
      return;
    case "ponytail":
      // Hair pulled back to a tie, the tail hanging down the back of the neck, the side above the ear shaved.
      canvas.rect(3, 0, 4, 1, "hair");
      canvas.rect(2, 1, 6, 1, "hair");
      canvas.rect(3, 2, 2, 2, "stubble");
      canvas.set(2, 2, "hairTie");
      canvas.rect(1, 2, 1, 1, "hair");
      canvas.rect(1, 3, 1, 4, "hair");
      canvas.set(2, 3, "hair");
      return;
  }
}

function drawSideAccessory(canvas: Canvas, accessory: Accessory): void {
  switch (accessory) {
    case "glasses":
      canvas.rect(6, 4, 2, 1, "accessory");
      canvas.set(6, 4, "accessoryLight");
      return;
    case "headphones":
      canvas.rect(3, 0, 4, 1, "accessory");
      canvas.rect(3, 1, 1, 2, "accessory");
      canvas.rect(3, 3, 2, 3, "accessory");
      return;
    case "cap":
      canvas.rect(3, 0, 4, 2, "accessory");
      canvas.rect(7, 2, 2, 1, "accessoryLight");
      return;
    case "beard":
      canvas.rect(5, 6, 3, 1, "beard");
      canvas.set(7, 5, "beard");
      return;
    case "fullBeard":
      canvas.rect(4, 3, 1, 3, "beard");
      canvas.rect(4, 5, 4, 2, "beard");
      canvas.set(8, 5, "beard");
      canvas.rect(5, 7, 2, 1, "beard");
      canvas.set(7, 5, "mouth");
      return;
    case "none":
      return;
  }
}

function colorize(canvas: Canvas, look: PixelGuyLook): PixelGrid {
  const [markA, markB, markC] = look.marks ?? defaultMarks(raceSpec(look.race));
  const colors: Record<PaletteKey, string> = {
    skin: look.skin,
    skinShade: shadeHex(look.skin, 0.82),
    hair: look.hair,
    eye: look.eyes ?? EYE,
    mouth: MOUTH,
    shirt: look.shirt,
    shirtShade: shadeHex(look.shirt, 0.78),
    pants: look.pants,
    pantsShade: shadeHex(look.pants, 0.8),
    shoes: look.shoes,
    accessory: look.accessoryColor,
    accessoryLight: shadeHex(look.accessoryColor, 1.3),
    cup: CUP,
    sleeve: look.sleeveless === true ? look.skin : look.shirt,
    sleeveShade: look.sleeveless === true ? shadeHex(look.skin, 0.82) : shadeHex(look.shirt, 0.78),
    stubble: mixHex(look.skin, look.hair, 0.4),
    beard: look.beard ?? look.hair,
    hairTie: shadeHex(look.hair, 0.6),
    markA,
    markAShade: shadeHex(markA, 0.75),
    markB,
    markC,
    tie: look.tie ?? MOUTH,
    tieShade: shadeHex(look.tie ?? MOUTH, 0.7),
  };
  return canvas.cells.map((row) => row.map((key) => (key === null ? null : colors[key])));
}

// Adds a one-pixel border, and a dark outline on every empty pixel that touches the guy, so he reads on any floor.
function outlined(grid: PixelGrid): PixelGrid {
  const padded: PixelGrid = Array.from({ length: FRAME_HEIGHT }, (_, y) =>
    Array.from({ length: FRAME_WIDTH }, (_, x) => grid[y - 1]?.[x - 1] ?? null),
  );
  const filled = (x: number, y: number) => padded[y]?.[x] != null;
  return padded.map((row, y) =>
    row.map((color, x) => {
      if (color !== null) {
        return color;
      }
      return filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1) ? OUTLINE : null;
    }),
  );
}

export interface PortraitBadge {
  color: string;
  pulse: boolean;
}

const PORTRAIT_SIZE = 16;
// The outline row, the head room, and the body down to the shirt.
const PORTRAIT_ROWS = 13 + HEAD_ROOM;

// The guy from the shoulders up, centered in a 16x16 icon. The badge says the session's state; a dimmed portrait is a
// session that isn't running.
export function portraitSvg(look: PixelGuyLook, badge: PortraitBadge | undefined, dimmed: boolean): string {
  const frame = pixelGuyFrame(look, "stand", "down", 0).slice(0, PORTRAIT_ROWS);
  // The bottom row is the shirt, so it gets a closing outline only at its edges.
  const offsetX = Math.floor((PORTRAIT_SIZE - FRAME_WIDTH) / 2);
  const offsetY = PORTRAIT_SIZE - PORTRAIT_ROWS;
  const rects: string[] = [];
  frame.forEach((row, y) => {
    let runStart = 0;
    for (let x = 1; x <= row.length; x++) {
      if (x === row.length || row[x] !== row[runStart]) {
        const color = row[runStart];
        if (color !== null) {
          rects.push(`<rect x="${runStart + offsetX}" y="${y + offsetY}" width="${x - runStart}" height="1" fill="${color}"/>`);
        }
        runStart = x;
      }
    }
  });
  const body = `<g${dimmed ? ' opacity="0.45"' : ""}>${rects.join("")}</g>`;
  const badgeSvg = badge === undefined ? "" : badgeMarkup(badge);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PORTRAIT_SIZE}" height="${PORTRAIT_SIZE}" viewBox="0 0 ${PORTRAIT_SIZE} ${PORTRAIT_SIZE}" shape-rendering="crispEdges">${body}${badgeSvg}</svg>`;
}

function badgeMarkup(badge: PortraitBadge): string {
  const pulse = badge.pulse
    ? `<animate attributeName="opacity" values="1;0.35;1" dur="1.2s" repeatCount="indefinite"/>`
    : "";
  return `<circle cx="12.5" cy="12.5" r="3" fill="${OUTLINE}" shape-rendering="geometricPrecision"/>` +
    `<circle cx="12.5" cy="12.5" r="2" fill="${badge.color}" shape-rendering="geometricPrecision">${pulse}</circle>`;
}

// Your own guy in the Office. `overseer.office.yourLook` overrides any of these.
export const DEFAULT_YOUR_LOOK: PixelGuyLook = {
  skin: "#F2C9A0",
  hair: "#F2D16B",
  hairStyle: "ponytail",
  shirt: "#2A2A30",
  pants: "#F4F4F6",
  shoes: "#1E1E1E",
  accessory: "fullBeard",
  accessoryColor: "#1E1E1E",
  eyes: "#3D8BFD",
  beard: "#D9772B",
  sleeveless: true,
  shorts: true,
  flipFlops: true,
};

const ALL_HAIR_STYLES: readonly HairStyle[] = [...HAIR_STYLES, "ponytail"];
const ALL_ACCESSORIES: readonly Accessory[] = ["none", "glasses", "headphones", "cap", "beard", "fullBeard"];
const COLOR_FIELDS = ["skin", "hair", "shirt", "pants", "shoes", "accessoryColor", "eyes", "beard"] as const;
const FLAG_FIELDS = ["sleeveless", "shorts", "flipFlops"] as const;

// The setting over the default, a field at a time. A field that isn't a #rrggbb color, a known style, or a boolean is skipped.
export function yourLook(setting: unknown): PixelGuyLook {
  const look: PixelGuyLook = { ...DEFAULT_YOUR_LOOK };
  if (typeof setting !== "object" || setting === null) {
    return look;
  }
  const fields = setting as Record<string, unknown>;
  for (const field of COLOR_FIELDS) {
    const value = fields[field];
    if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) {
      look[field] = value;
    }
  }
  for (const field of FLAG_FIELDS) {
    if (typeof fields[field] === "boolean") {
      look[field] = fields[field] as boolean;
    }
  }
  if (ALL_HAIR_STYLES.includes(fields.hairStyle as HairStyle)) {
    look.hairStyle = fields.hairStyle as HairStyle;
  }
  if (ALL_ACCESSORIES.includes(fields.accessory as Accessory)) {
    look.accessory = fields.accessory as Accessory;
  }
  if (isRaceId(fields.race) && fields.race !== "human") {
    // The race's first skin, hair, style, and eyes, for whichever of them the setting doesn't give.
    const spec = raceSpec(fields.race);
    look.race = fields.race;
    look.marks = defaultMarks(spec);
    const given = (field: string) => look[field as keyof PixelGuyLook] !== DEFAULT_YOUR_LOOK[field as keyof PixelGuyLook];
    if (!given("skin") && spec.skins !== undefined) {
      look.skin = spec.skins[0];
    }
    if (!given("hair") && spec.hairs !== undefined) {
      look.hair = spec.hairs[0];
    }
    if (!given("hairStyle") && spec.hairStyles !== undefined && !spec.hairStyles.includes(look.hairStyle)) {
      look.hairStyle = spec.hairStyles[0];
    }
    if (!given("eyes") && spec.eyes !== undefined) {
      look.eyes = spec.eyes[0];
    }
  }
  return look;
}
