// The lucky cat clock on the Office's back wall: a white maneki-neko sitting on the ledge with a gold bell, the
// time on its belly, and its raised paw waving. It waves faster during a scene event.

type Rect = (x: number, y: number, w: number, h: number, color: string) => void;

export const LUCKY_CAT_WIDTH = 15;

const COLORS: Record<string, string> = {
  o: "#2B2B33",
  w: "#FAF7F0",
  s: "#E2D9C6",
  p: "#F4A6B8",
  n: "#E86A8A",
  k: "#1A1A1A",
  r: "#D63B2F",
  g: "#F1C24B",
  f: "#FFFDF5",
};

// Body, 15 wide: the head on columns 5-14, the waving arm drawn over columns 0-5.
const BODY = [
  "......o......o.",
  ".....opo....opo",
  ".....owwoooowwo",
  ".....owwwwwwwwo",
  ".....owkwwwwkwo",
  ".....opwwnnwwpo",
  "......owwwwwwo.",
  "......orrggrro.",
  ".....owwggggwwo",
  ".....owgffffgwo",
  ".....owgffffgwo",
  ".....owgffffgwo",
  ".....oswggggwso",
  ".....oooooooooo",
];

// Paw up, palm out.
const PAW_UP = [
  "..ooo.",
  ".owwwo",
  ".owww.",
  ".opww.",
  "..oww.",
  "..oww.",
  "..oww.",
  "..owww",
  "...oww",
];

// Paw tipped out: the other half of the wave.
const PAW_OUT = [
  "oo....",
  "owwo..",
  "owwwo.",
  ".opwwo",
  "..oww.",
  "..oww.",
  "..oww.",
  "..owww",
  "...oww",
];

function paint(rect: Rect, rows: readonly string[], left: number, top: number): void {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = COLORS[row[x]];
      if (color !== undefined) {
        rect(left + x, top + y, 1, 1, color);
      }
    }
  });
}

export function drawLuckyCat(rect: Rect, left: number, top: number, seconds: number, now: Date, excited: boolean): void {
  paint(rect, BODY, left, top);
  const beat = excited ? 0.14 : 0.45;
  paint(rect, Math.floor(seconds / beat) % 2 === 0 ? PAW_UP : PAW_OUT, left, top);
  // The clock face is columns 8-11, rows 9-11 inside a gold rim; the hands turn around its middle.
  const centerX = left + 9.5;
  const centerY = top + 10;
  const hand = (fraction: number, color: string) => {
    const angle = fraction * Math.PI * 2 - Math.PI / 2;
    rect(Math.floor(centerX + Math.cos(angle) * 1.2), Math.floor(centerY + 0.5 + Math.sin(angle) * 1.2), 1, 1, color);
  };
  rect(Math.floor(centerX), Math.floor(centerY), 1, 1, COLORS.o);
  hand((now.getHours() % 12) / 12 + now.getMinutes() / 720, COLORS.o);
  hand(now.getMinutes() / 60, COLORS.r);
}
