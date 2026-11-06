// Pure: a session's pixel guy. A seed (the session id, or a re-roll) picks skin, hair, clothes, and an accessory, so
// the same session always gets the same guy. Frames are small grids of colors that the Office view draws, and the
// portrait is an SVG for the session row with a state badge in its corner.

export type HairStyle = "short" | "long" | "spiky" | "bob" | "bald" | "mohawk" | "bun" | "curly";
export type Accessory = "none" | "glasses" | "headphones" | "cap" | "beard";
export type Facing = "down" | "up" | "left" | "right";
export type Pose = "stand" | "walk" | "type" | "sit" | "stretch" | "drink" | "talk" | "sleep";

export interface PixelGuyLook {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  shirt: string;
  pants: string;
  shoes: string;
  accessory: Accessory;
  accessoryColor: string;
}

// A frame: rows of CSS colors, or null where the pixel is empty. Every frame is FRAME_WIDTH by FRAME_HEIGHT.
export type PixelGrid = (string | null)[][];

const INNER_WIDTH = 10;
const INNER_HEIGHT = 16;
export const FRAME_WIDTH = INNER_WIDTH + 2;
export const FRAME_HEIGHT = INNER_HEIGHT + 2;
// Walk frames loop over four steps; type and talk over two.
// Sleep breathes: the head sinks a pixel on the second frame.
export const POSE_FRAMES: Record<Pose, number> = { stand: 1, walk: 4, type: 2, sit: 1, stretch: 1, drink: 1, talk: 2, sleep: 2 };

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

export function pixelGuyLook(seed: string): PixelGuyLook {
  const random = seededRandom(hashSeed(seed));
  const pick = <Item>(items: readonly Item[]): Item => items[Math.floor(random() * items.length) % items.length];
  return {
    skin: pick(SKINS),
    hair: pick(HAIRS),
    hairStyle: pick(HAIR_STYLES),
    shirt: pick(SHIRTS),
    pants: pick(PANTS),
    shoes: pick(SHOES),
    accessory: pick(ACCESSORIES),
    accessoryColor: pick(ACCESSORY_COLORS),
  };
}

// Darkens or lightens a #rrggbb color by a factor.
export function shadeHex(hex: string, factor: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (match === null) {
    return hex;
  }
  const value = parseInt(match[1], 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) =>
    Math.max(0, Math.min(255, Math.round(channel * factor))),
  );
  return "#" + channels.map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase();
}

type PaletteKey =
  | "skin" | "skinShade" | "hair" | "eye" | "mouth" | "shirt" | "shirtShade" | "pants" | "pantsShade" | "shoes"
  | "accessory" | "accessoryLight" | "cup";

class Canvas {
  readonly cells: (PaletteKey | null)[][] = Array.from({ length: INNER_HEIGHT }, () => Array<PaletteKey | null>(INNER_WIDTH).fill(null));

  set(x: number, y: number, key: PaletteKey | null): void {
    if (x >= 0 && y >= 0 && x < INNER_WIDTH && y < INNER_HEIGHT) {
      this.cells[y][x] = key;
    }
  }

  rect(x: number, y: number, width: number, height: number, key: PaletteKey | null): void {
    for (let row = y; row < y + height; row++) {
      for (let column = x; column < x + width; column++) {
        this.set(column, row, key);
      }
    }
  }

  mirrored(): Canvas {
    const mirror = new Canvas();
    this.cells.forEach((row, y) => row.forEach((key, x) => mirror.set(INNER_WIDTH - 1 - x, y, key)));
    return mirror;
  }
}

// One frame of the guy, outlined, as colors. Left is the right-facing frame mirrored.
export function pixelGuyFrame(look: PixelGuyLook, pose: Pose, facing: Facing, frame: number): PixelGrid {
  const step = ((Math.floor(frame) % POSE_FRAMES[pose]) + POSE_FRAMES[pose]) % POSE_FRAMES[pose];
  let canvas: Canvas;
  if (facing === "left" || facing === "right") {
    canvas = drawSide(look, pose, step);
    if (facing === "left") {
      canvas = canvas.mirrored();
    }
  } else {
    canvas = drawFront(look, pose, step, facing === "up");
  }
  if (pose === "sleep") {
    canvas = slumped(canvas, step);
  }
  return outlined(colorize(canvas, look));
}

function drawFront(look: PixelGuyLook, pose: Pose, step: number, isBack: boolean): Canvas {
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
    if (pose === "talk" && step === 1) {
      canvas.rect(4, 5, 2, 1, "mouth");
    }
    drawFrontHair(canvas, look.hairStyle);
  }
  drawFrontAccessory(canvas, look.accessory, isBack);
  if (pose === "drink" && !isBack) {
    canvas.set(7, 5, "cup");
    canvas.set(7, 6, "cup");
  }
  return canvas;
}

// Head down on folded arms: the head drops onto the shoulders, one more pixel on the out-breath.
function slumped(canvas: Canvas, step: number): Canvas {
  const drop = 2 + step;
  const result = new Canvas();
  canvas.cells.forEach((row, y) => row.forEach((key, x) => {
    if (y >= 7) {
      result.set(x, y, key);
    }
  }));
  canvas.cells.forEach((row, y) => row.forEach((key, x) => {
    if (y < 7 && key !== null) {
      result.set(x, y + drop, key);
    }
  }));
  return result;
}

function drawFrontLegs(canvas: Canvas, pose: Pose, step: number): void {
  if (pose === "type" || pose === "sit" || pose === "sleep") {
    // Seated: knees forward, so the legs look short.
    canvas.rect(2, 13, 3, 1, "pantsShade");
    canvas.rect(5, 13, 3, 1, "pantsShade");
    canvas.rect(2, 14, 2, 1, "shoes");
    canvas.rect(6, 14, 2, 1, "shoes");
    return;
  }
  const leftUp = pose === "walk" && step === 1;
  const rightUp = pose === "walk" && step === 3;
  canvas.rect(3, 13, 2, leftUp ? 1 : 2, "pants");
  canvas.rect(5, 13, 2, rightUp ? 1 : 2, "pantsShade");
  canvas.rect(2, leftUp ? 14 : 15, 3, 1, "shoes");
  canvas.rect(5, rightUp ? 14 : 15, 3, 1, "shoes");
}

function drawFrontArms(canvas: Canvas, pose: Pose, step: number, isBack: boolean): void {
  if (pose === "stretch") {
    canvas.rect(1, 2, 1, 6, "shirt");
    canvas.rect(8, 2, 1, 6, "shirt");
    canvas.set(1, 1, "skin");
    canvas.set(8, 1, "skin");
    return;
  }
  if (pose === "sleep") {
    // Arms folded on the desk under the head.
    canvas.rect(1, 7, 8, 2, "shirt");
    canvas.rect(2, 8, 6, 1, "shirtShade");
    canvas.set(1, 9, "skin");
    canvas.set(8, 9, "skin");
    return;
  }
  if (pose === "type") {
    // Elbows out, hands on the keys, one hand up at a time.
    canvas.rect(1, 7, 1, 3, "shirt");
    canvas.rect(8, 7, 1, 3, "shirt");
    canvas.set(isBack ? 1 : 2, step === 0 ? 9 : 10, "skin");
    canvas.set(isBack ? 8 : 7, step === 1 ? 9 : 10, "skin");
    return;
  }
  if (pose === "drink" && !isBack) {
    canvas.rect(1, 7, 1, 4, "shirt");
    canvas.set(1, 11, "skin");
    canvas.rect(8, 7, 1, 1, "shirt");
    canvas.set(8, 6, "skin");
    return;
  }
  const swing = pose === "walk" ? (step === 1 ? -1 : step === 3 ? 1 : 0) : 0;
  canvas.rect(1, 7, 1, 4 + Math.min(0, swing), "shirt");
  canvas.rect(8, 7, 1, 4 - Math.max(0, swing), "shirt");
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
        canvas.rect(3, 6, 4, 1, "hair");
        canvas.set(2, 5, "hair");
        canvas.set(7, 5, "hair");
        canvas.set(3, 5, "hair");
        canvas.set(6, 5, "hair");
      }
      return;
    case "none":
      return;
  }
}

// Facing right. The left frames mirror these.
function drawSide(look: PixelGuyLook, pose: Pose, step: number): Canvas {
  const canvas = new Canvas();
  canvas.rect(3, 1, 5, 6, "skin");
  canvas.set(3, 6, null);
  canvas.set(8, 4, "skin");
  canvas.set(6, 4, "eye");
  if (pose === "talk" && step === 1) {
    canvas.set(7, 5, "mouth");
  }
  canvas.rect(3, 7, 4, 5, "shirt");
  canvas.rect(3, 11, 4, 1, "shirtShade");
  canvas.rect(3, 12, 4, 1, "pants");
  drawSideLegs(canvas, pose, step);
  drawSideArm(canvas, pose, step);
  drawSideHair(canvas, look.hairStyle);
  drawSideAccessory(canvas, look.accessory);
  return canvas;
}

function drawSideLegs(canvas: Canvas, pose: Pose, step: number): void {
  if (pose === "walk" && (step === 1 || step === 3)) {
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
  const reach = pose === "walk" ? (step === 1 ? 1 : step === 3 ? -1 : 0) : 0;
  canvas.rect(4, 7, 2, 3, "shirtShade");
  canvas.set(4 + Math.max(0, reach) + (reach < 0 ? -1 : 0), 10, "shirtShade");
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
      canvas.rect(5, 6, 3, 1, "hair");
      canvas.set(7, 5, "hair");
      return;
    case "none":
      return;
  }
}

function colorize(canvas: Canvas, look: PixelGuyLook): PixelGrid {
  const colors: Record<PaletteKey, string> = {
    skin: look.skin,
    skinShade: shadeHex(look.skin, 0.82),
    hair: look.hair,
    eye: EYE,
    mouth: MOUTH,
    shirt: look.shirt,
    shirtShade: shadeHex(look.shirt, 0.78),
    pants: look.pants,
    pantsShade: shadeHex(look.pants, 0.8),
    shoes: look.shoes,
    accessory: look.accessoryColor,
    accessoryLight: shadeHex(look.accessoryColor, 1.3),
    cup: CUP,
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
const PORTRAIT_ROWS = 13;

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
