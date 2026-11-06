// The critters' pixel sprites: two frames each, drawn facing right with their feet on the bottom row, and mirrored
// to face left. "." is clear. Where they go comes from officeCritters.

import type { CritterKind, CritterPose } from "../officeCritters";

type Rect = (x: number, y: number, w: number, h: number, color: string) => void;

interface CritterSprite {
  colors: Record<string, string>;
  frames: [string[], string[]];
}

// The frames share their top rows; only the last few differ.
function legs(body: string[], first: string[], second: string[]): [string[], string[]] {
  return [[...body, ...first], [...body, ...second]];
}

const MOUSE_BODY = ["......pp..", "t..gggggg.", ".tgggggkgn", "..ggggggg."];

const SPRITES: Record<CritterKind, CritterSprite> = {
  mouse: {
    colors: { g: "#9A98A0", k: "#1A1A1A", n: "#F08AA0", p: "#F4B0C0", t: "#E59AAE" },
    frames: legs(MOUSE_BODY, ["...g...g.."], ["....g.g..."]),
  },
  rat: {
    colors: { g: "#6E5E52", k: "#E04848", n: "#E2909C", p: "#C99098", t: "#B8848C" },
    frames: legs([".......pp..", "t..ggggggg.", ".t.ggggggkgn", "..gggggggggg", "..gggggggg.."], ["...g....g..."], ["....g..g...."]),
  },
  cat: {
    colors: { c: "#3A3A44", k: "#F1C24B", w: "#E8E4DC" },
    frames: legs(
      ["t........c.c", ".t.......ccc", ".tcccccccckc", "..ccccccccww", "..cccccccc.."],
      ["..c..c..c..c"],
      ["...cc....cc."],
    ),
  },
  robot: {
    colors: { g: "#C8CCD4", d: "#5A606C", k: "#202228", r: "#E8504A", a: "#5FE08A", l: "#8E949E" },
    frames: [
      ["....rr....", ".gggllggg.", "gggggggggg", "dddddddddd", ".k......k."],
      ["....aa....", ".gggllggg.", "gggggggggg", "dddddddddd", ".k......k."],
    ],
  },
  fox: {
    colors: { o: "#E07A2E", w: "#F6EEE2", k: "#2A1E18" },
    frames: legs(
      ["...........o.o.", "ww........oooo.", ".wooooooooooko.", "..ooooooooooowk", "...ooooooooo..."],
      ["...k.k...k.k..."],
      ["....kk....kk..."],
    ),
  },
  rabbit: {
    colors: { b: "#A88466", w: "#F4EEE6", k: "#1A1A1A", p: "#E8A8B0" },
    frames: [
      [".......b.b", ".......p.b", "......bbbb", "w.bbbbbbkb", "wbbbbbbbbb", "..bb...bb."],
      [".......b.b", ".......p.b", "......bbbb", "w.bbbbbbkb", "wbbbbbbbbb", ".bb.....bb"],
    ],
  },
  squirrel: {
    colors: { r: "#B8562A", t: "#D88450", w: "#EAD2B0", k: "#1A1A1A" },
    frames: legs(
      [".ttt......", "ttttt..r..", "tttt.rrrr.", "ttt.rrrrkr", ".tt.rrrrr.", "....rwwrr."],
      ["....r..r.."],
      [".....rr..."],
    ),
  },
  hedgehog: {
    colors: { d: "#6A4A30", t: "#D8B890", k: "#1A1A1A" },
    frames: legs(["..d.d.d..", ".ddddddd.", "dddddddtt", "ddddddtkt", ".dddddtttk"], ["..t...t.."], ["...t.t..."]),
  },
  chicken: {
    colors: { w: "#F6F2EA", r: "#D8362E", y: "#F0B030", k: "#1A1A1A" },
    frames: legs(["......r..", ".....wwr.", "w....wkwy", "ww..www..", "wwwwwww..", ".wwwwww.."], ["...y.y..."], ["....yy..."]),
  },
  chick: {
    colors: { y: "#F8D848", o: "#E88A20", k: "#1A1A1A" },
    frames: legs(["..yy.", "..yko", "yyyy.", ".yyy."], [".o.o."], ["..oo."]),
  },
  duckling: {
    colors: { y: "#E8C860", o: "#E07A20", k: "#1A1A1A" },
    frames: legs(["..yy.", "..yko", "yyyy.", ".yyy."], [".o.o."], ["..oo."]),
  },
  sheep: {
    colors: { w: "#F2EEE4", s: "#D8D2C4", k: "#2E2A28", e: "#F2EEE4" },
    frames: legs(
      ["..wswsww....", ".wwwwwwwwkk.", "wswwwswwwkek", "wwwwwwwwwkk.", ".wswwwsww..."],
      [".k.k..k.k..."],
      ["..kk...kk..."],
    ),
  },
  frog: {
    colors: { g: "#4E9A3E", l: "#B8DC7A", k: "#1A1A1A", w: "#F4F4E8" },
    frames: [
      [".....kw..", "..ggggggg", ".gggggggg", "gglllllg.", "gg....gg."],
      [".....kw..", "..ggggggg", ".gggggggg", "gglllllg.", "g......gg"],
    ],
  },
  duck: {
    colors: { h: "#2E7A48", y: "#F0B030", b: "#8A7058", w: "#F6F2EA", k: "#1A1A1A", g: "#B0A090" },
    frames: legs(["......hh..", "......hkyy", "b.....w...", "bbgggbb...", ".bbbbbb..."], ["...y.y...."], ["....yy...."]),
  },
  turtle: {
    colors: { s: "#8A6A34", d: "#5A4220", l: "#9CB860", k: "#1A1A1A" },
    frames: legs(["..sdsds....", ".sdsdsds.ll", "ssssssssllk"], ["..l...l...."], ["...l...l..."]),
  },
  bat: {
    colors: { b: "#3A2A48", r: "#E8404A" },
    frames: [
      ["b.........b", "bb..b.b..bb", ".bbbbbbbbb.", "...brbrb...", "....bbb...."],
      ["....b.b....", "...bbbbb...", ".bbbrbrbbb.", "bb..bbb..bb", "b.........b"],
    ],
  },
  beetle: {
    colors: { t: "#3AB8A8", l: "#9AF0E0", k: "#1A2A2A" },
    frames: legs([".tttt..", "tlttttk", "tttttkk"], [".k.k.k."], ["k.k.k.."]),
  },
  alien: {
    colors: { g: "#7ED86A", d: "#4E9A42", k: "#141414", a: "#F4F06A", o: "#E8E8E8" },
    frames: [
      ["...a...", "...d...", ".ggggg.", "gkkgkkg", "gokgokg", "ggggggg", ".ggdgg.", ".g...g."],
      ["...g...", "...d...", ".ggggg.", "gkkgkkg", "gokgokg", "ggggggg", ".ggdgg.", "..g.g.."],
    ],
  },
  rover: {
    colors: { l: "#C8CCD4", g: "#E0B040", s: "#A8ACB4", k: "#202228", w: "#6A6E78" },
    frames: [
      ["..........l..", ".........lll.", "..........l..", ".gggggggggg..", ".ssssssssss..", "kwk..kwk..kwk", ".k....k....k."],
      ["..........l..", ".........lll.", "..........l..", ".gggggggggg..", ".ssssssssss..", "wkw..wkw..wkw", ".w....w....w."],
    ],
  },
};

// Draws one critter with its feet at (pose.x, pose.y), centered on x. A small shadow stays on the ground under
// hoppers, at groundY.
export function drawCritter(rect: Rect, pose: CritterPose, groundY: number, shadow: string | undefined): void {
  const sprite = SPRITES[pose.kind];
  const rows = sprite.frames[pose.frame % 2];
  const spriteWidth = Math.max(...rows.map((row) => row.length));
  const left = Math.round(pose.x - spriteWidth / 2);
  const top = Math.round(pose.y) - rows.length;
  if (shadow !== undefined) {
    rect(left + 1, Math.round(groundY), spriteWidth - 2, 1, shadow);
  }
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = sprite.colors[row[x]];
      if (color === undefined) {
        continue;
      }
      const column = pose.facing === 1 ? x : spriteWidth - 1 - x;
      rect(left + column, top + y, 1, 1, color);
    }
  });
}
