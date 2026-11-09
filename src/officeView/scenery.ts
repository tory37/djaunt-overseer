// The newer scenes' scenery: the beach, snowfield, desert, reef, library, and rooftop. Their back rows, ground,
// props, the light their props give off, and their weather. The view draws the sky (sun, moon, stars, clouds)
// first for the outdoor ones; everything here sits in front of it. Coordinates are room pixels, one tile is 16.

import type { OfficeSceneId, PropKind } from "../officeLayout";
import type { SceneLight } from "../officeDaylight";
import type { ScenePalette } from "./palettes";

type Rect = (x: number, y: number, w: number, h: number, color: string) => void;

export interface Kit {
  rect: Rect;
  glow: (centerX: number, centerY: number, radius: number, color: string, alpha: number) => void;
  context: CanvasRenderingContext2D;
}

const TILE = 16;

const noise = (value: number) => {
  const wave = Math.sin(value * 12.9898) * 43758.5453;
  return wave - Math.floor(wave);
};

// The backdrops that put the real sky behind them.
export function backdropHasSky(backdrop: ScenePalette["backdrop"]): boolean {
  return backdrop === "sea" || backdrop === "peaks" || backdrop === "mesa" || backdrop === "skyline";
}

// Where the open sky ends at this x, for the light map: sky above stays its own color.
export function skyBottom(backdrop: ScenePalette["backdrop"], x: number): number {
  switch (backdrop) {
    case "sea":
      return SEA_HORIZON;
    case "peaks":
      return peakTop(x);
    case "mesa":
      return Math.min(mesaTop(x), duneTop(x));
    case "skyline":
      return skylineTop(x);
    default:
      return 0;
  }
}

export function drawBackdrop(kit: Kit, palette: ScenePalette, width: number, seconds: number, light: SceneLight): void {
  switch (palette.backdrop) {
    case "sea":
      drawSea(kit, palette, width, seconds);
      return;
    case "peaks":
      drawPeaks(kit, palette, width, seconds, light);
      return;
    case "mesa":
      drawMesa(kit, palette, width);
      return;
    case "water":
      drawWater(kit, palette, width, seconds);
      return;
    case "bookcases":
      drawBookcases(kit, palette, width, light);
      return;
    case "skyline":
      drawSkyline(kit, palette, width);
      return;
  }
}

// The beach's back row: the sea out to the horizon, glints moving on it, and the surf washing in and out.
const SEA_HORIZON = 6;

function drawSea(kit: Kit, palette: ScenePalette, width: number, seconds: number): void {
  const { rect } = kit;
  rect(0, SEA_HORIZON, width, TILE - SEA_HORIZON, palette.wall);
  rect(0, SEA_HORIZON, width, 1, "#1E7AA8");
  for (let glint = 0; glint < width / 8; glint++) {
    const x = Math.floor((noise(glint) * width + seconds * (3 + (glint % 3) * 2)) % width);
    rect(x, SEA_HORIZON + 1 + Math.floor((glint % 4) * 1.5), 2 + (glint % 2), 1, glint % 3 === 0 ? "#BFE8F8" : "#6CC4E8");
  }
  const wash = Math.round(Math.sin(seconds * 0.8) * 1.2);
  rect(0, 13, width, 3, "#D8C08A");
  rect(0, 12 + wash, width, 2, "#7ACBE6");
  for (let x = 0; x < width; x += 3) {
    rect(x, 12 + wash + (noise(x + Math.floor(seconds)) > 0.5 ? 0 : 1), 3, 1, palette.wallTrim);
  }
  rect(0, 14 + Math.max(0, wash), width, 1, "#CDB27A");
}

// The snowfield's back row: blue mountains with snowy caps, white hills in front, the northern lights at night.
function peakTop(x: number): number {
  const ridge = Math.abs(((x / 15 + noise(Math.floor(x / 30)) * 0.6) % 2) - 1);
  return 3 + Math.round(ridge * 6);
}

function snowHill(x: number): number {
  return 11 + Math.round(Math.sin(x / 11) * 1.2 + Math.sin(x / 4.5) * 0.4);
}

function drawPeaks(kit: Kit, palette: ScenePalette, width: number, seconds: number, light: SceneLight): void {
  const { rect, context } = kit;
  if (light.stars > 0.3) {
    context.globalAlpha = Math.min(0.55, light.stars * 0.6);
    for (let x = 0; x < width; x++) {
      const y = 2 + Math.sin(x / 9 + seconds * 0.5) * 1.3 + Math.sin(x / 23 - seconds * 0.3);
      const bright = 0.5 + 0.5 * Math.sin(x / 17 + seconds * 0.8);
      rect(x, Math.round(y), 1, 2, bright > 0.4 ? "#5AF0A0" : "#3AC890");
      if (bright > 0.6) {
        rect(x, Math.round(y) + 2, 1, 1, "#B080F0");
      }
    }
    context.globalAlpha = 1;
  }
  for (let x = 0; x < width; x += 2) {
    const top = peakTop(x);
    rect(x, top, 2, TILE - top, palette.wall);
    rect(x, top, 2, top < 6 ? 2 : 1, "#FFFFFF");
    if (noise(x) > 0.6) {
      rect(x, top + 3, 1, 2, "#6E86A8");
    }
  }
  for (let x = 0; x < width; x += 2) {
    const top = snowHill(x);
    rect(x, top, 2, TILE - top, "#F4F8FC");
    rect(x, top, 2, 1, "#FFFFFF");
  }
  for (let x = 5; x < width; x += 13) {
    // Little pines dotted along the hills.
    const base = snowHill(x);
    rect(x, base - 4, 1, 1, "#2F5A4E");
    rect(x - 1, base - 3, 3, 2, "#2F5A4E");
    rect(x - 1, base - 3, 1, 1, "#FFFFFF");
    rect(x, base - 1, 1, 1, "#4A3220");
  }
}

// The desert's back row: flat-topped red mesas with layered bands, and dunes in front.
function mesaTop(x: number): number {
  const segment = Math.floor(x / 40);
  const local = x - segment * 40;
  if (noise(segment + 3) < 0.3 || local < 5 || local > 34) {
    return 13;
  }
  const top = 4 + Math.floor(noise(segment * 3) * 3);
  // Sloping shoulders.
  const edge = Math.min(local - 5, 34 - local);
  return edge < 3 ? top + (3 - edge) * 2 : top;
}

function duneTop(x: number): number {
  return 11 + Math.round(Math.sin(x / 13) * 1.5 + Math.sin(x / 5) * 0.5);
}

function drawMesa(kit: Kit, palette: ScenePalette, width: number): void {
  const { rect } = kit;
  for (let x = 0; x < width; x += 2) {
    const top = mesaTop(x);
    if (top < 13) {
      rect(x, top, 2, TILE - top, palette.wall);
      rect(x, top, 2, 1, "#E09A6A");
      rect(x, top + 3, 2, 1, "#B0603A");
      rect(x, top + 5, 2, 1, "#D8885A");
    }
  }
  for (let x = 0; x < width; x += 2) {
    const top = duneTop(x);
    rect(x, top, 2, TILE - top, palette.wallTrim);
    rect(x, top, 2, 1, "#F4D8A8");
  }
  for (let x = 23; x < width; x += 47) {
    // A far cactus or two on the dunes.
    const base = duneTop(x);
    rect(x, base - 4, 1, 4, "#4E8A4A");
    rect(x - 1, base - 3, 1, 1, "#4E8A4A");
    rect(x + 1, base - 2, 1, 1, "#4E8A4A");
  }
}

// The reef's back row: deep water with sun rays slanting down, the surface shimmering above, and the far reef.
function drawWater(kit: Kit, palette: ScenePalette, width: number, seconds: number): void {
  const { rect, context } = kit;
  rect(0, 0, width, TILE, palette.wall);
  rect(0, 0, width, 4, "#2A78B0");
  for (let x = 0; x < width; x += 4) {
    const shimmer = Math.round(Math.sin(seconds * 2 + x / 5) * 1.5);
    rect(x + shimmer + 2, 0, 2, 1, "#8ED0F4");
  }
  context.globalAlpha = 0.25;
  for (let ray = 0; ray < width / 30; ray++) {
    const start = ((ray * 37 + seconds * 2) % (width + 30)) - 15;
    for (let y = 0; y < 12; y++) {
      rect(Math.round(start + y * 0.6), y, 3, 1, "#8ED0F4");
    }
  }
  context.globalAlpha = 1;
  for (let x = 0; x < width; x += 2) {
    const top = 10 + Math.round(noise(Math.floor(x / 6)) * 3);
    rect(x, top, 2, TILE - top, palette.wallTrim);
  }
  for (let x = 9; x < width; x += 17) {
    const sway = Math.round(Math.sin(seconds * 1.1 + x) * 1);
    rect(x + sway, 4, 1, 8, "#174A70");
    rect(x + sway + 1, 6, 1, 2, "#174A70");
  }
  rect(0, TILE - 2, width, 2, "#0B3254");
}

// The library's back row: bookshelves floor to ceiling, with tall arched windows between them.
export const LIBRARY_WINDOW_EVERY = 5;

function drawBookcases(kit: Kit, palette: ScenePalette, width: number, light: SceneLight): void {
  const { rect } = kit;
  rect(0, 0, width, TILE, palette.wall);
  const colors = ["#8A2E2E", "#2E5A8A", "#3E7A3E", "#8A6A2E", "#5A2E7A", "#2E2E3A", "#A8743A"];
  for (const shelfTop of [0, 5, 10]) {
    for (let x = 0; x < width; x += 2) {
      const height = 3 + Math.floor(noise(x * 7 + shelfTop) * 2);
      rect(x, shelfTop + 4 - height, 2, height, colors[Math.floor(noise(x * 3 + shelfTop * 11) * colors.length)]);
    }
    rect(0, shelfTop + 4, width, 1, palette.wallTrim);
  }
  for (let column = 3; column * TILE < width - TILE; column += LIBRARY_WINDOW_EVERY) {
    const left = column * TILE + 1;
    rect(left, 0, 14, 13, palette.wallTrim);
    rect(left + 1, 2, 12, 10, light.sky);
    rect(left + 3, 1, 8, 1, light.sky);
    if (light.stars > 0) {
      kit.context.globalAlpha = light.stars;
      rect(left + 4, 4, 1, 1, "#FFFFFF");
      rect(left + 9, 3, 1, 1, "#FFF6C8");
      rect(left + 7, 8, 1, 1, "#FFFFFF");
      kit.context.globalAlpha = 1;
    }
    rect(left + 7, 1, 1, 11, palette.wallTrim);
    rect(left + 1, 6, 12, 1, palette.wallTrim);
  }
  rect(0, TILE - 3, width, 3, palette.wallTrim);
  rect(0, TILE - 3, width, 1, "#7A5232");
}

// The rooftop's back row: the city's towers against the sky, a water tower, and the parapet. Lit windows come on
// after dark, drawn after the light map so they glow.
interface Tower {
  left: number;
  width: number;
  top: number;
  near: boolean;
}

function skylineTowers(width: number): Tower[] {
  const towers: Tower[] = [];
  for (const near of [false, true]) {
    let left = near ? -3 : -6;
    for (let index = 0; left < width; index++) {
      const towerWidth = 7 + Math.floor(noise(index * 5 + (near ? 50 : 0)) * 9);
      const top = near ? 6 + Math.floor(noise(index * 7 + 9) * 5) : 2 + Math.floor(noise(index * 3 + 1) * 5);
      towers.push({ left, width: towerWidth, top, near });
      left += towerWidth + (near ? 2 + Math.floor(noise(index + 70) * 6) : 0);
    }
  }
  return towers;
}

function skylineTop(x: number): number {
  // The towers are laid out from the left, so any room width gives the same tops.
  let top = 13;
  for (const tower of skylineTowers(x + 1)) {
    if (x >= tower.left && x < tower.left + tower.width) {
      top = Math.min(top, tower.top);
    }
  }
  return top;
}

function drawSkyline(kit: Kit, palette: ScenePalette, width: number): void {
  const { rect } = kit;
  for (const tower of skylineTowers(width)) {
    const color = tower.near ? palette.wall : "#9AA8BC";
    rect(tower.left, tower.top, tower.width, TILE - tower.top, color);
    if (tower.near) {
      for (let y = tower.top + 2; y < 13; y += 2) {
        for (let x = tower.left + 1; x < tower.left + tower.width - 1; x += 2) {
          rect(x, y, 1, 1, "#8A9AB0");
        }
      }
    } else if (noise(tower.left) > 0.7) {
      rect(tower.left + Math.floor(tower.width / 2), tower.top - 3, 1, 3, "#9AA8BC");
    }
  }
  const tank = Math.floor(width * 0.62);
  rect(tank, 4, 7, 5, "#8A5A3A");
  rect(tank + 1, 3, 5, 1, "#6A4428");
  rect(tank + 3, 2, 1, 1, "#6A4428");
  rect(tank + 1, 9, 1, 4, "#4A3A30");
  rect(tank + 5, 9, 1, 4, "#4A3A30");
  rect(tank, 6, 7, 1, "#6A4428");
  rect(0, 13, width, 3, palette.wallTrim);
  rect(0, 13, width, 1, "#A8A296");
}

// Extra ground detail for the newer floors, over the base color and its lump. at(salt) is a spot in the tile.
export function drawGroundDetail(kit: Kit, palette: ScenePalette, seed: number, at: (salt: number) => { x: number; y: number }): void {
  const { rect } = kit;
  switch (palette.floorStyle) {
    case "sand": {
      for (let speck = 0; speck < 3; speck++) {
        const spot = at(60 + speck);
        rect(spot.x, spot.y, 1, 1, palette.floorLine);
      }
      if (noise(seed + 64) > 0.82) {
        const shell = at(65);
        rect(shell.x, shell.y, 2, 1, "#F8EEE0");
        rect(shell.x, shell.y + 1, 2, 1, "#E8A8A0");
      }
      return;
    }
    case "snow": {
      const sparkle = at(70);
      rect(sparkle.x, sparkle.y, 1, 1, "#FFFFFF");
      const dip = at(71);
      rect(dip.x, dip.y, 2, 1, palette.floorLine);
      if (noise(seed + 72) > 0.78) {
        const track = at(73);
        rect(track.x, track.y, 1, 1, "#D4E0EC");
        rect(track.x + 2, track.y + 2, 1, 1, "#D4E0EC");
      }
      return;
    }
    case "dunes": {
      const ripple = at(80);
      rect(ripple.x, ripple.y, 4, 1, palette.floorLine);
      rect(ripple.x + 3, ripple.y + 1, 3, 1, palette.floorLine);
      if (noise(seed + 81) > 0.85) {
        const pebble = at(82);
        rect(pebble.x, pebble.y, 2, 1, "#A07A4A");
      }
      return;
    }
    case "seabed": {
      for (let speck = 0; speck < 2; speck++) {
        const spot = at(90 + speck);
        rect(spot.x, spot.y, 1, 1, palette.floorLine);
      }
      if (noise(seed + 93) > 0.75) {
        const tuft = at(94);
        rect(tuft.x, tuft.y, 1, 3, "#4E9A5A");
        rect(tuft.x + 2, tuft.y - 1, 1, 4, "#5AAE5A");
      } else if (noise(seed + 95) > 0.85) {
        const shell = at(96);
        rect(shell.x, shell.y, 2, 1, "#F4D0C8");
      }
      return;
    }
    case "gravel": {
      for (let speck = 0; speck < 5; speck++) {
        const spot = at(100 + speck);
        rect(spot.x, spot.y, 1, 1, speck % 2 === 0 ? "#48484E" : "#74747A");
      }
      if (seed % 5 === 0) {
        const seam = at(106);
        rect(seam.x, seam.y, 6, 1, "#3A3A40");
      }
      return;
    }
  }
}

export function drawSceneryProp(kit: Kit, kind: PropKind, left: number, top: number, seconds: number, index: number): void {
  const { rect, glow, context } = kit;
  switch (kind) {
    case "palm": {
      for (let row = 0; row < 22; row++) {
        const x = left + 7 + Math.round(Math.sin(row / 7) * 1.5);
        rect(x, top + 16 - row, 2, 1, row % 3 === 0 ? "#7A5230" : "#9A6A3E");
      }
      const crown = top - 6;
      const sway = Math.round(Math.sin(seconds * 0.9 + index) * 0.6);
      rect(left + 6, crown, 4, 2, "#3E9A4A");
      rect(left - 1 + sway, crown - 1, 8, 2, "#5ABE5A");
      rect(left - 3 + sway, crown + 1, 3, 2, "#3E9A4A");
      rect(left + 9 + sway, crown - 1, 8, 2, "#5ABE5A");
      rect(left + 16 + sway, crown + 1, 3, 2, "#3E9A4A");
      rect(left + 4, crown - 3, 3, 2, "#3E9A4A");
      rect(left + 9, crown - 3, 3, 2, "#3E9A4A");
      rect(left + 6, crown + 2, 2, 2, "#6A4424");
      rect(left + 8, crown + 2, 2, 2, "#5A3A20");
      return;
    }
    case "tiki":
      // A little bar with a thatch roof, a torch, and drinks on the counter.
      rect(left + 1, top - 4, 2, 12, "#8A5A2E");
      rect(left + 13, top - 4, 2, 12, "#8A5A2E");
      rect(left, top - 8, 16, 4, "#D8B060");
      for (let x = 0; x < 16; x += 2) {
        rect(left + x, top - 4, 1, 1 + ((x / 2 + index) % 2), "#B8903E");
      }
      rect(left, top + 6, 16, 10, "#A0703E");
      rect(left, top + 6, 16, 2, "#C08A50");
      rect(left + 3, top + 10, 1, 6, "#7A5230");
      rect(left + 8, top + 10, 1, 6, "#7A5230");
      rect(left + 12, top + 10, 1, 6, "#7A5230");
      rect(left + 4, top + 3, 2, 3, "#F06595");
      rect(left + 3, top + 2, 3, 1, "#4CB944");
      rect(left + 9, top + 3, 3, 3, "#6A4424");
      rect(left + 10, top + 2, 1, 1, "#F4C848");
      return;
    case "umbrella": {
      rect(left + 7, top - 6, 1, 22, "#E8E8E8");
      const stripe = (x: number) => (Math.floor(x / 3) % 2 === 0 ? "#E8404A" : "#FFFFFF");
      for (let x = 5; x < 11; x++) {
        rect(left + x, top - 10, 1, 1, stripe(x));
      }
      for (let x = 2; x < 14; x++) {
        rect(left + x, top - 9, 1, 1, stripe(x));
      }
      for (let x = 0; x < 16; x++) {
        rect(left + x, top - 8, 1, 2, stripe(x));
      }
      rect(left + 7, top - 11, 1, 1, "#E8E8E8");
      rect(left + 1, top + 13, 12, 3, "#F4E4BA");
      return;
    }
    case "sandcastle": {
      rect(left + 1, top + 8, 14, 8, "#E0C080");
      rect(left + 2, top + 3, 4, 6, "#E0C080");
      rect(left + 10, top + 3, 4, 6, "#E0C080");
      rect(left + 2, top + 2, 1, 1, "#E0C080");
      rect(left + 5, top + 2, 1, 1, "#E0C080");
      rect(left + 10, top + 2, 1, 1, "#E0C080");
      rect(left + 13, top + 2, 1, 1, "#E0C080");
      rect(left + 1, top + 8, 14, 1, "#F0D498");
      rect(left + 7, top + 11, 2, 5, "#B89858");
      rect(left + 3, top + 5, 1, 1, "#B89858");
      rect(left + 12, top + 5, 1, 1, "#B89858");
      rect(left + 11, top - 2, 1, 5, "#B8B8B8");
      rect(left + 12, top - 2, 2 + (Math.floor(seconds * 3) % 2), 2, "#E8404A");
      return;
    }
    case "snowPine":
      rect(left + 7, top + 9, 2, 7, "#4A3220");
      for (let row = 0; row < 18; row++) {
        const half = 1 + Math.floor((row % 6) * 0.9 + row / 4);
        rect(left + 8 - half, top - 9 + row, half * 2, 1, row % 6 < 2 ? "#3E6E5A" : "#2F5A4E");
        if (row % 6 === 0) {
          rect(left + 8 - half, top - 9 + row, half * 2, 1, "#FFFFFF");
        }
      }
      return;
    case "cocoa": {
      // A cocoa stand: a steaming pot on a wooden counter, mugs at the end.
      rect(left + 1, top + 5, 14, 11, "#8A5A34");
      rect(left, top + 4, 16, 2, "#A8784A");
      rect(left + 3, top + 9, 10, 4, "#F4EEDC");
      rect(left + 4, top + 10, 8, 1, "#8A5A34");
      rect(left + 6, top + 12, 4, 1, "#8A5A34");
      rect(left + 3, top - 1, 7, 5, "#3A3A44");
      rect(left + 3, top - 1, 7, 1, "#6A4A30");
      rect(left + 12, top + 1, 2, 3, "#C0392B");
      rect(left + 14, top + 2, 1, 1, "#C0392B");
      context.globalAlpha = 0.6;
      for (let puff = 0; puff < 3; puff++) {
        const rise = (seconds * 4 + puff * 3) % 9;
        rect(left + 5 + puff + Math.round(Math.sin(seconds * 2 + puff)), top - 2 - Math.floor(rise), 1, 1, "#FFFFFF");
      }
      context.globalAlpha = 1;
      return;
    }
    case "snowman":
      rect(left + 4, top + 6, 8, 10, "#FFFFFF");
      rect(left + 3, top + 8, 10, 6, "#FFFFFF");
      rect(left + 4, top + 14, 8, 2, "#DCE6F0");
      rect(left + 5, top, 6, 7, "#FFFFFF");
      rect(left + 4, top + 1, 8, 5, "#FFFFFF");
      rect(left + 7, top + 2, 1, 1, "#2A2A30");
      rect(left + 7, top + 4, 1, 1, "#2A2A30");
      rect(left + 7, top + 9, 1, 1, "#2A2A30");
      rect(left + 5, top - 6, 6, 6, "#FFFFFF");
      rect(left + 6, top - 4, 1, 1, "#2A2A30");
      rect(left + 9, top - 4, 1, 1, "#2A2A30");
      rect(left + 10, top - 3, 3, 1, "#F08C3A");
      rect(left + 4, top - 1, 8, 2, "#C0392B");
      rect(left + 5, top + 1, 2, 3, "#C0392B");
      rect(left + 4, top - 7, 8, 1, "#2A2A30");
      rect(left + 5, top - 10, 6, 3, "#2A2A30");
      rect(left + 1, top + 1, 3, 1, "#6A4424");
      rect(left, top, 1, 1, "#6A4424");
      rect(left + 12, top + 1, 3, 1, "#6A4424");
      rect(left + 15, top, 1, 1, "#6A4424");
      return;
    case "igloo": {
      for (let row = 0; row < 13; row++) {
        const rise = (12 - row) / 12;
        const half = Math.round(Math.sqrt(Math.max(0, 1 - rise * rise)) * 8);
        rect(left + 8 - half, top + 3 + row, half * 2, 1, row % 3 === 2 ? "#C9D6E4" : "#F4F8FC");
      }
      for (let row = 2; row < 13; row += 3) {
        rect(left + 4 + ((row * 3) % 5), top + 3 + row - 2, 1, 2, "#C9D6E4");
        rect(left + 10 + ((row * 2) % 3), top + 3 + row - 2, 1, 2, "#C9D6E4");
      }
      rect(left + 5, top + 11, 6, 5, "#C9D6E4");
      rect(left + 6, top + 12, 4, 4, "#2A3450");
      rect(left + 7, top + 11, 2, 1, "#2A3450");
      return;
    }
    case "cactus":
      rect(left + 6, top - 6, 4, 22, "#4E9A4A");
      rect(left + 7, top - 7, 2, 1, "#4E9A4A");
      rect(left + 7, top - 5, 1, 20, "#3E7A3A");
      rect(left + 2, top + 1, 4, 2, "#4E9A4A");
      rect(left + 2, top - 3, 2, 5, "#4E9A4A");
      rect(left + 10, top + 4, 3, 2, "#4E9A4A");
      rect(left + 12, top - 1, 2, 6, "#4E9A4A");
      rect(left + 2, top - 3, 1, 4, "#3E7A3A");
      rect(left + 7, top - 8, 2, 1, "#F06595");
      return;
    case "oasis": {
      // A spring-fed pool in the sand, with reeds.
      rect(left + 1, top + 8, 14, 7, "#C49558");
      rect(left + 2, top + 9, 12, 5, "#3C9AC8");
      const ring = Math.floor(seconds * 2) % 4;
      rect(left + 8 - ring, top + 11, 1 + ring * 2, 1, "#8FD3F4");
      for (let reed = 0; reed < 3; reed++) {
        const sway = Math.round(Math.sin(seconds * 1.2 + reed) * 0.8);
        rect(left + 2 + reed * 2 + sway, top + 2 + reed, 1, 7 - reed, "#4E9A4A");
      }
      rect(left + 12, top + 4, 1, 5, "#4E9A4A");
      return;
    }
    case "skull":
      rect(left + 5, top + 10, 6, 4, "#F4EEE0");
      rect(left + 6, top + 14, 4, 2, "#F4EEE0");
      rect(left + 6, top + 11, 1, 1, "#3A2A1A");
      rect(left + 9, top + 11, 1, 1, "#3A2A1A");
      rect(left + 2, top + 9, 3, 1, "#E8E0CC");
      rect(left + 1, top + 7, 1, 2, "#E8E0CC");
      rect(left + 11, top + 9, 3, 1, "#E8E0CC");
      rect(left + 14, top + 7, 1, 2, "#E8E0CC");
      rect(left + 3, top + 15, 10, 1, "#C49558");
      return;
    case "urn":
      rect(left + 4, top + 4, 8, 11, "#C9784A");
      rect(left + 3, top + 6, 10, 7, "#C9784A");
      rect(left + 6, top + 1, 4, 3, "#C9784A");
      rect(left + 5, top, 6, 1, "#B0603A");
      rect(left + 3, top + 8, 10, 1, "#F0D4A0");
      for (let x = 4; x < 12; x += 2) {
        rect(left + x, top + 10, 1, 1, "#7A3A20");
      }
      rect(left + 4, top + 5, 1, 4, "#E09A6A");
      rect(left + 5, top + 15, 6, 1, "#8A4A2A");
      return;
    case "kelp":
      for (let strand = 0; strand < 3; strand++) {
        for (let row = 0; row < 24; row++) {
          const bend = Math.round(Math.sin(seconds * 1.2 + row * 0.35 + strand + index) * 1.4 * (row / 24));
          const x = left + 2 + strand * 5 + bend;
          rect(x, top + 16 - row, 2, 1, strand === 1 ? "#5AAE5A" : "#3E8A4A");
          if (row % 5 === 3) {
            rect(x + 2, top + 16 - row, 2, 1, "#6AC46A");
          }
        }
      }
      return;
    case "vent": {
      // A rocky vent breathing out air bubbles, for a breath.
      rect(left + 3, top + 6, 10, 10, "#6E6A60");
      rect(left + 5, top + 3, 6, 3, "#6E6A60");
      rect(left + 6, top + 3, 4, 1, "#2A2A30");
      rect(left + 4, top + 8, 2, 4, "#8E8574");
      rect(left + 10, top + 10, 2, 3, "#5A564E");
      for (let bubble = 0; bubble < 4; bubble++) {
        const rise = (seconds * 10 + bubble * 6) % 22;
        const x = left + 7 + Math.round(Math.sin(seconds * 3 + bubble * 2) * 1.5);
        const size = bubble % 2 === 0 ? 2 : 1;
        rect(x, top + 2 - Math.floor(rise), size, size, "#CFEFFF");
      }
      return;
    }
    case "coral":
      rect(left + 2, top + 13, 12, 3, "#B86A5A");
      rect(left + 4, top + 2, 2, 11, "#F06595");
      rect(left + 2, top + 5, 2, 2, "#F06595");
      rect(left + 1, top + 2, 2, 3, "#F06595");
      rect(left + 6, top + 6, 2, 2, "#F06595");
      rect(left + 7, top + 3, 2, 3, "#F06595");
      rect(left + 4, top + 1, 2, 1, "#F8A8C8");
      rect(left + 9, top + 5, 5, 8, "#B197FC");
      rect(left + 10, top + 3, 3, 2, "#B197FC");
      rect(left + 10, top + 6, 1, 1, "#7A5AC8");
      rect(left + 12, top + 8, 1, 1, "#7A5AC8");
      rect(left + 11, top + 10, 1, 1, "#7A5AC8");
      rect(left + 7, top + 10, 2, 3, "#F08C4A");
      return;
    case "chest": {
      rect(left + 2, top + 7, 12, 9, "#8A5A2E");
      rect(left + 2, top + 1, 12, 3, "#A06A36");
      rect(left + 3, top + 4, 10, 3, "#F4C848");
      rect(left + 2, top + 7, 12, 1, "#E8C048");
      rect(left + 2, top + 12, 12, 1, "#6A4424");
      rect(left + 7, top + 8, 2, 3, "#E8C048");
      const glint = Math.floor(seconds * 2 + index) % 5;
      rect(left + 4 + glint * 2, top + 4, 1, 1, "#FFFFFF");
      glow(left + 8, top + 5, 6, "#F4D860", 0.15);
      return;
    }
    case "cauldron": {
      // A bubbling cauldron over a little fire, for a sip of something green.
      for (let flame = 0; flame < 3; flame++) {
        const height = 2 + Math.floor(noise(flame * 7 + Math.floor(seconds * 8)) * 3);
        rect(left + 5 + flame * 2, top + 16 - height, 2, height, flame % 2 === 0 ? "#F76707" : "#FFD43B");
      }
      rect(left + 3, top + 6, 10, 8, "#2A2A30");
      rect(left + 2, top + 7, 12, 5, "#2A2A30");
      rect(left + 2, top + 5, 12, 2, "#3A3A44");
      rect(left + 3, top + 5, 10, 1, "#7AF07A");
      rect(left + 3, top + 14, 2, 2, "#2A2A30");
      rect(left + 11, top + 14, 2, 2, "#2A2A30");
      const pop = Math.floor(seconds * 3 + index) % 4;
      rect(left + 4 + pop * 2, top + 4, 2, 1, "#B8FFB0");
      context.globalAlpha = 0.5;
      for (let puff = 0; puff < 3; puff++) {
        const rise = (seconds * 5 + puff * 4) % 12;
        rect(left + 6 + puff * 2 + Math.round(Math.sin(seconds + puff) * 1.5), top + 3 - Math.floor(rise), 1, 1, "#9AF09A");
      }
      context.globalAlpha = 1;
      return;
    }
    case "globe": {
      rect(left + 4, top + 14, 8, 2, "#5A3A22");
      rect(left + 7, top + 10, 2, 4, "#8A5A2E");
      const turn = seconds * 3;
      for (let dy = -5; dy <= 5; dy++) {
        const half = Math.round(Math.sqrt(25 - dy * dy));
        for (let dx = -half; dx < half; dx++) {
          const land = noise(Math.floor((dx + turn) / 3) * 7 + Math.floor((dy + 5) / 3) * 13) > 0.55;
          rect(left + 8 + dx, top + 4 + dy, 1, 1, land ? "#5AAE5A" : "#3A78B8");
        }
      }
      rect(left + 2, top + 3, 1, 3, "#E8C048");
      rect(left + 13, top + 3, 1, 3, "#E8C048");
      rect(left + 3, top - 2, 1, 2, "#E8C048");
      rect(left + 12, top + 6, 1, 3, "#E8C048");
      rect(left + 7, top - 2, 2, 1, "#E8C048");
      return;
    }
    case "candelabra": {
      rect(left + 7, top - 2, 2, 16, "#C8A040");
      rect(left + 4, top + 14, 8, 2, "#C8A040");
      rect(left + 3, top + 1, 10, 1, "#C8A040");
      rect(left + 3, top - 1, 1, 2, "#C8A040");
      rect(left + 12, top - 1, 1, 2, "#C8A040");
      rect(left + 2, top - 4, 3, 3, "#F4EEDC");
      rect(left + 6, top - 7, 4, 5, "#F4EEDC");
      rect(left + 11, top - 4, 3, 3, "#F4EEDC");
      for (const [x, y, salt] of [[3, -6, 1], [7, -9, 2], [12, -6, 3]] as const) {
        const tall = noise(salt + Math.floor(seconds * 7)) > 0.5;
        rect(left + x, top + y + (tall ? 0 : 1), 1, tall ? 2 : 1, "#FFD43B");
        rect(left + x, top + y + 1, 1, 1, "#F76707");
      }
      glow(left + 8, top - 6, 9, "#FFC870", 0.25 + 0.05 * Math.sin(seconds * 6));
      return;
    }
    case "ac": {
      rect(left + 1, top + 4, 14, 12, "#B8BCC4");
      rect(left + 1, top + 3, 14, 1, "#D8DCE4");
      rect(left + 3, top + 6, 10, 8, "#5A5E66");
      const spin = Math.floor(seconds * 10) % 2;
      if (spin === 0) {
        rect(left + 7, top + 6, 2, 8, "#9AA0AA");
        rect(left + 3, top + 9, 10, 2, "#9AA0AA");
      } else {
        for (let step = 0; step < 4; step++) {
          rect(left + 4 + step * 2, top + 7 + step * 2, 2, 1, "#9AA0AA");
          rect(left + 10 - step * 2, top + 7 + step * 2, 2, 1, "#9AA0AA");
        }
      }
      rect(left + 7, top + 9, 2, 2, "#3A3E46");
      rect(left + 1, top + 15, 14, 1, "#8A8E96");
      return;
    }
    case "grill": {
      rect(left + 3, top + 5, 10, 5, "#2A2A30");
      rect(left + 4, top + 10, 8, 1, "#2A2A30");
      rect(left + 2, top + 4, 12, 1, "#8A8E96");
      rect(left + 4, top + 3, 3, 1, "#C0603A");
      rect(left + 8, top + 3, 3, 1, "#C0603A");
      rect(left + 4, top + 11, 1, 5, "#3A3A44");
      rect(left + 11, top + 11, 1, 5, "#3A3A44");
      rect(left + 7, top + 11, 2, 5, "#3A3A44");
      context.globalAlpha = 0.45;
      for (let puff = 0; puff < 4; puff++) {
        const rise = (seconds * 4 + puff * 3) % 14;
        rect(left + 5 + puff * 2 + Math.round(Math.sin(seconds * 1.5 + puff) * 1.5), top + 2 - Math.floor(rise), 2, 1, "#C8C8D0");
      }
      context.globalAlpha = 1;
      return;
    }
    case "antenna": {
      rect(left + 7, top - 12, 1, 28, "#8A8E96");
      rect(left + 4, top - 9, 7, 1, "#8A8E96");
      rect(left + 3, top - 5, 9, 1, "#8A8E96");
      rect(left + 5, top - 1, 5, 1, "#8A8E96");
      rect(left + 9, top + 3, 4, 4, "#D8DCE4");
      rect(left + 8, top + 4, 1, 2, "#8A8E96");
      rect(left + 5, top + 13, 6, 3, "#6A6E76");
      rect(left + 7, top - 13, 1, 1, Math.floor(seconds * 1.2) % 2 === 0 ? "#FF5050" : "#5C2A2A");
      return;
    }
  }
}

// The glow a prop gives off once it's dark: where, how big, and what color. Undefined for one that's dark itself.
export function propLight(kind: PropKind): { dx: number; dy: number; radius: number; color: string; alpha: number } | undefined {
  switch (kind) {
    case "tiki":
      return { dx: 8, dy: 2, radius: 16, color: "#FFB060", alpha: 0.5 };
    case "cocoa":
      return { dx: 8, dy: 4, radius: 11, color: "#FFB070", alpha: 0.35 };
    case "igloo":
      return { dx: 8, dy: 14, radius: 10, color: "#FFB060", alpha: 0.4 };
    case "cauldron":
      return { dx: 8, dy: 6, radius: 18, color: "#7AF07A", alpha: 0.45 };
    case "candelabra":
      return { dx: 8, dy: -5, radius: 28, color: "#FFC870", alpha: 0.75 };
    case "chest":
      return { dx: 8, dy: 4, radius: 9, color: "#F4D860", alpha: 0.3 };
    case "grill":
      return { dx: 8, dy: 5, radius: 12, color: "#FF8040", alpha: 0.35 };
    case "antenna":
      return { dx: 8, dy: -12, radius: 6, color: "#FF5050", alpha: 0.4 };
    default:
      return undefined;
  }
}

// Snow falling over the snowfield, and bubbles rising through the reef. Drawn under the light map, so night dims it.
export function drawWeather(kit: Kit, sceneId: OfficeSceneId, roomWidth: number, roomHeight: number, seconds: number): void {
  const { rect, context } = kit;
  if (sceneId === "snowfield") {
    context.globalAlpha = 0.85;
    for (let flake = 0; flake < (roomWidth * roomHeight) / 500; flake++) {
      const fall = 8 + noise(flake * 5) * 8;
      const x = (noise(flake) * roomWidth + Math.sin(seconds * 0.7 + flake) * 4 + seconds * 3) % roomWidth;
      const y = (noise(flake * 3) * roomHeight + seconds * fall) % roomHeight;
      rect(Math.floor(x), Math.floor(y), 1, 1, "#FFFFFF");
    }
    context.globalAlpha = 1;
  } else if (sceneId === "reef") {
    context.globalAlpha = 0.55;
    for (let bubble = 0; bubble < roomWidth / 18; bubble++) {
      const rise = (seconds * (8 + noise(bubble * 9) * 6) + noise(bubble) * roomHeight) % (roomHeight + 8);
      const x = noise(bubble * 7) * roomWidth + Math.sin(seconds * 2 + bubble) * 2;
      const size = bubble % 3 === 0 ? 2 : 1;
      rect(Math.floor(x), Math.floor(roomHeight - rise), size, size, "#CFEFFF");
    }
    context.globalAlpha = 1;
  }
}

// The rooftop's city windows after dark, drawn over the light map so they glow.
export function drawAfterLight(kit: Kit, sceneId: OfficeSceneId, roomWidth: number, light: SceneLight): void {
  if (sceneId !== "rooftop" || light.stars < 0.15) {
    return;
  }
  const { rect, context } = kit;
  context.save();
  context.beginPath();
  context.rect(0, 0, roomWidth, 13);
  context.clip();
  context.globalAlpha = Math.min(1, light.stars * 1.6);
  for (const tower of skylineTowers(roomWidth)) {
    const step = tower.near ? 2 : 3;
    for (let y = tower.top + 2; y < 13; y += step) {
      for (let x = tower.left + 1; x < tower.left + tower.width - 1; x += step) {
        if (noise(x * 13 + y * 7) > 0.55) {
          rect(x, y, 1, 1, noise(x + y) > 0.8 ? "#BFE0FF" : "#FFD98A");
        }
      }
    }
  }
  context.restore();
}
