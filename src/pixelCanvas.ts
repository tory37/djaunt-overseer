// Pure: the drawing grid the pixel guys and their races share, and the color helpers.

export type PaletteKey =
  | "skin" | "skinShade" | "hair" | "eye" | "mouth" | "shirt" | "shirtShade" | "pants" | "pantsShade" | "shoes"
  | "accessory" | "accessoryLight" | "cup" | "sleeve" | "sleeveShade" | "stubble" | "beard" | "hairTie"
  // A race's own colors: horns, tusks, scales, wings, and the like.
  | "markA" | "markAShade" | "markB" | "markC"
  // A visiting boss's tie.
  | "tie" | "tieShade";

export const INNER_WIDTH = 10;
// The body is 16 rows: the head from row 0, the feet on row 15.
export const BODY_HEIGHT = 16;
// Rows above the head for horns, ears, antennae, and hats. Drawing code uses y = -1 and -2 for them.
export const HEAD_ROOM = 2;
export const INNER_HEIGHT = BODY_HEIGHT + HEAD_ROOM;

export class Canvas {
  readonly cells: (PaletteKey | null)[][] = Array.from({ length: INNER_HEIGHT }, () => Array<PaletteKey | null>(INNER_WIDTH).fill(null));

  set(x: number, y: number, key: PaletteKey | null): void {
    const row = y + HEAD_ROOM;
    if (x >= 0 && row >= 0 && x < INNER_WIDTH && row < INNER_HEIGHT) {
      this.cells[row][x] = key;
    }
  }

  get(x: number, y: number): PaletteKey | null {
    return this.cells[y + HEAD_ROOM]?.[x] ?? null;
  }

  rect(x: number, y: number, width: number, height: number, key: PaletteKey | null): void {
    for (let row = y; row < y + height; row++) {
      for (let column = x; column < x + width; column++) {
        this.set(column, row, key);
      }
    }
  }

  // Calls back with each cell, in body coordinates (the head room is y < 0).
  each(visit: (key: PaletteKey | null, x: number, y: number) => void): void {
    this.cells.forEach((row, index) => row.forEach((key, x) => visit(key, x, index - HEAD_ROOM)));
  }

  // Swaps one key for another everywhere it's drawn, optionally only in some rows.
  recolor(from: PaletteKey, to: PaletteKey | null, fromY = -HEAD_ROOM, toY = BODY_HEIGHT - 1): void {
    this.each((key, x, y) => {
      if (key === from && y >= fromY && y <= toY) {
        this.set(x, y, to);
      }
    });
  }

  mirrored(): Canvas {
    const mirror = new Canvas();
    this.each((key, x, y) => mirror.set(INNER_WIDTH - 1 - x, y, key));
    return mirror;
  }
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

// A blend of two #rrggbb colors: 0 is all the first, 1 all the second.
export function mixHex(first: string, second: string, amount: number): string {
  const parse = (hex: string) => {
    const match = /^#([0-9a-f]{6})$/i.exec(hex);
    return match === null ? undefined : [16, 8, 0].map((shift) => (parseInt(match[1], 16) >> shift) & 255);
  };
  const from = parse(first);
  const to = parse(second);
  if (from === undefined || to === undefined) {
    return first;
  }
  return "#" + from.map((channel, index) => Math.round(channel + (to[index] - channel) * amount).toString(16).padStart(2, "0")).join("").toUpperCase();
}
