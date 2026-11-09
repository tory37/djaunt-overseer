// The fliers' pixel sprites: two frames each (mostly wings up, wings down), drawn facing right and mirrored to face
// left. "." is clear. Where they go comes from officeFliers.

import { FLIERS, type FlierKind, type FlierPose } from "../officeFliers";

type Rect = (x: number, y: number, w: number, h: number, color: string) => void;

interface FlierSprite {
  colors: Record<string, string>;
  frames: [string[], string[]];
}

function blank(rows: number, width: number): string[] {
  return Array.from({ length: rows }, () => ".".repeat(width));
}

// A bird: its body rows, with the wings raised above in one frame and swept below in the other.
function bird(body: string[], up: string[], down: string[]): [string[], string[]] {
  const width = Math.max(...body.map((row) => row.length));
  const pad = (row: string) => row.padEnd(width, ".");
  return [
    [...up.map(pad), ...body.map(pad), ...blank(down.length, width)],
    [...blank(up.length, width), ...body.map(pad), ...down.map(pad)],
  ];
}

const SPRITES: Record<FlierKind, FlierSprite> = {
  pigeon: {
    colors: { b: "#8A90A0", d: "#5A6070", w: "#A8AEBC", l: "#7AA08A", k: "#141414", y: "#E8C8A0" },
    frames: bird(["........bb.", "dd.bbbbblky", ".dbbbbbbb.."], ["...ww......", "....www...."], ["....www....", "...ww......"]),
  },
  sparrow: {
    colors: { b: "#8A6440", d: "#5A3E24", w: "#B08860", l: "#E8D8C0", k: "#141414", y: "#3A2A1A" },
    frames: bird([".......bb.", "dd.bbbbbky", ".dblllbb.."], ["...ww.....", "....ww...."], ["....ww....", "...ww....."]),
  },
  crow: {
    colors: { b: "#1E1E26", d: "#14141A", w: "#2E2E3A", k: "#6A6A80", y: "#3A3A44" },
    frames: bird(["........bb.", "dd.bbbbbbky", ".dbbbbbbb.."], ["..www......", "...wwww...."], ["...wwww....", "..www......"]),
  },
  bluebird: {
    colors: { b: "#3A78D8", d: "#2A58A8", w: "#5A98F0", l: "#E88A4A", k: "#141414", y: "#3A2A1A" },
    frames: bird([".......bb", "d.bbbbbky", ".dbllllb."], ["...ww....", "....ww..."], ["....ww...", "...ww...."]),
  },
  robotBird: {
    colors: { b: "#B8BEC8", d: "#7A808C", w: "#D8DEE8", r: "#E8404A", y: "#F2C94C", k: "#3A404A" },
    frames: bird(["........bb.", "dd.bkbkbbry", ".dbbbbbbb.."], ["...ww......", "....wkw...."], ["....wkw....", "...ww......"]),
  },
  owl: {
    colors: { b: "#8A6A4A", d: "#5A4430", w: "#A8865E", l: "#E8D8B8", e: "#F2C94C", k: "#141414", y: "#3A2A1A" },
    frames: bird(["........b.b", "dd.....bbbb", ".dbbbbbbeky", "..bbllllby.", "...bllll..."], ["..wwww.....", "...wwwww..."], ["...wwwww...", "..wwww....."]),
  },
  hawk: {
    colors: { b: "#7A5232", d: "#4A3020", w: "#9A6A40", l: "#E8D8C0", k: "#141414", y: "#F2C94C" },
    frames: bird(["..........bb.", "ddd.bbbbbbbky", ".ddbbllllbb..", "..d.........."], [".wwww........", "..wwwwww.....", "....wwww....."], ["....wwww.....", "..wwwwww.....", ".wwww........"]),
  },
  goose: {
    colors: { b: "#9A8E7E", d: "#6A5E50", w: "#B8AC9A", k: "#1A1A1A", l: "#E8E0D0", y: "#2A2A2A" },
    frames: bird(["...........kk.", "...........kky", "dd.bbbbbbbkk..", ".dbblllllb....",], ["...www........", "....wwwww.....", ], ["....wwwww.....", "...www........"]),
  },
  swallow: {
    colors: { b: "#20305A", d: "#141E3A", w: "#2E4478", l: "#F2E6D0", r: "#C8483A", k: "#141414" },
    frames: bird(["........bb.", "d..bbbbbbrk", "dd.dllllb..", "d.........."], ["..www......", "....www...."], ["....www....", "..www......"]),
  },
  gull: {
    colors: { b: "#F2F2EE", d: "#C8CCD0", w: "#B8BEC6", t: "#2A2A2A", k: "#141414", y: "#F2C94C" },
    frames: bird(["..........bb.", "dd..bbbbbbbky", ".dbbbbbbbb..."], ["tww..........", ".twwww.......", "....www......"], ["....www......", ".twwww.......", "tww.........."]),
  },
  kingfisher: {
    colors: { b: "#2A9AD8", d: "#1A6AA8", w: "#4AC0F0", l: "#E8823A", k: "#141414", y: "#1A1A1A" },
    frames: bird(["......bb..", "dd.bbbbkyy", ".dbllllb.."], ["...ww.....", "....ww...."], ["....ww....", "...ww....."]),
  },
  mallard: {
    colors: { b: "#8A7058", d: "#5A4A3A", w: "#A89078", h: "#2E7A48", r: "#E8E4DC", k: "#141414", y: "#F0B030" },
    frames: bird(["..........hh", "..........hky", "dd.bbbbbbrr.", ".dbbbbbbb..."], ["...www......", "....www....."], ["....www.....", "...www......"]),
  },
  heron: {
    colors: { b: "#9AA6B4", d: "#6A7684", w: "#B8C2CE", l: "#E8ECF0", k: "#1A1A1A", y: "#F2C94C" },
    frames: bird(["............bb..", "kk.........bbkyy", "..kddbbbbbbbb....", "....dbbllllb....."], ["....wwww........", ".....wwwwww....."], [".....wwwwww.....", "....wwww........"]),
  },
  phoenix: {
    colors: { b: "#F2622A", d: "#C83A1E", w: "#F8C84A", l: "#FFE89A", k: "#3A140A", y: "#FFE89A", t: "#F8A23A" },
    frames: bird(["...........bb", "tt..bbbbbbbky", "ttddbbllbbb..", ".t..........."], ["..wwww.......", "...wwwwww....", ".....ww......"], [".....ww......", "...wwwwww....", "..wwww......."]),
  },
  dragon: {
    colors: { b: "#4A9A5A", d: "#2E6A3E", w: "#7A4AA8", m: "#A878D8", l: "#E8D27A", k: "#F2C94C", h: "#E8E0C8", t: "#2E6A3E" },
    frames: [
      [
        "....w...............",
        "....ww.w............",
        "....wmwmw.w.........",
        ".....wmmmwmw.....h..",
        "......wmmmmww...bbh.",
        "t......wwmmw...bbbkb",
        "tt..dbbbbbbbbbbbbb..",
        ".tddbbbbbbbbbbbb....",
        "....bllllllbb.......",
        ".....b....b.........",
        "....................",
        "....................",
      ],
      [
        "....................",
        "....................",
        "....................",
        ".................h..",
        "................bbh.",
        "t..............bbbkb",
        "tt..dbbbbbbbbbbbbb..",
        ".tddbbbbwwbbbbbb....",
        "....bllwmmwbb.......",
        ".....bwmmmmw........",
        "......wmwmww........",
        ".......w.w.w........",
      ],
    ],
  },
  paperPlane: {
    colors: { w: "#F4F4F0", s: "#C8CCD4", l: "#E4E6EA" },
    frames: [
      ["w.........", "wwww......", "lwwwwwwww.", ".sssss....", "..ss......"],
      ["w.........", "wwww......", "lwwwwwwww.", ".sssss....", "..ss......"],
    ],
  },
  moth: {
    colors: { w: "#C8B89A", d: "#A8987A", b: "#6A5A48", k: "#2A1E14" },
    frames: [
      ["ww...ww", "wdwbwdw", ".wwbww.", "..wkw.."],
      ["...k...", "..wbw..", ".wdbdw.", "ww.k.ww"],
    ],
  },
  balloon: {
    colors: { r: "#E2504B", l: "#F8A8A0", d: "#B83A36", s: "#E8E4DC" },
    frames: [
      [".rrr.", "rlrrr", "rlrrr", "rrrrd", ".rrd.", "..r..", "..s..", "...s.", "..s..", ".s..."],
      [".rrr.", "rlrrr", "rlrrr", "rrrrd", ".rrd.", "..r..", "..s..", ".s...", "..s..", "...s."],
    ],
  },
  hotAirBalloon: {
    colors: { r: "#E2504B", y: "#F2C94C", l: "#F8A8A0", s: "#8A6A4A", b: "#A8784A", d: "#7A5230", f: "#F8A23A" },
    frames: [
      ["...rrrrr...", ".rryrrryrr.", "rlryrrryrrr", "rlryrrryrrr", "rrryrrryrrr", ".rryrrryrr.", "..rryyyrr..", "...rrrrr...", "....s.s....", ".....f.....", "....s.s....", "...bbbbb...", "...dbdbd..."],
      ["...rrrrr...", ".rryrrryrr.", "rlryrrryrrr", "rlryrrryrrr", "rrryrrryrrr", ".rryrrryrr.", "..rryyyrr..", "...rrrrr...", "....s.s....", "...........", "....s.s....", "...bbbbb...", "...dbdbd..."],
    ],
  },
  fly: {
    colors: { w: "#C8E0F0", k: "#1E1E24", r: "#C83A3A" },
    frames: [
      [".w.w.", "kkkkr", ".k.k."],
      ["w...w", "kkkkr", ".k.k."],
    ],
  },
  bee: {
    colors: { w: "#E0F0FA", y: "#F2C94C", k: "#1E1A14" },
    frames: [
      ["..ww..", ".wwww.", "kykyyk", ".ykyy."],
      ["......", "..ww..", "kykyyk", ".ykyy."],
    ],
  },
  microDrone: {
    colors: { k: "#2A2C32", g: "#9AA0AA", r: "#E8404A", a: "#5FE08A" },
    frames: [
      ["kk...kk", ".ggrgg.", "..g.g.."],
      [".k...k.", ".ggagg.", "..g.g.."],
    ],
  },
  ghost: {
    colors: { w: "#E8F0FF", s: "#B8C8E8", k: "#2A2A44" },
    frames: [
      ["..www..", ".wwwww.", "wwkwkww", "wwwwwww", "wwwkwws", "wwwwwws", "w.ww.ws"],
      ["..www..", ".wwwww.", "wwkwkww", "wwwwwww", "wwwkwws", "wwwwwws", ".ww.ww."],
    ],
  },
  firefly: {
    colors: { y: "#E9F77A", w: "#FFFFE0", k: "#3A3A2A" },
    frames: [
      [".w.", "kyy"],
      ["w..", "kyy"],
    ],
  },
  dragonfly: {
    colors: { b: "#2AA8B8", g: "#1A6A78", w: "#C8F0F4", k: "#141414" },
    frames: [
      ["...ww.ww...", "bbbbbbbbbgk", "...ww.ww..."],
      ["....w..w...", "bbbbbbbbbgk", "....w..w..."],
    ],
  },
  wisp: {
    colors: { b: "#5AB8F8", w: "#E8F8FF", c: "#2A78C8" },
    frames: [
      ["..b..", ".bwb.", "bwwwb", ".bwb.", "..c.."],
      [".b...", ".bwb.", "bwwwb", ".bwb.", "...c."],
    ],
  },
  rocket: {
    colors: { w: "#E8ECF0", s: "#A8B0BC", r: "#E2504B", k: "#2A78C8", y: "#F8E07A", o: "#F8A23A" },
    frames: [
      ["....rr.......", "...wwwwwww...", "oyywwwkwwwwr.", "...sssssss...", "....rr......."],
      ["....rr.......", "...wwwwwww...", ".oywwwkwwwwr.", "...sssssss...", "....rr......."],
    ],
  },
  satellite: {
    colors: { b: "#2A4A9A", l: "#5A8AE0", g: "#C8CCD4", d: "#8A909A", a: "#E8404A" },
    frames: [
      ["......a......", "blbl.ggg.blbl", "lblbdgggdlblb", "blbl.ggg.blbl"],
      ["......d......", "blbl.ggg.blbl", "lblbdgggdlblb", "blbl.ggg.blbl"],
    ],
  },
  spaceWhale: {
    colors: { b: "#5A4AA8", d: "#3A2E7A", l: "#B8A8F0", s: "#FFF6C8", k: "#141428", t: "#3A2E7A" },
    frames: [
      ["..........bbbbbbb.....", "t.....bbbbbsbbbbbbb...", "tt..bbbbbbbbbbbbbbbbb.", ".tdbbbsbbbbbbbbbbbbkbb", "..dbbbbbbbbbbbbbbbbbbb", "...dbbllllllllllllbbd.", "......dlllllllllldd..."],
      ["..........bbbbbbb.....", "......bbbbbsbbbbbbb...", "....bbbbbbbbbbbbbbbbb.", ".tdbbbsbbbbbbbbbbbbkbb", "ttdbbbbbbbbbbbbbbbbbbb", "t..dbbllllllllllllbbd.", "......dlllllllllldd..."],
    ],
  },
  meteor: {
    colors: { y: "#F8A23A", w: "#FFF6C8" },
    frames: [
      [".yy.", "yyww", "yyww", ".yy."],
      [".yy.", "ywww", "yyww", ".yy."],
    ],
  },
  starJelly: {
    colors: { p: "#E87AD8", l: "#FFC8F4", s: "#FFF6C8" },
    frames: [
      ["..ppp..", ".ppppp.", "pplpspp", "ppppppp", ".p.p.p.", ".p.p.p.", "p..p..p"],
      ["..ppp..", ".ppppp.", "pplpspp", "ppppppp", ".p.p.p.", "..p.p.p", ".p..p.."],
    ],
  },
  pelican: {
    colors: { b: "#F0EEE8", d: "#A8A49C", w: "#E0DED6", k: "#141414", y: "#F0B030", p: "#E89A40" },
    frames: bird(["...........bb...", "dd.bbbbbbbbbkyyy", ".dbbbbbbbbb..pp."], ["..dwwww.........", "....wwwwww......"], ["....wwwwww......", "..dwwww........."]),
  },
  parrot: {
    colors: { r: "#D8302A", y: "#F0C030", b: "#2A6AD8", k: "#141414", g: "#3A3A3A", w: "#F4F4F4", t: "#2A6AD8" },
    frames: bird(["........rrr.", "tt.rrrrrwkg.", ".ttrrrrrrg..", "..t........."], ["...yyb......", "....bbb....."], ["....bbb.....", "...yyb......"]),
  },
  kite: {
    colors: { r: "#E8404A", y: "#F4C848", t: "#E8E8E8", b: "#4FC3F7" },
    frames: [
      ["......r..", ".....rry.", "....rrryy", ".....ryy.", "..b.t.y..", ".t.b.....", "t........"],
      ["......r..", ".....rry.", "....rrryy", ".....ryy.", "...bt.y..", ".bt......", "........."],
    ],
  },
  snowyOwl: {
    colors: { b: "#F4F4F4", d: "#C8CCD4", w: "#E4E6EC", l: "#FFFFFF", e: "#F2C94C", k: "#141414", y: "#3A3A44" },
    frames: bird(["........b.b", "dd.....bbbb", ".dbbbbbbeky", "..bbllllby.", "...bllll..."], ["..wdwd.....", "...wwwdw..."], ["...wwwdw...", "..wdwd....."]),
  },
  sleigh: {
    colors: { r: "#D8302A", g: "#F0C030", s: "#8A6A4A", b: "#8A5A3A", d: "#5A3A22", n: "#FF3030", t: "#C8A060" },
    frames: [
      ["...................d.d", "......ss...........dd.", ".....ssss.........bbbn", ".r...ssss...bbbbbbbb..", ".rrrrrrrrtttbbbbbbbb..", "..rrrrrrr...bbbbbbb...", ".gggggggg...b.b..b.b..", "g...........b.b..b.b.."],
      ["...................d.d", "......ss...........dd.", ".....ssss.........bbbn", ".r...ssss...bbbbbbbb..", ".rrrrrrrrtttbbbbbbbb..", "..rrrrrrr...bbbbbbb...", ".gggggggg..b...bb...b.", "g.........b.....bb...b"],
    ],
  },
  vulture: {
    colors: { b: "#3A2E2A", d: "#2A201C", w: "#4A3E38", p: "#E8B8A8", k: "#141414", y: "#D8C8A0" },
    frames: bird(["............pp..", "dd.bbbbbbbbbbpky", ".ddbbbbbbbbb...."], [".wwwwww.........", "...wwwwwww......", "......www......."], ["......www.......", "...wwwwwww......", ".wwwwww........."]),
  },
  fish: {
    colors: { o: "#F08C3A", w: "#FFFFFF", k: "#141414", t: "#E06A20" },
    frames: [
      ["t..ooo.", ".toowko", "t..ooo."],
      ["...ooo.", "ttoowko", "...ooo."],
    ],
  },
  jellyfish: {
    colors: { p: "#B8A8F8", l: "#E8E0FF", s: "#FFFFFF" },
    frames: [
      ["..ppp..", ".ppppp.", "pplpspp", "ppppppp", ".p.p.p.", ".p.p.p.", "p..p..p"],
      ["..ppp..", ".ppppp.", "pplpspp", "ppppppp", ".p.p.p.", "..p.p.p", ".p..p.."],
    ],
  },
  shark: {
    colors: { g: "#7A8898", l: "#D8DEE4", k: "#141414", d: "#5A6878" },
    frames: [
      ["...........d..........", "..........dd..........", "d........ddd..........", "dd...gggggggggggggg...", ".ddgggggggggggggggkgg.", "dd...glllllllllllllgg.", "d......d.......d......"],
      ["...........d..........", "..........dd..........", ".........ddd..........", ".d...gggggggggggggg...", "dddgggggggggggggggkgg.", ".d...glllllllllllllgg.", ".......d.......d......"],
    ],
  },
  manta: {
    colors: { b: "#2E4A7A", w: "#3E5E94", l: "#E8ECF0", t: "#1E2E50", k: "#E8ECF0" },
    frames: bird(["....bbbbbbbbbb..", "tttbbbbbbbbbbbkb", "....bllllllllb.."], ["....wwwwwww.....", ".....wwwwwwwww..", "......wwww......"], ["......wwww......", ".....wwwwwwwww..", "....wwwwwww....."]),
  },
  seaTurtle: {
    colors: { g: "#4E8A5A", s: "#8A6A34", d: "#5A4220", k: "#141414" },
    frames: bird(["....sdsdsd....", "...sdsdsdsdggg", "gg.sssssssggkg", "....gggggg...."], ["......gg......", ".....gg......."], [".....gg.......", "......gg......"]),
  },
  flyingBook: {
    colors: { c: "#7A3A9A", p: "#F4EEDC", g: "#E8C048" },
    frames: [
      ["c.........c", ".pc.....cp.", "..ppc.cpp..", "....cgc...."],
      ["...........", "...........", "cppppcppppc", ".ccccgcccc."],
    ],
  },
  helicopter: {
    colors: { b: "#D8302A", w: "#9ED8F5", k: "#2A2A2A", g: "#8A8E96" },
    frames: [
      [".kkkkkkkkkkkkk.", "........k......", "k.....bbbbbb...", "kbbbbbbbbbwwb..", "k.....bbbbbbbb.", "......g....g...", ".....gggggggg.."],
      ["....kkkkkkk....", "........k......", "......bbbbbb...", "kbbbbbbbbbwwb..", "......bbbbbbbb.", "......g....g...", ".....gggggggg.."],
    ],
  },
  blimp: {
    colors: { g: "#C8CCD4", d: "#9AA0AA", r: "#D8302A", k: "#3A3A44", a: "#F8E060" },
    frames: [
      ["......gggggggggg......", "d..ggggggggggggggggg..", "dd.gggrrrrrrrrrrrgggg.", "ddggggggggggggggggggga", "dd.ggggggggggggggggg..", "d.....ddgggggggg......", "..........kkkk........"],
      ["......gggggggggg......", "d..ggggggggggggggggg..", "dd.gggrrrrrrrrrrrgggg.", "ddggggggggggggggggggg.", "dd.ggggggggggggggggg..", "d.....ddgggggggg......", "..........kkkk........"],
    ],
  },
};

export function flierGlows(kind: FlierKind): boolean {
  return FLIERS[kind].glow === true;
}

// Draws one flier centered on (pose.x, pose.y). A meteor's sprite tips along its fall; trails are drawn by the view.
export function drawFlier(rect: Rect, context: CanvasRenderingContext2D, pose: FlierPose): void {
  const sprite = SPRITES[pose.kind];
  const rows = sprite.frames[pose.frame % 2];
  const spriteWidth = Math.max(...rows.map((row) => row.length));
  const left = Math.round(pose.x - spriteWidth / 2);
  const top = Math.round(pose.y - rows.length / 2);
  const alpha = FLIERS[pose.kind].alpha;
  if (alpha !== undefined) {
    context.globalAlpha = alpha;
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
  context.globalAlpha = 1;
}

// A big flier's shadow: a soft dark smudge on the floor under it, as wide as it is.
export function drawFlierShadow(rect: Rect, context: CanvasRenderingContext2D, pose: FlierPose, floorY: number, color: string): void {
  const width = FLIERS[pose.kind].width;
  const left = Math.round(pose.x - width / 2);
  context.globalAlpha = 0.35;
  rect(left + 2, Math.round(floorY), width - 4, 1, color);
  rect(left + 1, Math.round(floorY) + 1, width - 2, 1, color);
  rect(left + 3, Math.round(floorY) + 2, width - 6, 1, color);
  context.globalAlpha = 1;
}

// A fading trail of sparks behind a meteor, rocket, or phoenix.
// The points run from just behind it to the trail's end.
export function drawFlierTrail(rect: Rect, context: CanvasRenderingContext2D, points: { x: number; y: number }[], color: string): void {
  points.forEach((point, index) => {
    const fade = 1 - index / points.length;
    context.globalAlpha = 0.8 * fade;
    const size = fade > 0.6 ? 2 : 1;
    rect(Math.round(point.x - size / 2), Math.round(point.y - size / 2), size, size, color);
  });
  context.globalAlpha = 1;
}
