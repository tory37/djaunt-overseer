// The Office's shows, drawn: the performers' gear (guitars, the top hat, the chef's hat, the food trolley), the set
// pieces on stage (mic stands, the drum kit, the DJ's decks, the magician's table), the food in the crowd's hands and
// on busy guys' desks, and the effects: music notes, confetti, steam, sparkles, the comedian's spotlight, and the
// dance party's disco ball. All in room pixels; a guy's box is the top-left of his 12-wide frame at the top of his head.

import type { Facing } from "../pixelGuy";
import { FoodKind, PERFORMANCES, ShowRole } from "../officePerformances";
import type { ShowState } from "../officeSim";
import type { Kit } from "./scenery";

const TILE = 16;
const FRAME = 12;

export interface GuyBox {
  left: number;
  top: number;
}

type Paint = (x: number, y: number, w: number, h: number, color: string) => void;

// Draws in the guy's own frame, mirrored for left so each piece is drawn once, facing right.
function painter(kit: Kit, box: GuyBox, mirror: boolean): Paint {
  return (x, y, w, h, color) => kit.rect(mirror ? box.left + FRAME - x - w : box.left + x, box.top + y, w, h, color);
}

// ----- Food -----

const FOOD_ART: Record<FoodKind, { rows: string[]; colors: Record<string, string> }> = {
  pizza: { rows: ["cccc", "ysry", ".yy.", ".s.."], colors: { c: "#C8873A", y: "#F5C542", s: "#F5C542", r: "#C0392B" } },
  taco: { rows: ["grgr", "ssss", ".ss."], colors: { g: "#5DBB46", r: "#D64545", s: "#E8B04A" } },
  burger: { rows: [".bb.", "bbbb", "gggg", "pppp", ".bb."], colors: { b: "#D9963F", g: "#5DBB46", p: "#6B3A1E" } },
  sushi: { rows: ["ssss", "rnrr", "rnrr"], colors: { s: "#E8743B", r: "#F8F8F0", n: "#1E2A1E" } },
  donut: { rows: [".pp.", "pdkp", "p..p", ".pp."], colors: { p: "#F48FB1", d: "#4FA3F7", k: "#F5C542" } },
  cookie: { rows: [".cc.", "cdcc", "ccdc", ".cc."], colors: { c: "#C8873A", d: "#4A2A12" } },
  iceCream: { rows: [".pp.", "pppp", "cccc", ".cc.", ".c.."], colors: { p: "#F7A8C4", c: "#D9A441" } },
  popcorn: { rows: ["wwww", "rwrw", "rwrw", "rwrw"], colors: { w: "#FFF6D0", r: "#D64545" } },
};

export function drawFood(kit: Kit, food: FoodKind, x: number, y: number): void {
  const art = FOOD_ART[food];
  art.rows.forEach((row, dy) => [...row].forEach((cell, dx) => {
    if (cell !== ".") {
      kit.rect(x + dx, y + dy, 1, 1, art.colors[cell]);
    }
  }));
}

// What a guy in the crowd is eating, in the hand at his mouth (step 0) or lowered between bites (step 1).
export function drawSnack(kit: Kit, food: FoodKind, box: GuyBox, facing: Facing, step: number): void {
  if (facing === "up") {
    return;
  }
  if (facing === "down") {
    drawFood(kit, food, box.left + (step === 0 ? 7 : 8), box.top + (step === 0 ? 5 : 8));
    return;
  }
  const x = step === 0 ? 7 : 7;
  const y = step === 0 ? 4 : 6;
  drawFood(kit, food, facing === "right" ? box.left + x : box.left + FRAME - x - 4, box.top + y);
}

// A plate left on a busy guy's desk, at its left corner.
export function drawDeskPlate(kit: Kit, food: FoodKind, deskX: number, deskY: number): void {
  const left = deskX * TILE;
  const top = deskY * TILE;
  kit.rect(left, top + 10, 5, 1, "#F4F4F4");
  kit.rect(left + 1, top + 11, 3, 1, "#C8C8C8");
  drawFood(kit, food, left, top + 10 - FOOD_ART[food].rows.length);
}

// ----- Performers' gear -----

// Behind is drawn before his sprite, front after.
export function drawGear(kit: Kit, role: ShowRole, box: GuyBox, facing: Facing, layer: "behind" | "front", show: ShowState | undefined, now: number, performing: boolean): void {
  switch (role) {
    case "guitar":
    case "bass":
      if (layer === "front") {
        drawGuitar(kit, box, facing, role === "bass" ? "bass" : show?.kind === "band" ? "electric" : "acoustic", now, performing);
      }
      return;
    case "magician":
      if (layer === "front") {
        drawTopHat(kit, box, facing);
        if (facing !== "up") {
          drawWand(kit, box, facing, now);
        }
      }
      return;
    case "cart":
      if (layer === "front") {
        drawChefHat(kit, box);
      }
      if ((layer === "behind") === (facing === "up")) {
        drawTrolley(kit, box, facing, show, now);
      }
      return;
    default:
      return;
  }
}

const GUITARS = {
  acoustic: { body: "#C97B3A", edge: "#7A4318", hole: "#3A220E", neck: "#5A3A1E", head: "#2B1B0E", long: false },
  electric: { body: "#2E86AB", edge: "#1B4F66", hole: "#F4F4F4", neck: "#C8A06A", head: "#2B1B0E", long: false },
  bass: { body: "#B0303A", edge: "#6A1A22", hole: "#1D1D1D", neck: "#3A2414", head: "#1D1D1D", long: true },
};

function drawGuitar(kit: Kit, box: GuyBox, facing: Facing, kind: keyof typeof GUITARS, now: number, performing: boolean): void {
  const colors = GUITARS[kind];
  if (facing === "up") {
    // Slung on his back, neck up past his head.
    kit.rect(box.left + 3, box.top + 9, 6, 4, colors.edge);
    kit.rect(box.left + 4, box.top + 9, 4, 3, colors.body);
    kit.rect(box.left + 6, box.top - (colors.long ? 3 : 1), 1, 10, colors.neck);
    return;
  }
  const paint = painter(kit, box, facing === "left");
  if (facing === "down") {
    // Across his body, neck up to his left (our right).
    paint(1, 9, 6, 4, colors.edge);
    paint(2, 9, 4, 4, colors.body);
    paint(2, 8, 3, 1, colors.edge);
    paint(3, 10, 2, 2, colors.hole);
    const neck = colors.long ? [[6, 9], [7, 8], [8, 8], [9, 7], [10, 6], [11, 5]] : [[6, 9], [7, 8], [8, 8], [9, 7], [10, 6]];
    neck.forEach(([x, y]) => paint(x, y, 1, 1, colors.neck));
    const [headX, headY] = neck[neck.length - 1];
    paint(headX + 1, headY - 1, 1, 2, colors.head);
    if (performing && Math.floor(now * 8) % 2 === 0) {
      // A string shivering.
      paint(5, 11, 2, 1, "#F4F4F4");
    }
    return;
  }
  // Facing right: held in front, neck forward.
  paint(4, 9, 4, 4, colors.edge);
  paint(5, 9, 3, 3, colors.body);
  paint(8, 9, colors.long ? 5 : 4, 1, colors.neck);
  paint(colors.long ? 13 : 12, 8, 1, 2, colors.head);
}

function drawTopHat(kit: Kit, box: GuyBox, facing: Facing): void {
  const side = facing === "left" || facing === "right";
  kit.rect(box.left + (side ? 2 : 2), box.top + 1, 8, 1, "#141620");
  kit.rect(box.left + 3, box.top - 4, 6, 5, "#141620");
  kit.rect(box.left + 3, box.top, 6, 1, "#C0392B");
  kit.rect(box.left + 4, box.top - 4, 1, 4, "#2E3242");
}

function drawWand(kit: Kit, box: GuyBox, facing: Facing, now: number): void {
  const paint = painter(kit, box, facing === "left");
  const tipX = facing === "down" ? 12 : 11;
  paint(10, 11, 1, 1, "#141620");
  paint(11, 10, 1, 1, "#141620");
  paint(tipX, 9, 1, 1, "#F4F4F4");
  if (Math.floor(now * 3) % 3 === 0) {
    paint(tipX + 1, 8, 1, 1, "#FFE48A");
  }
}

function drawChefHat(kit: Kit, box: GuyBox): void {
  kit.rect(box.left + 3, box.top - 2, 6, 4, "#FAFAFA");
  kit.rect(box.left + 2, box.top - 4, 8, 3, "#FFFFFF");
  kit.rect(box.left + 3, box.top - 5, 2, 1, "#FFFFFF");
  kit.rect(box.left + 7, box.top - 5, 2, 1, "#FFFFFF");
  kit.rect(box.left + 3, box.top + 1, 6, 1, "#DADADA");
}

// The food trolley, pushed ahead of him: in front of him facing down, beside him facing a side, behind facing up.
function drawTrolley(kit: Kit, box: GuyBox, facing: Facing, show: ShowState | undefined, now: number): void {
  const lunch = show?.kind !== "snacks";
  const x = facing === "right" ? box.left + 9 : facing === "left" ? box.left - 15 : box.left - 3;
  const y = facing === "up" ? box.top + 6 : facing === "down" ? box.top + 11 : box.top + 9;
  const cloth = lunch ? ["#D64545", "#F4F4F4"] : ["#4FA3F7", "#E9F4FF"];
  // Legs, lower shelf, wheels.
  kit.rect(x + 1, y + 2, 1, 6, "#8A8F99");
  kit.rect(x + 16, y + 2, 1, 6, "#8A8F99");
  kit.rect(x, y + 6, 18, 1, "#A8ADB6");
  kit.rect(x + 1, y + 8, 2, 1, "#2A2A2A");
  kit.rect(x + 15, y + 8, 2, 1, "#2A2A2A");
  // A checked cloth hanging off the tray.
  for (let cx = 0; cx < 18; cx++) {
    for (let cy = 0; cy < 3; cy++) {
      kit.rect(x + cx, y + 2 + cy, 1, 1, cloth[(cx + cy) % 2]);
    }
  }
  kit.rect(x, y, 18, 2, "#C8CCD4");
  kit.rect(x, y, 18, 1, "#E8ECF0");
  const food = show?.food ?? [];
  if (food.length > 0) {
    [2, 7, 12].forEach((dx, index) => {
      const item = food[index % food.length];
      drawFood(kit, item, x + dx, y - FOOD_ART[item].rows.length);
    });
  }
  if (facing === "down" && Math.floor(now * 2) % 2 === 0) {
    // A glint off the tray.
    kit.rect(x + 3 + (Math.floor(now) % 12), y, 2, 1, "#FFFFFF");
  }
}

// ----- Set pieces -----

// What stands on stage in front of a performer for the whole show: a mic stand, the drum kit, the decks, the
// magician's table. Drawn just after the performer at that spot.
export function drawSetPiece(kit: Kit, role: ShowRole, spot: { x: number; y: number }, show: ShowState, now: number): void {
  const box = { left: spot.x * TILE + (TILE - FRAME) / 2, top: spot.y * TILE + TILE - 18 };
  switch (role) {
    case "singer":
    case "comic":
      drawMicStand(kit, box);
      return;
    case "drums":
      drawDrumKit(kit, box, now, show.phase === "playing");
      return;
    case "dj":
      drawDecks(kit, box, now, show.phase !== "arriving");
      return;
    case "magician":
      drawMagicTable(kit, box, show, now);
      return;
    default:
      return;
  }
}

function drawMicStand(kit: Kit, box: GuyBox): void {
  kit.rect(box.left + 10, box.top + 8, 1, 9, "#3A3A3A");
  kit.rect(box.left + 9, box.top + 17, 3, 1, "#2A2A2A");
  kit.rect(box.left + 9, box.top + 7, 2, 1, "#3A3A3A");
  kit.rect(box.left + 8, box.top + 6, 2, 2, "#9A9AA4");
  kit.rect(box.left + 8, box.top + 6, 1, 1, "#D8D8E0");
}

function drawDrumKit(kit: Kit, box: GuyBox, now: number, playing: boolean): void {
  const beat = playing ? Math.floor(now * 4) % 2 : 0;
  // Cymbals on stands to each side, shaking on the beat.
  kit.rect(box.left - 2, box.top + 8, 1, 10, "#6A6A72");
  kit.rect(box.left - 4, box.top + 7 - beat, 5, 1, "#E8B931");
  kit.rect(box.left + 13, box.top + 7, 1, 11, "#6A6A72");
  kit.rect(box.left + 11, box.top + 6 + beat, 5, 1, "#E8B931");
  // Toms.
  kit.rect(box.left, box.top + 9, 4, 2, "#B0303A");
  kit.rect(box.left, box.top + 9, 4, 1, "#E9E9E9");
  kit.rect(box.left + 8, box.top + 9, 4, 2, "#B0303A");
  kit.rect(box.left + 8, box.top + 9, 4, 1, "#E9E9E9");
  // Bass drum, face out.
  kit.rect(box.left + 2, box.top + 11, 8, 7, "#8A1F2A");
  kit.rect(box.left + 3, box.top + 12, 6, 5, "#F2F2F2");
  kit.rect(box.left + 4, box.top + 13, 4, 3, playing && beat === 1 ? "#FFFFFF" : "#E2E2E2");
  kit.rect(box.left + 5, box.top + 14, 2, 1, "#B0303A");
  if (playing) {
    // Sticks, up and down in turn.
    kit.rect(box.left + (beat === 0 ? 1 : 2), box.top + 7, 1, 2, "#E8D2A6");
    kit.rect(box.left + (beat === 0 ? 10 : 9), box.top + 8, 1, 2, "#E8D2A6");
  }
}

function drawDecks(kit: Kit, box: GuyBox, now: number, on: boolean): void {
  const left = box.left - 4;
  const top = box.top + 9;
  kit.rect(left, top + 2, 20, 6, "#24242E");
  kit.rect(left, top, 20, 2, "#3C3C4A");
  kit.rect(left + 1, top + 8, 1, 1, "#1A1A20");
  kit.rect(left + 18, top + 8, 1, 1, "#1A1A20");
  // Two turntables with a spinning mark, a mixer in the middle.
  for (const deck of [left + 1, left + 13]) {
    kit.rect(deck, top, 6, 2, "#111116");
    const spin = on ? Math.floor(now * 10) % 4 : 0;
    kit.rect(deck + 1 + spin, top + (spin % 2), 1, 1, "#C8C8D0");
  }
  kit.rect(left + 8, top, 4, 2, "#55556A");
  // A laptop, glowing.
  kit.rect(left + 8, top - 3, 4, 3, "#C8C8D0");
  kit.rect(left + 9, top - 2, 2, 1, on ? "#7CFFB2" : "#6A6A72");
  // LEDs across the front, chasing.
  const colors = ["#F06595", "#4FA3F7", "#5DBB46", "#F5C542", "#B56CE0"];
  for (let led = 0; led < 8; led++) {
    const lit = on && (led + Math.floor(now * 8)) % 4 === 0;
    kit.rect(left + 2 + led * 2, top + 4, 1, 1, lit ? colors[led % colors.length] : "#3A3A48");
  }
}

function drawMagicTable(kit: Kit, box: GuyBox, show: ShowState, now: number): void {
  const left = box.left - 1;
  const top = box.top + 11;
  kit.rect(left, top, 14, 1, "#9A3AAA");
  kit.rect(left + 1, top + 1, 12, 5, "#5E1F6A");
  kit.rect(left + 1, top + 5, 12, 1, "#E8B931");
  kit.rect(left + 2, top + 6, 1, 1, "#E8B931");
  kit.rect(left + 11, top + 6, 1, 1, "#E8B931");
  // A rabbit pops out of the hat for a few seconds after a trick.
  const cue = show.lastCue;
  const age = cue === undefined ? Infinity : now - cue.at;
  if ((cue?.cue === "gasp" || cue?.cue === "applause") && age < 3.5) {
    const rise = Math.min(3, Math.floor(age * 10));
    const rabbitTop = top - 3 - rise;
    kit.rect(left + 9, rabbitTop - 3, 1, 3, "#F4F4F4");
    kit.rect(left + 11, rabbitTop - 3, 1, 3, "#F4F4F4");
    kit.rect(left + 9, rabbitTop - 2, 1, 1, "#F7A8C4");
    kit.rect(left + 11, rabbitTop - 2, 1, 1, "#F7A8C4");
    kit.rect(left + 8, rabbitTop, 5, 3, "#F4F4F4");
    kit.rect(left + 9, rabbitTop + 1, 1, 1, "#1A1A2E");
    kit.rect(left + 11, rabbitTop + 1, 1, 1, "#1A1A2E");
    kit.rect(left + 10, rabbitTop + 2, 1, 1, "#F48FB1");
  }
  // The hat, upside down on the table.
  kit.rect(left + 7, top - 1, 7, 1, "#141620");
  kit.rect(left + 8, top - 4, 5, 3, "#141620");
  kit.rect(left + 8, top - 2, 5, 1, "#C0392B");
}

// ----- Effects -----

interface Particle {
  kind: "note" | "confetti" | "steam" | "star" | "puff";
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  color: string;
  variant: number;
}

const NOTE_COLORS = ["#F5C542", "#F06595", "#4FA3F7", "#7CFFB2", "#B56CE0", "#FF8A3D"];
const CONFETTI = ["#F5C542", "#F06595", "#4FA3F7", "#5DBB46", "#B56CE0", "#FFFFFF", "#FF8A3D"];
const NOTES = [
  [".##", ".#.", ".#.", "##.", "##."],
  ["####", "#..#", "#..#", "##.##"],
];

export interface PerformerSpot {
  role: ShowRole;
  box: GuyBox;
  performing: boolean;
}

// Particles and lights for the show on now. Step every frame with the performers' boxes; draw after the light map.
export class ShowEffects {
  private particles: Particle[] = [];
  private lastCueAt = -1;
  private nextEmitAt = 0;
  private lastTime: number | undefined;

  clear(): void {
    this.particles = [];
    this.lastCueAt = -1;
    this.lastTime = undefined;
  }

  step(show: ShowState | undefined, performers: readonly PerformerSpot[], roomWidth: number, now: number, random: () => number): void {
    const dt = this.lastTime === undefined ? 0 : Math.max(0, Math.min(0.25, now - this.lastTime));
    this.lastTime = now;
    for (const particle of this.particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      if (particle.kind === "confetti") {
        particle.vx = Math.sin((now - particle.born) * 4 + particle.variant) * 8;
      }
    }
    this.particles = this.particles.filter((particle) => now - particle.born < particle.life);
    if (show === undefined) {
      return;
    }
    const effect = PERFORMANCES[show.kind].effect;
    const playing = show.phase !== "arriving";
    const players = performers.filter((performer) => performer.performing);
    if (playing && players.length > 0 && now >= this.nextEmitAt) {
      const performer = players[Math.floor(random() * players.length)];
      const centerX = performer.box.left + FRAME / 2;
      if (effect === "notes" || effect === "disco") {
        this.nextEmitAt = now + (effect === "disco" ? 0.5 : 0.32);
        this.particles.push({
          kind: "note", x: centerX - 6 + random() * 12, y: performer.box.top - 1, vx: (random() - 0.5) * 6, vy: -9 - random() * 5,
          born: now, life: 2.6, color: NOTE_COLORS[Math.floor(random() * NOTE_COLORS.length)], variant: random() < 0.7 ? 0 : 1,
        });
      } else if (effect === "food" && performer.role === "cart") {
        this.nextEmitAt = now + 0.22;
        this.particles.push({ kind: "steam", x: performer.box.left - 2 + random() * 16, y: performer.box.top + 5, vx: (random() - 0.5) * 2, vy: -6 - random() * 3, born: now, life: 1.6, color: "#FFFFFF", variant: 0 });
      } else if (effect === "sparkles" && performer.role === "magician") {
        this.nextEmitAt = now + 0.6;
        this.particles.push({ kind: "star", x: performer.box.left + 12 + random() * 3, y: performer.box.top + 7 + random() * 3, vx: 0, vy: -3, born: now, life: 0.6, color: "#FFE48A", variant: 0 });
      } else {
        this.nextEmitAt = now + 1;
      }
    }
    const cue = show.lastCue;
    if (cue !== undefined && cue.at !== this.lastCueAt) {
      this.lastCueAt = cue.at;
      const lead = performers[0];
      if ((effect === "notes" || effect === "disco") && cue.cue === "cheer") {
        for (let piece = 0; piece < 36; piece++) {
          this.particles.push({
            kind: "confetti", x: random() * roomWidth, y: -4 - random() * 20, vx: 0, vy: 16 + random() * 14,
            born: now, life: 3 + random(), color: CONFETTI[Math.floor(random() * CONFETTI.length)], variant: random() * 6,
          });
        }
      }
      if (effect === "sparkles" && lead !== undefined && (cue.cue === "gasp" || cue.cue === "applause")) {
        const centerX = lead.box.left + FRAME / 2 + 4;
        const centerY = lead.box.top + 8;
        for (let star = 0; star < 12; star++) {
          const angle = (star / 12) * Math.PI * 2;
          const speed = 14 + random() * 10;
          this.particles.push({ kind: "star", x: centerX, y: centerY, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, born: now, life: 1.1, color: star % 2 === 0 ? "#FFE48A" : "#FFFFFF", variant: 0 });
        }
        for (let puff = 0; puff < 6; puff++) {
          this.particles.push({ kind: "puff", x: centerX + 6 + (random() - 0.5) * 8, y: centerY + 4 + (random() - 0.5) * 4, vx: (random() - 0.5) * 6, vy: -4, born: now, life: 1.2, color: "#D8D8E4", variant: 0 });
        }
      }
    }
  }

  draw(kit: Kit, now: number): void {
    const context = kit.context;
    for (const particle of this.particles) {
      const age = (now - particle.born) / particle.life;
      const x = Math.round(particle.x);
      const y = Math.round(particle.y);
      switch (particle.kind) {
        case "note": {
          context.globalAlpha = age > 0.7 ? (1 - age) / 0.3 : 1;
          const sway = Math.round(Math.sin((now - particle.born) * 4 + particle.x) * 1.5);
          NOTES[particle.variant].forEach((row, dy) => [...row].forEach((cell, dx) => {
            if (cell === "#") {
              kit.rect(x + dx + sway, y + dy, 1, 1, particle.color);
            }
          }));
          break;
        }
        case "confetti":
          context.globalAlpha = age > 0.8 ? (1 - age) / 0.2 : 1;
          kit.rect(x, y, 1, Math.floor(now * 6 + particle.variant) % 2 === 0 ? 2 : 1, particle.color);
          break;
        case "steam":
          context.globalAlpha = 0.5 * (1 - age);
          kit.rect(x, y, age < 0.5 ? 1 : 2, 1, particle.color);
          break;
        case "star":
          context.globalAlpha = 1 - age;
          kit.rect(x, y, 1, 1, particle.color);
          if (age < 0.5) {
            kit.rect(x - 1, y, 3, 1, particle.color);
            kit.rect(x, y - 1, 1, 3, particle.color);
          }
          break;
        case "puff": {
          context.globalAlpha = 0.6 * (1 - age);
          const size = 2 + Math.floor(age * 4);
          kit.rect(x - Math.floor(size / 2), y - Math.floor(size / 2), size, size, particle.color);
          break;
        }
      }
    }
    context.globalAlpha = 1;
  }
}

// How far into the show its lights are: 0 before it starts, easing up to 1 over a second and a half, and back down as
// the performers pack up.
export function showLightLevel(show: ShowState | undefined, now: number): number {
  if (show === undefined || show.phase === "arriving") {
    return 0;
  }
  return Math.max(0, Math.min(1, (now - show.startedAt) / 1.5));
}

// The comedian's spotlight: the room dims, and a beam falls from the ceiling onto him.
export function drawSpotlight(kit: Kit, show: ShowState, roomWidth: number, roomHeight: number, level: number): void {
  if (level <= 0) {
    return;
  }
  const context = kit.context;
  const centerX = show.stage.x * TILE + TILE / 2;
  const feetY = show.stage.y * TILE + TILE - 1;
  const poolX = 11;
  const poolY = 3;
  const halfWidth = (y: number): number => {
    if (y <= feetY) {
      return Math.round(3 + (poolX - 3) * (y / feetY));
    }
    const dy = (y - feetY) / poolY;
    return dy >= 1 ? -1 : Math.round(poolX * Math.sqrt(1 - dy * dy));
  };
  context.globalAlpha = 0.5 * level;
  for (let y = 0; y < roomHeight; y++) {
    const half = halfWidth(y);
    if (half < 0) {
      kit.rect(0, y, roomWidth, 1, "#05040C");
      continue;
    }
    kit.rect(0, y, Math.max(0, centerX - half), 1, "#05040C");
    kit.rect(centerX + half, y, Math.max(0, roomWidth - centerX - half), 1, "#05040C");
  }
  context.globalCompositeOperation = "lighter";
  context.globalAlpha = 0.12 * level;
  for (let y = 0; y < roomHeight; y++) {
    const half = halfWidth(y);
    if (half >= 0) {
      kit.rect(centerX - half, y, half * 2, 1, "#FFE9B8");
    }
  }
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;
}

// The dance party: the room goes dim and purple, a mirror ball turns over the stage, and spots of colored light sweep
// the floor.
export function drawDisco(kit: Kit, show: ShowState, roomWidth: number, roomHeight: number, now: number, level: number): void {
  if (level <= 0) {
    return;
  }
  const context = kit.context;
  const centerX = show.stage.x * TILE + TILE / 2;
  context.globalAlpha = 0.3 * level;
  kit.rect(0, 0, roomWidth, roomHeight, "#14062A");
  context.globalAlpha = level;
  // The ball, on a string from the ceiling.
  const ballY = 8;
  kit.rect(centerX, 0, 1, ballY - 3, "#8A8A96");
  const widths = [3, 5, 7, 7, 7, 5, 3];
  const facets = ["#E8E8F0", "#9AA0B0", "#FFFFFF", "#C0C4D0"];
  widths.forEach((width, row) => {
    for (let column = 0; column < width; column++) {
      const x = centerX - Math.floor(width / 2) + column;
      kit.rect(x, ballY - 3 + row, 1, 1, facets[(column + row + Math.floor(now * 6)) % facets.length]);
    }
  });
  context.globalCompositeOperation = "lighter";
  const colors = ["#F06595", "#4FA3F7", "#7CFFB2", "#F5C542", "#B56CE0", "#FF8A3D"];
  for (let spot = 0; spot < 16; spot++) {
    const angle = (spot / 16) * Math.PI * 2 + now * (spot % 2 === 0 ? 0.6 : -0.45);
    const reach = 0.35 + ((spot * 37) % 10) / 16;
    const x = Math.round(centerX + Math.cos(angle) * roomWidth * 0.45 * reach);
    const y = Math.round(roomHeight * 0.55 + Math.sin(angle) * roomHeight * 0.38 * reach);
    context.globalAlpha = 0.5 * level;
    kit.rect(x, y, 3, 2, colors[(spot + Math.floor(now * 2)) % colors.length]);
  }
  // A wash of color on the beat.
  context.globalAlpha = (Math.floor(now * 2) % 2 === 0 ? 0.06 : 0.02) * level;
  kit.rect(0, 0, roomWidth, roomHeight, colors[Math.floor(now / 2) % colors.length]);
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;
}
