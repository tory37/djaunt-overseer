// The Office webview: draws the floor plan and the pixel guys, and runs the simulation every frame. The extension
// posts the live sessions ({ type: "office" }); a click on a guy posts { type: "open" } back. You sit at your own
// desk and act out the scene events ({ type: "sceneEvent" }) with your monitor; the room looks up too.

import { buildOfficeLayout, Desk, desksNeeded, OFFICE_SCENES, officeShape, OfficeLayout, OfficeSceneId, officeSceneId, Point, Prop, Station, STATION_DESKS } from "../officeLayout";
import { Agent, AgentInput, agentPose, callYouBack, createOffice, isAtStation, officeCounts, relayoutOffice, stepOffice, syncOffice, syncYou, youAgent } from "../officeSim";
import { YourEvent, YourReaction, yourEventSeconds, yourReaction, roomReaction, YourScreen } from "../officeYou";
import { Facing, FRAME_HEIGHT, FRAME_WIDTH, pixelGuyFrame, pixelGuyLook, PixelGuyLook, Pose } from "../pixelGuy";
import { DEFENSE_BEATS, ERROR_BEAT_SECONDS, ERROR_FLASH_SECONDS, EVENT_SECONDS, SCENE_EVENT_KINDS, SceneEventKind } from "../sceneEventSchedule";
import { drawLuckyCat } from "./luckyCat";
import { SCENE_PALETTES, ScenePalette } from "./palettes";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

interface OfficeMessage {
  type: "office";
  scene: string;
  agents: AgentInput[];
  you: PixelGuyLook | null;
}

interface SceneEventMessage {
  type: "sceneEvent";
  kind: SceneEventKind;
  variant: number;
}

const TILE = 16;
const SEATED_LIFT = 5;

const vscode = acquireVsCodeApi();
const canvas = document.getElementById("office") as HTMLCanvasElement;
const context = canvas.getContext("2d") as CanvasRenderingContext2D;
const statusLabel = document.getElementById("status") as HTMLElement;
const sceneLabel = document.getElementById("scene") as HTMLElement;
const tooltip = document.getElementById("tooltip") as HTMLElement;

let sceneId: OfficeSceneId = "office";
let latestInputs: AgentInput[] = [];
let hasSynced = false;
let state = createOffice(buildOfficeLayout(12, 8, sceneId));
let width = 0;
let height = 0;
let scale = 1;
let originX = 0;
let originY = 0;
let hoveredId: string | undefined;
// Your look, under a key of its own in the sprite cache, or undefined when you're not in the room.
let youKey: string | undefined;
let youHovered = false;
let sceneEvent: (YourEvent & { start: number }) | undefined;
let roomReactions: { id: string; text: string; at: number }[] = [];

const random = Math.random;

// Builds just enough room for the sessions (ten desks at least, more as sessions open), shaped to fit the view, then
// zooms it as far as the view allows.
function fitLayout(): void {
  const withStation = youKey !== undefined;
  const shape = officeShape(desksNeeded(latestInputs.length) + (withStation ? STATION_DESKS : 0), width, height, TILE, withStation);
  const layout = state.layout;
  if (shape.cols !== layout.cols || shape.rows !== layout.rows || sceneChanged || (layout.station !== undefined) !== withStation) {
    sceneChanged = false;
    relayoutOffice(state, buildOfficeLayout(shape.cols, shape.rows, sceneId, withStation), random);
  }
  const pixelRatio = window.devicePixelRatio || 1;
  const fit = Math.min(width / (state.layout.cols * TILE), height / (state.layout.rows * TILE));
  // Whole device pixels keep the art crisp, but not at the cost of a much smaller room.
  const snapped = Math.floor(fit * pixelRatio) / pixelRatio;
  scale = snapped >= fit * 0.85 ? snapped : fit;
  originX = Math.floor((width - state.layout.cols * TILE * scale) / 2);
  // Flush to the bottom of the view.
  originY = Math.floor(height - state.layout.rows * TILE * scale);
}
let sceneChanged = false;

new ResizeObserver(() => {
  const pixelRatio = window.devicePixelRatio || 1;
  width = canvas.clientWidth;
  height = canvas.clientHeight;
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  if (width > 0 && height > 0) {
    fitLayout();
  }
}).observe(canvas);

window.addEventListener("message", (event: MessageEvent<OfficeMessage | SceneEventMessage>) => {
  const data = event.data;
  if (data !== null && typeof data === "object" && data.type === "sceneEvent") {
    startSceneEvent(data);
    return;
  }
  if (data === null || typeof data !== "object" || data.type !== "office" || !Array.isArray(data.agents)) {
    return;
  }
  const nextYouKey = data.you === null || typeof data.you !== "object" ? undefined : `you|${JSON.stringify(data.you)}`;
  if (nextYouKey !== youKey) {
    youKey = nextYouKey;
    if (data.you !== null && nextYouKey !== undefined) {
      lookCache.set(nextYouKey, data.you);
    }
  }
  const nextScene = officeSceneId(data.scene);
  if (nextScene !== sceneId) {
    sceneId = nextScene;
    sceneChanged = true;
    if (width > 0 && height > 0) {
      fitLayout();
    }
  }
  latestInputs = data.agents.filter((agent) =>
    typeof agent?.id === "string" && (agent.status === "working" || agent.status === "idle" || agent.status === "asleep"),
  );
  // Grow or shrink the room first, so newcomers get one of the new desks.
  if (width > 0 && height > 0) {
    fitLayout();
  }
  // The first sync seats everyone where they belong; later ones walk newcomers in from the door.
  syncOffice(state, latestInputs, random, hasSynced ? "door" : "seated");
  syncYou(state, youKey, random);
  hasSynced = true;
  sceneLabel.textContent = OFFICE_SCENES.find((scene) => scene.id === sceneId)?.label.toLowerCase() ?? "office";
});

// A hidden view skips the event, like the other views, so it doesn't play late.
function startSceneEvent(data: SceneEventMessage): void {
  if (document.hidden || !SCENE_EVENT_KINDS.includes(data.kind)) {
    return;
  }
  const start = state.time;
  sceneEvent = { kind: data.kind, variant: Math.floor(Number(data.variant) || 0), age: 0, start };
  roomReactions = [];
  callYouBack(state, random);
  for (const agent of state.agents) {
    const text = agent.status === "asleep" || agent.leaving || agent.you ? undefined : roomReaction(data.kind, random);
    if (text !== undefined) {
      roomReactions.push({ id: agent.id, text, at: start + 0.2 + random() * 0.9 });
    }
  }
}

function playRoomReactions(): void {
  const due = roomReactions.filter((reaction) => reaction.at <= state.time);
  roomReactions = roomReactions.filter((reaction) => reaction.at > state.time);
  for (const reaction of due) {
    const agent = state.agents.find((candidate) => candidate.id === reaction.id);
    if (agent !== undefined) {
      agent.bubble = { text: reaction.text, until: state.time + 1.6 };
    }
  }
}

function currentEvent(): YourEvent | undefined {
  if (sceneEvent === undefined) {
    return undefined;
  }
  sceneEvent.age = state.time - sceneEvent.start;
  if (sceneEvent.age >= yourEventSeconds(sceneEvent.kind)) {
    sceneEvent = undefined;
  }
  return sceneEvent;
}

// ----- Sprites -----

const lookCache = new Map<string, PixelGuyLook>();
const spriteCache = new Map<string, HTMLCanvasElement>();

function sprite(seed: string, pose: Pose, facing: Facing, frame: number): HTMLCanvasElement {
  const key = `${seed}|${pose}|${facing}|${frame}`;
  const cached = spriteCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  let look = lookCache.get(seed);
  if (look === undefined) {
    look = pixelGuyLook(seed);
    lookCache.set(seed, look);
  }
  const image = document.createElement("canvas");
  image.width = FRAME_WIDTH;
  image.height = FRAME_HEIGHT;
  const imageContext = image.getContext("2d") as CanvasRenderingContext2D;
  pixelGuyFrame(look, pose, facing, frame).forEach((row, y) => row.forEach((color, x) => {
    if (color !== null) {
      imageContext.fillStyle = color;
      imageContext.fillRect(x, y, 1, 1);
    }
  }));
  if (spriteCache.size > 4000) {
    spriteCache.clear();
  }
  spriteCache.set(key, image);
  return image;
}

// ----- Drawing helpers, in room pixels -----

function rect(x: number, y: number, w: number, h: number, color: string): void {
  context.fillStyle = color;
  context.fillRect(x, y, w, h);
}

const noise = (value: number) => {
  const wave = Math.sin(value * 12.9898) * 43758.5453;
  return wave - Math.floor(wave);
};

function drawFloor(layout: OfficeLayout, palette: ScenePalette): void {
  for (let y = 1; y < layout.rows; y++) {
    for (let x = 0; x < layout.cols; x++) {
      const left = x * TILE;
      const top = y * TILE;
      if (palette.floorStyle === "planks" || palette.floorStyle === "tiles") {
        rect(left, top, TILE, TILE, (x + y) % 2 === 0 ? palette.floor : palette.floorAlt);
        rect(left, top + TILE - 1, TILE, 1, palette.floorLine);
        if (palette.floorStyle === "planks") {
          rect(left + ((y * 5) % TILE), top, 1, TILE - 1, palette.floorLine);
        } else {
          rect(left + TILE - 1, top, 1, TILE, palette.floorLine);
        }
      } else {
        drawGround(left, top, x * 31 + y * 17, palette);
      }
    }
  }
  // A soft shadow under the back wall.
  rect(0, TILE, layout.cols * TILE, 2, palette.shadow);
}

// Outdoor and cave ground: one color with scattered detail, so it doesn't read as tiles.
function drawGround(left: number, top: number, seed: number, palette: ScenePalette): void {
  rect(left, top, TILE, TILE, palette.floor);
  const at = (salt: number) => ({
    x: left + Math.floor(noise(seed + salt) * (TILE - 2)),
    y: top + Math.floor(noise(seed * 3 + salt) * (TILE - 2)),
  });
  // A patch of the alternate shade, so the ground has some lumps.
  const patch = at(1);
  rect(patch.x, patch.y, 5, 3, palette.floorAlt);
  switch (palette.floorStyle) {
    case "grass":
    case "meadow":
      for (let blade = 0; blade < 4; blade++) {
        const spot = at(10 + blade);
        rect(spot.x, spot.y, 1, 2, palette.floorLine);
        rect(spot.x + 1, spot.y + 1, 1, 1, palette.floorLine);
      }
      if (palette.floorStyle === "meadow" && noise(seed + 40) > 0.55) {
        const flower = at(41);
        rect(flower.x, flower.y, 1, 1, ["#FFFFFF", "#FFD43B", "#F783AC", "#B197FC"][Math.floor(noise(seed + 42) * 4)]);
      }
      return;
    case "pebbles":
      for (let pebble = 0; pebble < 3; pebble++) {
        const spot = at(20 + pebble);
        rect(spot.x, spot.y, 2, 1, ["#8E8574", "#A39A88", "#7A7264"][pebble]);
      }
      return;
    case "stone": {
      const crack = at(30);
      rect(crack.x, crack.y, 3, 1, palette.floorLine);
      rect(crack.x + 2, crack.y + 1, 2, 1, palette.floorLine);
      if (noise(seed + 31) > 0.6) {
        const rock = at(32);
        rect(rock.x, rock.y, 2, 2, palette.floorLine);
        rect(rock.x, rock.y, 1, 1, "#5E5752");
      }
      return;
    }
    case "regolith": {
      if (noise(seed + 50) > 0.6) {
        const crater = at(51);
        rect(crater.x, crater.y, 4, 1, palette.floorLine);
        rect(crater.x, crater.y + 1, 1, 1, palette.floorLine);
        rect(crater.x + 1, crater.y + 2, 3, 1, "#BDBDC4");
      }
      const dust = at(52);
      rect(dust.x, dust.y, 1, 1, "#BDBDC4");
      return;
    }
  }
}

function drawWall(layout: OfficeLayout, palette: ScenePalette, seconds: number): void {
  const width = layout.cols * TILE;
  // Keep the outdoor backdrops' trees and ridges inside the room.
  context.save();
  context.beginPath();
  context.rect(0, 0, width, TILE);
  context.clip();
  switch (palette.backdrop) {
    case "windows":
    case "panels":
      rect(0, 0, width, TILE, palette.wall);
      rect(0, TILE - 3, width, 3, palette.wallTrim);
      for (let x = 3; x < layout.cols - 1; x += 5) {
        if (palette.backdrop === "windows") {
          drawWindow(x * TILE + 1, 2, palette);
        } else {
          drawWallPanel(x * TILE + 1, 2, palette, seconds, x);
        }
      }
      break;
    case "trees":
      drawTrees(width, palette, seconds);
      break;
    case "sky":
      drawSky(width, palette, seconds);
      break;
    case "river":
      drawRiver(width, palette, seconds);
      break;
    case "rock":
      drawRockWall(width, palette, seconds);
      break;
    case "space":
      drawSpace(width, palette, seconds);
      break;
  }
  context.restore();
  // The lucky cat sits on the ledge between the door and the first window.
  drawLuckyCat(rect, TILE + 8, 1, seconds, new Date(), currentEvent() !== undefined);
  drawDoor(layout.door, palette);
}

function timeOfDay(): { night: boolean; dusk: boolean } {
  const hour = new Date().getHours() + new Date().getMinutes() / 60;
  const night = hour < 6.5 || hour >= 19.5;
  return { night, dusk: !night && (hour < 8 || hour >= 18) };
}

function skyColor(): string {
  const { night, dusk } = timeOfDay();
  return night ? "#1B2340" : dusk ? "#F2A65A" : "#8FD3F4";
}

function drawWindow(left: number, top: number, palette: ScenePalette): void {
  const isNight = timeOfDay().night;
  rect(left, top, 14, 10, palette.windowFrame);
  rect(left + 1, top + 1, 12, 8, skyColor());
  if (isNight) {
    rect(left + 3, top + 3, 1, 1, "#FFFFFF");
    rect(left + 9, top + 2, 1, 1, "#FFF6C8");
    rect(left + 7, top + 6, 1, 1, "#FFFFFF");
  } else {
    rect(left + 2, top + 6, 5, 2, "#FFFFFF");
    rect(left + 3, top + 5, 3, 1, "#FFFFFF");
  }
  rect(left + 7, top + 1, 1, 8, palette.windowFrame);
  rect(left + 1, top + 5, 12, 1, palette.windowFrame);
}

function drawWallPanel(left: number, top: number, palette: ScenePalette, seconds: number, index: number): void {
  rect(left, top, 14, 10, palette.windowFrame);
  rect(left + 1, top + 1, 12, 8, "#0B0F14");
  for (let led = 0; led < 6; led++) {
    const on = noise(index * 7 + led + Math.floor(seconds * 3 + led)) > 0.4;
    rect(left + 2 + led * 2, top + 3, 1, 1, on ? (led % 3 === 0 ? "#F1C24B" : "#3DDC6A") : "#1B2A1F");
    rect(left + 2 + led * 2, top + 6, 1, 1, noise(index * 3 + led * 5 + Math.floor(seconds * 2)) > 0.5 ? "#4FC3F7" : "#132530");
  }
}

// The forest's back row: trunks under a canopy, a hedge along the bottom, fireflies at night.
function drawTrees(width: number, palette: ScenePalette, seconds: number): void {
  const { night } = timeOfDay();
  rect(0, 0, width, TILE, night ? "#0F1E16" : palette.wall);
  for (let x = 2; x < width; x += 7) {
    const shift = Math.floor(noise(x) * 3);
    rect(x + shift, 5, 2, 9, night ? "#2A1D12" : "#4A3220");
  }
  for (let x = -4; x < width; x += 6) {
    const height = 5 + Math.floor(noise(x * 5) * 4);
    rect(x, 0, 8, height, night ? "#173322" : "#2F5A2E");
    rect(x + 2, 0, 4, height - 2, night ? "#1E3F2A" : "#3E6E36");
  }
  for (let x = 0; x < width; x += 4) {
    rect(x, 12 - Math.floor(noise(x * 7) * 2), 4, 4, night ? "#1B3A24" : palette.wallTrim);
    rect(x + 1, 12, 2, 1, night ? "#24482E" : "#3E7A38");
  }
  if (night) {
    for (let fly = 0; fly < Math.ceil(width / 24); fly++) {
      const glow = Math.sin(seconds * 2 + fly * 1.7) > 0.2;
      if (glow) {
        const x = Math.floor((noise(fly * 9) * width + Math.sin(seconds * 0.5 + fly) * 6 + width) % width);
        rect(x, 4 + Math.floor(noise(fly * 13) * 8), 1, 1, "#E9F77A");
      }
    }
  }
}

// The field's back row: open sky by the time of day, drifting clouds, hills, and a fence.
function drawSky(width: number, palette: ScenePalette, seconds: number): void {
  const { night } = timeOfDay();
  rect(0, 0, width, TILE, skyColor());
  if (night) {
    for (let star = 0; star < width / 10; star++) {
      rect(Math.floor(noise(star * 3) * width), Math.floor(noise(star * 7) * 7), 1, 1, "#FFF6C8");
    }
  } else {
    const sunX = width - 30;
    rect(sunX, 2, 4, 4, "#FFE066");
    rect(sunX - 1, 3, 6, 2, "#FFE066");
    for (let cloud = 0; cloud < Math.ceil(width / 70); cloud++) {
      const x = Math.floor(((seconds * 1.5 + cloud * 70 + noise(cloud) * 30) % (width + 20)) - 10);
      rect(x, 2 + (cloud % 2) * 2, 9, 2, "#FFFFFF");
      rect(x + 2, 1 + (cloud % 2) * 2, 4, 1, "#FFFFFF");
    }
  }
  for (let x = 0; x < width; x += 2) {
    const hill = 8 + Math.round(Math.sin(x / 19) * 1.5 + Math.sin(x / 7) * 0.8);
    rect(x, hill, 2, TILE - hill, night ? "#2E4A2A" : "#6FA84A");
  }
  rect(0, 12, width, 1, palette.wallTrim);
  rect(0, 14, width, 1, palette.wallTrim);
  for (let x = 3; x < width; x += 8) {
    rect(x, 10, 1, 6, palette.wallTrim);
  }
}

// The riverbed's back row: the far bank, the river running past, and the stones along the near bank.
function drawRiver(width: number, palette: ScenePalette, seconds: number): void {
  rect(0, 0, width, 3, "#5E8F3E");
  rect(0, 3, width, 10, palette.wall);
  rect(0, 3, width, 1, "#2F6E9C");
  for (let ripple = 0; ripple < width / 9; ripple++) {
    const x = Math.floor((noise(ripple) * width + seconds * (8 + (ripple % 3) * 4)) % width);
    rect(x, 5 + (ripple % 4) * 2, 3, 1, ripple % 2 === 0 ? "#8FD3F4" : "#5FAEDC");
  }
  for (let x = 0; x < width; x += 5) {
    const rise = Math.floor(noise(x * 3) * 2);
    rect(x, 12 - rise, 5, 4 + rise, x % 10 === 0 ? palette.wallTrim : "#A39A88");
    rect(x + 1, 12 - rise, 2, 1, "#C2B9A6");
  }
}

// The cave's back row: rough rock, stalactites, and crystals that glow.
function drawRockWall(width: number, palette: ScenePalette, seconds: number): void {
  rect(0, 0, width, TILE, palette.wall);
  for (let x = 0; x < width; x += 5) {
    rect(x, Math.floor(noise(x) * 10), 4, 3, palette.wallTrim);
  }
  for (let x = 4; x < width; x += 11) {
    const length = 3 + Math.floor(noise(x * 7) * 4);
    for (let row = 0; row < length; row++) {
      const half = Math.max(0, 2 - Math.floor((row * 3) / length));
      rect(x - half, row, half * 2 + 1, 1, "#4A4440");
    }
  }
  for (let x = 30; x < width; x += 37) {
    const pulse = 0.5 + 0.5 * Math.sin(seconds * 1.5 + x);
    const color = x % 2 === 0 ? "#B197FC" : "#63E6BE";
    glow(x + 1, 8, 5, color, 0.15 + pulse * 0.2);
    rect(x, 6, 1, 5, color);
    rect(x + 2, 8, 1, 3, color);
    rect(x - 1, 9, 1, 2, color);
  }
  rect(0, TILE - 3, width, 3, "#1E1B19");
}

// The moon's back row: stars, the Earth, and the grey ridge of the horizon.
function drawSpace(width: number, palette: ScenePalette, seconds: number): void {
  rect(0, 0, width, TILE, palette.wall);
  for (let star = 0; star < width / 6; star++) {
    const twinkle = noise(star * 5 + Math.floor(seconds * 1.5 + star)) > 0.15;
    rect(Math.floor(noise(star * 3) * width), Math.floor(noise(star * 7) * 11), 1, 1, twinkle ? "#FFFFFF" : "#555A70");
  }
  const earthX = width - 36;
  rect(earthX + 1, 1, 6, 8, "#2E86DE");
  rect(earthX, 2, 8, 6, "#2E86DE");
  rect(earthX + 2, 2, 3, 2, "#4CB944");
  rect(earthX + 4, 5, 3, 2, "#4CB944");
  rect(earthX + 1, 4, 2, 1, "#FFFFFF");
  for (let x = 0; x < width; x += 3) {
    const ridge = 11 + Math.round(Math.sin(x / 13) * 1.2 + noise(x) * 0.8);
    rect(x, ridge, 3, TILE - ridge, palette.wallTrim);
  }
  rect(0, TILE - 1, width, 1, "#6A6A72");
}

function drawDoor(door: Point, palette: ScenePalette): void {
  const open = state.agents.some((agent) => Math.abs(agent.x - door.x) + Math.abs(agent.y - door.y) < 1.2);
  const left = door.x * TILE + 2;
  switch (palette.doorStyle) {
    case "door":
      rect(left, 1, 12, TILE - 1, palette.doorFrame);
      rect(left + 1, 2, 10, TILE - 2, open ? "#121212" : palette.door);
      if (!open) {
        rect(left + 8, 9, 1, 1, "#F1C24B");
      }
      return;
    case "trail":
      // A worn path through the back row, narrowing as it heads off into the distance.
      for (let row = 0; row < TILE; row++) {
        const half = 2 + Math.floor((row * 4) / TILE);
        rect(left + 6 - half - 1, row, half * 2 + 2, 1, palette.doorFrame);
        rect(left + 6 - half, row, half * 2, 1, palette.door);
      }
      rect(left + 4, 5, 1, 1, palette.doorFrame);
      rect(left + 7, 10, 2, 1, palette.doorFrame);
      return;
    case "gate": {
      rect(left, 6, 1, TILE - 6, palette.doorFrame);
      rect(left + 11, 6, 1, TILE - 6, palette.doorFrame);
      rect(left + 1, 7, 10, TILE - 7, skyColor() === "#1B2340" ? "#2E4A2A" : "#6FA84A");
      const span = open ? 3 : 10;
      rect(left + 1, 9, span, 1, palette.door);
      rect(left + 1, 13, span, 1, palette.door);
      rect(left + span, 9, 1, 5, palette.door);
      return;
    }
    case "tunnel":
      rect(left - 1, 3, 14, TILE - 3, palette.doorFrame);
      rect(left + 1, 2, 10, 2, palette.doorFrame);
      rect(left + 1, 5, 10, TILE - 5, palette.door);
      rect(left + 2, 4, 8, 1, palette.door);
      return;
    case "hatch":
      rect(left, 2, 12, TILE - 2, palette.doorFrame);
      rect(left + 1, 3, 10, TILE - 3, open ? "#05060C" : palette.door);
      if (!open) {
        rect(left + 4, 5, 4, 3, "#1B2340");
        rect(left + 4, 5, 1, 1, "#7FD1FF");
        rect(left + 2, 10, 8, 1, palette.doorFrame);
      }
      rect(left + 10, 4, 1, 1, Math.floor(Date.now() / 600) % 2 === 0 ? "#FF6B6B" : "#5C2A2A");
      return;
  }
}

// During an event the room's working screens flash with it: red for ERROR, green for HACK, the beat's color for DEFENSE.
function eventCodeColor(event: YourEvent | undefined): string | undefined {
  if (event === undefined) {
    return undefined;
  }
  if (event.kind === "error") {
    return event.age < ERROR_FLASH_SECONDS && Math.floor(event.age / ERROR_BEAT_SECONDS) % 2 === 0 ? "#FF5A4F" : undefined;
  }
  if (event.kind === "hack") {
    return event.age < EVENT_SECONDS.hack ? "#3DDC6A" : undefined;
  }
  const beat = DEFENSE_BEATS.filter((start) => event.age >= start).length - 1;
  return event.age >= EVENT_SECONDS.defense ? undefined : ["#FF5A4F", "#F1C24B", "#F1C24B", "#4FC3F7"][beat];
}

function drawDesk(desk: Desk, owner: Agent | undefined, palette: ScenePalette, seconds: number, index: number, eventColor: string | undefined): void {
  const left = desk.desk.x * TILE;
  const top = desk.desk.y * TILE;
  // Monitor, facing the seat below.
  rect(left + 3, top, 10, 8, palette.monitor);
  const typing = owner !== undefined && owner.mode === "type" && owner.path.length === 0;
  const present = owner !== undefined && !owner.leaving && owner.status !== "asleep";
  rect(left + 4, top + 1, 8, 6, typing ? palette.screenOn : present ? palette.screenIdle : palette.screenOff);
  if (typing) {
    for (let line = 0; line < 3; line++) {
      const scroll = Math.floor(seconds * 4) + line;
      const lineWidth = 2 + Math.floor(noise(index * 31 + scroll) * 6);
      const indent = Math.floor(noise(index * 17 + scroll) * 2);
      rect(left + 5 + indent, top + 2 + line * 2, Math.min(lineWidth, 6 - indent), 1, eventColor ?? palette.code[(scroll + index) % palette.code.length]);
    }
  } else if (present) {
    const bounce = Math.floor(seconds * 2) % 6;
    rect(left + 5 + bounce, top + 3 + (bounce % 2), 1, 1, palette.code[0]);
  }
  rect(left + 7, top + 8, 2, 1, palette.monitor);
  // Desk top and front.
  rect(left, top + 9, TILE, 3, palette.deskTop);
  rect(left + 4, top + 10, 8, 1, palette.keyboard);
  rect(left, top + 12, TILE, 4, palette.deskFront);
  rect(left + 1, top + 12, 1, 4, palette.deskTop);
  rect(left + TILE - 2, top + 12, 1, 4, palette.deskTop);
  // A mug on some desks.
  if (index % 3 === 1) {
    rect(left + 13, top + 7, 2, 2, palette.mug);
  }
}

// What your second monitor shows beside the main one: a live graph while you work, the error log, more falling code,
// a radar sweep while you defend, and an all-clear.
type SideScreen = "graph" | "log" | "radar" | "ok";

function sideScreen(screen: YourScreen): YourScreen | SideScreen {
  switch (screen) {
    case "code":
    case "idle":
      return "graph";
    case "error":
    case "alert":
      return "log";
    case "matrix":
    case "granted":
      return "matrix";
    case "progress":
      return "radar";
    case "shield":
      return "ok";
  }
}

// Your station, two desks wide: two monitors, the keyboard between them, a mug, a lamp, and a light strip along the
// front in the main screen's color.
function drawStation(station: Station, reaction: YourReaction, palette: ScenePalette, seconds: number): void {
  const left = station.desk.x * TILE;
  const top = station.desk.y * TILE;
  const width = TILE * STATION_DESKS;
  // A lamp at the far left, its glow on the desk.
  rect(left + 1, top + 2, 4, 2, palette.monitor);
  rect(left + 2, top + 4, 1, 5, palette.monitor);
  context.globalAlpha = 0.25;
  rect(left + 1, top + 9, 6, 2, "#FFE7A0");
  context.globalAlpha = 1;
  // Main monitor left of center, the second right of it, both turned a little toward the chair.
  rect(left + 5, top - 2, 14, 9, palette.monitor);
  const glow = drawYourScreen(left + 6, top - 1, reaction.screen, reaction.progress, palette, seconds);
  rect(left + 20, top - 1, 11, 8, palette.monitor);
  drawYourScreen(left + 21, top, sideScreen(reaction.screen), reaction.progress, palette, seconds, 9, 6);
  rect(left + 11, top + 7, 2, 2, palette.monitor);
  rect(left + 25, top + 7, 2, 2, palette.monitor);
  rect(left, top + 9, width, 3, palette.deskTop);
  rect(left + 11, top + 10, 10, 1, palette.keyboard);
  rect(left + 23, top + 10, 2, 1, palette.keyboard);
  rect(left, top + 12, width, 4, palette.deskFront);
  rect(left + 1, top + 12, 1, 4, palette.deskTop);
  rect(left + width - 2, top + 12, 1, 4, palette.deskTop);
  rect(left + 3, top + 13, width - 6, 1, glow);
  rect(left + 7, top + 9, 2, 2, palette.mug);
  rect(left + 8, top + 8, 1, 1, "rgba(255,255,255,0.5)");
}

// Draws a screen (12x7 unless smaller), and returns the color it casts on the desk's light strip.
function drawYourScreen(
  left: number, top: number, screen: YourScreen | SideScreen, progress: number, palette: ScenePalette, seconds: number, width = 12, height = 7,
): string {
  context.save();
  context.beginPath();
  context.rect(left, top, width, height);
  context.clip();
  const glow = paintScreen(left, top, screen, progress, palette, seconds, width, height);
  context.restore();
  return glow;
}

function paintScreen(
  left: number, top: number, screen: YourScreen | SideScreen, progress: number, palette: ScenePalette, seconds: number, width: number, height: number,
): string {
  const blink = Math.floor(seconds / ERROR_BEAT_SECONDS) % 2 === 0;
  const pixels = (rows: string[], color: string, offsetX: number, offsetY: number) => rows.forEach((row, y) => [...row].forEach((cell, x) => {
    if (cell === "#") {
      rect(left + offsetX + x, top + offsetY + y, 1, 1, color);
    }
  }));
  switch (screen) {
    case "graph": {
      rect(left, top, width, height, palette.screenOn);
      rect(left, top + height - 1, width, 1, palette.screenIdle);
      const shift = Math.floor(seconds * 3);
      for (let x = 0; x < width; x++) {
        const value = Math.floor(noise((shift + x) * 0.37) * (height - 2));
        rect(left + x, top + height - 2 - value, 1, 1, palette.code[2 % palette.code.length]);
      }
      return palette.code[2 % palette.code.length];
    }
    case "log":
      rect(left, top, width, height, "#1A0505");
      for (let line = 0; line < 3; line++) {
        const scroll = Math.floor(seconds * 8) + line;
        rect(left + 1, top + 1 + line * 2, 1 + Math.floor(noise(scroll * 5.3) * (width - 3)), 1, line === 2 && blink ? "#FFFFFF" : "#FF5A4F");
      }
      return "#FF5A4F";
    case "radar": {
      rect(left, top, width, height, "#04140A");
      const centerX = left + Math.floor(width / 2);
      const centerY = top + Math.floor(height / 2);
      const angle = seconds * 5;
      for (let reach = 1; reach <= 4; reach++) {
        rect(Math.round(centerX + Math.cos(angle) * reach), Math.round(centerY + Math.sin(angle) * reach * 0.8), 1, 1, "#3DDC6A");
      }
      rect(centerX, centerY, 1, 1, "#B6FFC8");
      if (Math.floor(seconds * 3) % 2 === 0) {
        rect(left + 2, top + 1, 1, 1, "#FF5A4F");
        rect(left + width - 3, top + height - 2, 1, 1, "#FF5A4F");
      }
      return "#3DDC6A";
    }
    case "ok":
      rect(left, top, width, height, "#06260F");
      pixels(["....#", "...#.", "#.#..", ".#..."], "#3DDC6A", Math.floor((width - 5) / 2), 1);
      return "#3DDC6A";
    case "code":
      rect(left, top, 12, 7, palette.screenOn);
      for (let line = 0; line < 3; line++) {
        const scroll = Math.floor(seconds * 5) + line;
        const indent = Math.floor(noise(scroll * 3.1) * 3);
        rect(left + 1 + indent, top + 1 + line * 2, 2 + Math.floor(noise(scroll * 7.7) * (8 - indent)), 1, palette.code[scroll % palette.code.length]);
      }
      return palette.code[0];
    case "idle": {
      rect(left, top, 12, 7, palette.screenIdle);
      const bounce = Math.floor(seconds * 2) % 10;
      rect(left + 1 + bounce, top + 3 + (bounce % 2), 1, 1, palette.code[0]);
      return palette.screenIdle;
    }
    case "error":
      rect(left, top, 12, 7, blink ? "#B3261E" : "#2A0A0A");
      pixels(["#...#", ".#.#.", "..#..", ".#.#.", "#...#"], blink ? "#FFFFFF" : "#FF5A4F", 4, 1);
      return "#FF5A4F";
    case "alert":
      rect(left, top, 12, 7, blink ? "#B3261E" : "#1A0505");
      pixels(["#", "#", "#", ".", "#"], "#FFFFFF", 6, 1);
      rect(left, top, 12, 1, "#FF5A4F");
      rect(left, top + 6, 12, 1, "#FF5A4F");
      return "#FF5A4F";
    case "matrix":
      rect(left, top, 12, 7, "#020A04");
      for (let column = 0; column < 12; column++) {
        const head = Math.floor(seconds * (6 + noise(column) * 8) + noise(column * 9) * 7) % 10;
        for (let trail = 0; trail < 4; trail++) {
          const y = head - trail;
          if (y >= 0 && y < 7) {
            rect(left + column, top + y, 1, 1, trail === 0 ? "#B6FFC8" : trail === 1 ? "#3DDC6A" : "#14692E");
          }
        }
      }
      return "#3DDC6A";
    case "granted":
      rect(left, top, 12, 7, "#06260F");
      pixels([".###.", "#####", "#.#.#", "#####", ".#.#."], blink ? "#3DDC6A" : "#B6FFC8", 4, 1);
      return "#3DDC6A";
    case "progress": {
      rect(left, top, 12, 7, "#231A04");
      rect(left + 1, top + 3, 10, 3, "#F1C24B");
      rect(left + 2, top + 4, 8, 1, "#231A04");
      rect(left + 2, top + 4, Math.round((progress / 100) * 8), 1, "#FFE08A");
      rect(left + 1, top + 1, blink ? 6 : 4, 1, "#F1C24B");
      return "#F1C24B";
    }
    case "shield":
      rect(left, top, 12, 7, "#071B2C");
      pixels(["#####", "#####", "#####", ".###.", "..#.."], "#4FC3F7", 4, 1);
      rect(left + 6, top + 2, 1, 2, "#FFFFFF");
      return "#4FC3F7";
  }
}

// shiftX nudges the chair over, to center it under your station.
function drawChairBack(seat: Point, palette: ScenePalette, shiftX = 0): void {
  const left = seat.x * TILE + shiftX;
  const top = seat.y * TILE;
  rect(left + 3, top + 6, 10, 6, palette.chair);
  rect(left + 4, top + 7, 8, 1, palette.chairLight);
  rect(left + 7, top + 12, 2, 3, palette.chairLeg);
  rect(left + 4, top + 15, 8, 1, palette.chairLeg);
}

function drawProp(prop: Prop, palette: ScenePalette, seconds: number, index: number): void {
  const left = prop.at.x * TILE;
  const top = prop.at.y * TILE;
  switch (prop.kind) {
    case "plant":
      rect(left + 4, top + 9, 8, 7, palette.pot);
      rect(left + 3, top + 9, 10, 2, shadeColor(palette.pot));
      rect(left + 5, top - 2, 6, 11, "#3E8E41");
      rect(left + 2, top + 1, 4, 5, "#57A85A");
      rect(left + 10, top, 4, 6, "#57A85A");
      rect(left + 6, top - 5, 3, 4, "#6BBF59");
      return;
    case "cooler":
      rect(left + 4, top - 6, 8, 8, "#9ED8F5");
      rect(left + 5, top - 5, 2, 6, "#CFEFFF");
      rect(left + 3, top + 2, 10, 14, "#E8E8EC");
      rect(left + 5, top + 5, 2, 2, "#4E9BE0");
      rect(left + 9, top + 5, 2, 2, "#E0624A");
      rect(left + 4, top + 12, 8, 1, "#B9B9C2");
      return;
    case "coffee":
      rect(left + 1, top + 4, 14, 12, "#5A4636");
      rect(left + 2, top - 2, 12, 7, "#3A2D23");
      rect(left + 5, top + 6, 6, 5, "#1E1612");
      rect(left + 7, top + 9, 2, 2, "#FFFFFF");
      rect(left + 11, top, 2, 1, Math.floor(seconds * 2) % 2 === 0 ? "#E0624A" : "#5C2A20");
      return;
    case "vending":
      rect(left + 1, top - 8, 14, 24, "#C0392B");
      rect(left + 2, top - 7, 9, 18, "#1B2340");
      for (let row = 0; row < 4; row++) {
        for (let column = 0; column < 3; column++) {
          rect(left + 3 + column * 3, top - 6 + row * 4, 2, 2, ["#F1C24B", "#3DDC6A", "#4FC3F7", "#F06595"][(row + column + index) % 4]);
        }
      }
      rect(left + 12, top - 5, 2, 6, "#ECECEC");
      return;
    case "shelf":
      rect(left + 1, top - 8, 14, 24, "#7A5230");
      for (let shelf = 0; shelf < 3; shelf++) {
        const shelfTop = top - 6 + shelf * 7;
        rect(left + 2, shelfTop, 12, 6, "#3B2716");
        for (let book = 0; book < 5; book++) {
          const bookHeight = 3 + Math.floor(noise(index * 11 + shelf * 5 + book) * 3);
          rect(left + 3 + book * 2, shelfTop + 6 - bookHeight, 2, bookHeight, ["#C0392B", "#2E86AB", "#F3A712", "#4CB944", "#7950F2"][(book + shelf) % 5]);
        }
      }
      return;
    case "rack":
      rect(left + 1, top - 10, 14, 26, "#1C1F26");
      rect(left + 2, top - 9, 12, 24, "#2A2F3A");
      for (let unit = 0; unit < 6; unit++) {
        const unitTop = top - 8 + unit * 4;
        rect(left + 3, unitTop, 10, 3, "#14171D");
        const blink = noise(index * 13 + unit * 7 + Math.floor(seconds * (2 + unit % 3))) > 0.35;
        rect(left + 4, unitTop + 1, 1, 1, blink ? "#3DDC6A" : "#123018");
        rect(left + 6, unitTop + 1, 1, 1, noise(index + unit + Math.floor(seconds * 5)) > 0.7 ? "#F1C24B" : "#2A2410");
      }
      return;
    case "couch":
      // The seat; the backrest draws after anyone sitting on it.
      rect(left + 1, top + 4, TILE * 2 - 2, 6, palette.couch);
      if (palette.couchStyle === "sofa") {
        rect(left + 2, top + 5, TILE - 3, 4, palette.couchLight);
        rect(left + TILE + 1, top + 5, TILE - 3, 4, palette.couchLight);
      } else {
        rect(left + 2, top + 4, TILE * 2 - 4, 1, palette.couchLight);
      }
      return;
    case "pine":
      rect(left + 7, top + 9, 2, 7, "#4A3220");
      for (let row = 0; row < 18; row++) {
        const half = 1 + Math.floor((row % 6) * 0.9 + row / 4);
        rect(left + 8 - half, top - 9 + row, half * 2, 1, row % 6 < 2 ? "#3E7A38" : "#2F5A2E");
      }
      return;
    case "campfire": {
      // Stones, logs, a flickering fire, and a kettle on a tripod for a drink.
      rect(left + 1, top + 13, 3, 2, "#7A7264");
      rect(left + 12, top + 13, 3, 2, "#7A7264");
      rect(left + 3, top + 14, 10, 2, "#8E8574");
      rect(left + 3, top + 11, 10, 2, "#5B3A21");
      glow(left + 8, top + 9, 9, "#FFB347", 0.22 + 0.08 * Math.sin(seconds * 9));
      for (let flame = 0; flame < 4; flame++) {
        const height = 3 + Math.floor(noise(flame * 7 + Math.floor(seconds * 8)) * 5);
        rect(left + 4 + flame * 2, top + 11 - height, 2, height, flame % 2 === 0 ? "#F76707" : "#FFD43B");
      }
      for (let row = 0; row < 12; row++) {
        rect(left + 2 + Math.floor(row / 2), top - 1 + row, 1, 1, "#3A2716");
        rect(left + 13 - Math.floor(row / 2), top - 1 + row, 1, 1, "#3A2716");
      }
      rect(left + 8, top, 1, 2, "#3A2716");
      rect(left + 6, top + 2, 5, 4, "#2B2B33");
      rect(left + 7, top + 2, 2, 1, "#55556A");
      return;
    }
    case "stump":
      rect(left + 3, top + 6, 10, 10, "#6B4424");
      rect(left + 3, top + 4, 10, 3, "#C99A5E");
      rect(left + 5, top + 5, 6, 1, "#A47A44");
      rect(left + 4, top + 9, 1, 6, "#4A2E17");
      rect(left + 10, top + 8, 1, 7, "#4A2E17");
      return;
    case "mushroom": {
      const glows = sceneId === "cave";
      const cap = glows ? "#63E6BE" : "#E03131";
      if (glows) {
        glow(left + 8, top + 7, 8, cap, 0.2 + 0.1 * Math.sin(seconds * 2 + index));
      }
      rect(left + 6, top + 8, 4, 8, "#F1EBDD");
      rect(left + 2, top + 4, 12, 5, cap);
      rect(left + 4, top + 2, 8, 2, cap);
      rect(left + 5, top + 4, 2, 2, "#FFFFFF");
      rect(left + 10, top + 5, 2, 1, "#FFFFFF");
      rect(left + 8, top + 3, 1, 1, "#FFFFFF");
      return;
    }
    case "hay":
      rect(left + 1, top + 4, 14, 12, "#D9B44A");
      rect(left + 1, top + 4, 14, 2, "#EED27A");
      rect(left + 1, top + 9, 14, 1, "#B8902E");
      rect(left + 4, top + 4, 1, 12, "#9A6B3E");
      rect(left + 11, top + 4, 1, 12, "#9A6B3E");
      return;
    case "well":
      rect(left + 2, top + 7, 12, 9, "#8E8574");
      rect(left + 2, top + 9, 12, 1, "#7A7264");
      rect(left + 2, top + 12, 12, 1, "#7A7264");
      rect(left + 3, top + 6, 10, 2, "#1B2A3A");
      rect(left + 2, top - 6, 1, 13, "#6E4A27");
      rect(left + 13, top - 6, 1, 13, "#6E4A27");
      rect(left, top - 8, 16, 2, "#B5562F");
      rect(left + 2, top - 9, 12, 1, "#B5562F");
      rect(left + 8, top - 6, 1, 5 + Math.round(Math.sin(seconds) * 1), "#3A2716");
      rect(left + 7, top - 1 + Math.round(Math.sin(seconds)), 3, 3, "#9A6B3E");
      return;
    case "flowers":
      for (let stem = 0; stem < 4; stem++) {
        const sway = Math.round(Math.sin(seconds * 1.5 + stem + index) * 0.8);
        const x = left + 2 + stem * 3;
        const height = 6 + ((stem * 3 + index) % 4);
        rect(x, top + 16 - height, 1, height, "#3E7A38");
        rect(x - 1 + sway, top + 14 - height, 3, 3, ["#F783AC", "#FFD43B", "#FFFFFF", "#B197FC"][(stem + index) % 4]);
        rect(x + sway, top + 15 - height, 1, 1, "#F59F00");
      }
      return;
    case "scarecrow":
      rect(left + 7, top - 2, 2, 18, "#6E4A27");
      rect(left + 1, top + 1, 14, 2, "#6E4A27");
      rect(left + 4, top, 8, 7, "#C0392B");
      rect(left + 4, top + 3, 8, 1, "#8E2A1F");
      rect(left + 1, top + 3, 2, 2, "#EED27A");
      rect(left + 13, top + 3, 2, 2, "#EED27A");
      rect(left + 5, top - 6, 6, 5, "#EED27A");
      rect(left + 6, top - 4, 1, 1, "#2B2B33");
      rect(left + 9, top - 4, 1, 1, "#2B2B33");
      rect(left + 3, top - 7, 10, 1, "#9A6B3E");
      rect(left + 5, top - 9, 6, 2, "#9A6B3E");
      return;
    case "reeds":
      for (let reed = 0; reed < 5; reed++) {
        const sway = Math.round(Math.sin(seconds * 1.2 + reed * 0.9 + index) * 1);
        const x = left + 2 + reed * 3;
        const height = 12 + ((reed * 5 + index) % 7);
        rect(x, top + 16 - height + 3, 1, height - 3, "#4F7A3A");
        rect(x + sway, top + 16 - height, 1, 4, "#6E4A2A");
      }
      return;
    case "spring": {
      // A little pool bubbling up between stones.
      rect(left + 1, top + 8, 14, 7, "#8E8574");
      rect(left + 2, top + 9, 12, 5, "#3C8FC4");
      const ring = Math.floor(seconds * 3) % 4;
      rect(left + 8 - ring, top + 11, 1 + ring * 2, 1, "#8FD3F4");
      rect(left + 7, top + 10 - (Math.floor(seconds * 4) % 2), 1, 1, "#CFEFFF");
      rect(left + 1, top + 14, 3, 2, "#7A7264");
      rect(left + 11, top + 14, 4, 2, "#7A7264");
      return;
    }
    case "boulder":
      rect(left + 2, top + 6, 12, 10, "#8E8574");
      rect(left + 4, top + 4, 8, 2, "#8E8574");
      rect(left + 4, top + 5, 4, 2, "#B5AD9C");
      rect(left + 2, top + 13, 12, 3, "#6E6A60");
      rect(left + 9, top + 4, 3, 1, "#4F7A3A");
      return;
    case "stalagmite":
      for (let row = 0; row < 20; row++) {
        const half = 1 + Math.floor(row / 3.5);
        rect(left + 8 - half, top - 4 + row, half * 2, 1, row % 5 === 0 ? "#6A625C" : "#7A716A");
        rect(left + 8 - half, top - 4 + row, 1, 1, "#5A524D");
      }
      rect(left + 7, top - 3, 1, 8, "#958B83");
      return;
    case "crystal": {
      const pulse = 0.5 + 0.5 * Math.sin(seconds * 2 + index);
      glow(left + 8, top + 5, 10, "#B197FC", 0.12 + pulse * 0.18);
      rect(left + 6, top - 3, 3, 18, "#9775FA");
      rect(left + 7, top - 5, 1, 2, "#E5DBFF");
      rect(left + 2, top + 5, 3, 10, "#63E6BE");
      rect(left + 3, top + 3, 1, 2, "#C3FAE8");
      rect(left + 10, top + 2, 3, 13, "#B197FC");
      rect(left + 11, top, 1, 2, "#E5DBFF");
      rect(left + 1, top + 14, 14, 2, "#3D3734");
      return;
    }
    case "moonRock":
      rect(left + 2, top + 8, 12, 8, "#8E8E96");
      rect(left + 4, top + 6, 7, 2, "#8E8E96");
      rect(left + 4, top + 7, 3, 2, "#BDBDC4");
      rect(left + 9, top + 11, 3, 2, "#6E6E78");
      return;
    case "oxygen":
      // A rack of O2 tanks with a gauge, for a drink.
      rect(left + 1, top - 6, 14, 22, "#6E6E78");
      for (let tank = 0; tank < 3; tank++) {
        rect(left + 2 + tank * 4, top - 4, 3, 16, "#F1F1F5");
        rect(left + 2 + tank * 4, top + 1, 3, 2, "#F08C00");
      }
      rect(left + 3, top + 13, 10, 2, "#2B2B33");
      rect(left + 4, top + 13, 1 + Math.floor(seconds * 2) % 8, 1, "#3DDC6A");
      return;
    case "dish": {
      const turn = Math.round(Math.sin(seconds * 0.4) * 2);
      rect(left + 7, top + 2, 2, 14, "#B8B8C2");
      rect(left + 4, top + 13, 8, 3, "#8E8E96");
      rect(left + 2 + turn, top - 6, 12, 2, "#E4E4EA");
      rect(left + 3 + turn, top - 4, 10, 2, "#D0D0D8");
      rect(left + 5 + turn, top - 2, 6, 2, "#B8B8C2");
      rect(left + 7 + turn, top - 9, 1, 3, "#8E8E96");
      rect(left + 7 + turn, top - 10, 1, 1, Math.floor(seconds * 1.5) % 2 === 0 ? "#FF6B6B" : "#5C2A2A");
      return;
    }
    case "flag":
      // No wind on the moon: the rod along the top holds it out.
      rect(left + 3, top - 8, 1, 24, "#D8D8E0");
      rect(left + 4, top - 8, 10, 1, "#D8D8E0");
      rect(left + 4, top - 7, 10, 7, "#F08C00");
      rect(left + 8, top - 5, 2, 3, "#FFFFFF");
      rect(left + 7, top - 4, 4, 1, "#FFFFFF");
      rect(left + 2, top + 14, 3, 2, "#8E8E96");
      return;
  }
}

// A soft round glow: a few stacked crosses, faintest at the edge.
function glow(centerX: number, centerY: number, radius: number, color: string, alpha: number): void {
  context.globalAlpha = alpha / 3;
  for (let step = 3; step >= 1; step--) {
    const r = Math.round((radius * step) / 3);
    const inner = Math.round(r * 0.6);
    rect(centerX - r, centerY - inner, r * 2, inner * 2, color);
    rect(centerX - inner, centerY - r, inner * 2, r * 2, color);
  }
  context.globalAlpha = 1;
}

function drawCouchBack(prop: Prop, palette: ScenePalette): void {
  const left = prop.at.x * TILE;
  const top = prop.at.y * TILE;
  if (palette.couchStyle !== "sofa") {
    // A log or a stone slab: no back, just its front, and ring ends on a log.
    rect(left + 1, top + 9, TILE * 2 - 2, 6, shadeColor(palette.couch));
    rect(left + 1, top + 15, TILE * 2 - 2, 1, palette.shadow);
    if (palette.couchStyle === "log") {
      for (let x = 5; x < TILE * 2 - 4; x += 6) {
        rect(left + x, top + 11, 3, 1, palette.couch);
      }
      rect(left, top + 5, 3, 10, palette.couchLight);
      rect(left + 1, top + 8, 1, 3, palette.couch);
      rect(left + TILE * 2 - 3, top + 5, 3, 10, palette.couchLight);
      rect(left + TILE * 2 - 2, top + 8, 1, 3, palette.couch);
    } else {
      rect(left + 6, top + 11, 4, 1, palette.couchLight);
      rect(left + 18, top + 12, 3, 1, palette.couchLight);
    }
    return;
  }
  rect(left, top + 9, TILE * 2, 7, shadeColor(palette.couch));
  rect(left, top + 4, 3, 12, palette.couch);
  rect(left + TILE * 2 - 3, top + 4, 3, 12, palette.couch);
  rect(left + 3, top + 10, TILE * 2 - 6, 1, palette.couchLight);
}

function shadeColor(color: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (match === null) {
    return color;
  }
  const value = parseInt(match[1], 16);
  return "rgb(" + [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => Math.round(channel * 0.75)).join(",") + ")";
}

interface AgentBox {
  agent: Agent;
  left: number;
  top: number;
}

function agentBox(agent: Agent, seated: boolean): AgentBox {
  const left = Math.round((agent.x + stationSlide(agent)) * TILE + (TILE - FRAME_WIDTH) / 2);
  const top = Math.round(agent.y * TILE + TILE - FRAME_HEIGHT - (seated ? SEATED_LIFT : 0));
  return { agent, left, top };
}

// Your chair sits between two tiles, half a tile right of the seat you walk to, so you ease over to it on the last
// step instead of jumping when you sit.
function stationSlide(agent: Agent): number {
  if (!agent.you) {
    return 0;
  }
  const distance = Math.hypot(agent.x - agent.workSpot.x, agent.y - agent.workSpot.y);
  return 0.5 * Math.max(0, 1 - distance);
}

function drawAgent(agent: Agent, seconds: number): AgentBox {
  const pose = agentPose(agent, seconds);
  const box = agentBox(agent, pose.seated);
  // A small shadow under standing guys.
  if (!pose.seated) {
    context.globalAlpha = 0.25;
    rect(box.left + 2, Math.round(agent.y * TILE) + TILE - 2, FRAME_WIDTH - 4, 2, "#000");
    context.globalAlpha = 1;
  }
  const bob = pose.pose === "walk" && pose.frame % 2 === 1 ? -1 : 0;
  context.globalAlpha = agent.leaving ? 0.7 : 1;
  context.drawImage(sprite(agent.seed, pose.pose, pose.facing, pose.frame), box.left, box.top + bob);
  context.globalAlpha = 1;
  return box;
}

// You sit centered between your station's two seats.
function drawYou(station: Station, reaction: YourReaction): { left: number; top: number } {
  const left = Math.round(station.seat.x * TILE + TILE / 2 + (TILE - FRAME_WIDTH) / 2);
  const top = Math.round(station.seat.y * TILE + TILE - FRAME_HEIGHT - (reaction.seated ? SEATED_LIFT : 0) - reaction.hop);
  if (!reaction.seated) {
    context.globalAlpha = 0.25;
    rect(left + 2, station.seat.y * TILE + TILE - 2, FRAME_WIDTH - 4, 2, "#000");
    context.globalAlpha = 1;
  }
  if (youKey !== undefined) {
    context.drawImage(sprite(youKey, reaction.pose, reaction.facing, reaction.frame), left, top);
  }
  return { left, top };
}

// bubbleTop puts the bubble higher than over the guy's head; your bubble sits above your monitors.
function drawBubble(box: { left: number; top: number }, text: string, palette: ScenePalette, bubbleTop = box.top - 11): void {
  context.font = "7px monospace";
  const textWidth = Math.ceil(context.measureText(text).width);
  const bubbleWidth = textWidth + 6;
  // Long lines stay inside the room; the tail stays over the guy.
  const bubbleLeft = Math.max(1, Math.min(state.layout.cols * TILE - bubbleWidth - 1, Math.round(box.left + FRAME_WIDTH / 2 - bubbleWidth / 2)));
  rect(bubbleLeft, bubbleTop, bubbleWidth, 9, palette.bubbleEdge);
  rect(bubbleLeft + 1, bubbleTop + 1, bubbleWidth - 2, 7, palette.bubble);
  rect(box.left + FRAME_WIDTH / 2 - 1, bubbleTop + 9, 2, 1, palette.bubbleEdge);
  context.fillStyle = palette.bubbleText;
  context.textBaseline = "top";
  context.fillText(text, bubbleLeft + 3, bubbleTop + 1.5);
}

// Three z's drifting up and fading, each a little bigger than the last.
function drawSnore(box: AgentBox, seconds: number, palette: ScenePalette): void {
  const offset = (box.agent.id.length * 0.73) % 3;
  context.textBaseline = "alphabetic";
  for (let index = 0; index < 3; index++) {
    const age = (seconds + offset + index) % 3;
    const rise = age / 3;
    context.globalAlpha = Math.sin(rise * Math.PI);
    context.font = `${5 + index}px monospace`;
    context.fillStyle = palette.snore;
    context.fillText("z", box.left + 8 + rise * 6 + Math.sin(age * 3) * 1.5, box.top + 6 - rise * 12);
  }
  context.globalAlpha = 1;
}

function drawNameTag(box: AgentBox, palette: ScenePalette): void {
  const text = box.agent.title.length > 28 ? box.agent.title.slice(0, 27) + "…" : box.agent.title;
  context.font = "7px monospace";
  const textWidth = Math.ceil(context.measureText(text).width);
  const tagLeft = Math.max(1, Math.min(state.layout.cols * TILE - textWidth - 5, Math.round(box.left + FRAME_WIDTH / 2 - textWidth / 2 - 2)));
  const tagTop = box.top + FRAME_HEIGHT + 1;
  rect(tagLeft, tagTop, textWidth + 4, 9, palette.bubbleEdge);
  context.fillStyle = palette.bubble;
  context.textBaseline = "top";
  context.fillText(text, tagLeft + 2, tagTop + 1.5);
}

// A wash over the room while an event plays, like the other views' recolor but lighter.
function drawEventTint(event: YourEvent | undefined, layout: OfficeLayout): void {
  if (event === undefined) {
    return;
  }
  let color: string | undefined;
  let alpha = 0;
  if (event.kind === "error" && event.age < ERROR_FLASH_SECONDS) {
    color = "#FF2A1F";
    alpha = Math.floor(event.age / ERROR_BEAT_SECONDS) % 2 === 0 ? 0.16 : 0.06;
  } else if (event.kind === "hack" && event.age < EVENT_SECONDS.hack) {
    color = "#3DDC6A";
    alpha = 0.08 * Math.min(1, event.age / 0.6, (EVENT_SECONDS.hack - event.age) / 0.6);
  } else if (event.kind === "defense" && event.age < EVENT_SECONDS.defense) {
    const beat = DEFENSE_BEATS.filter((start) => event.age >= start).length - 1;
    const beatAge = event.age - DEFENSE_BEATS[beat];
    color = ["#FF2A1F", "#F1C24B", "#F1C24B", "#4FC3F7"][beat];
    alpha = beat === 0 ? 0.06 + 0.08 * (0.5 + 0.5 * Math.sin(event.age * 14)) : beat === 3 ? 0.3 * Math.max(0, 1 - beatAge / 0.6) : 0.05;
  }
  if (color === undefined || alpha <= 0) {
    return;
  }
  context.globalAlpha = alpha;
  rect(0, 0, layout.cols * TILE, layout.rows * TILE, color);
  context.globalAlpha = 1;
}

// ----- Frame -----

let boxes: AgentBox[] = [];
let youArea: { left: number; top: number } | undefined;

function draw(seconds: number): void {
  const pixelRatio = window.devicePixelRatio || 1;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  const event = currentEvent();
  const station = state.layout.station;
  const you = youAgent(state);
  const atStation = you !== undefined && isAtStation(you);
  // Away from your desk, the station's screen sits on the screensaver unless an event is on it.
  const deskReaction = yourReaction(event, seconds);
  const reaction = atStation || event !== undefined ? deskReaction : { ...deskReaction, screen: "idle" as const, shake: 0 };
  const shake = reaction.shake * (Math.floor(seconds * 30) % 2 === 0 ? 1 : -1) * scale;
  context.setTransform(pixelRatio * scale, 0, 0, pixelRatio * scale, pixelRatio * (originX + shake), pixelRatio * originY);
  context.imageSmoothingEnabled = false;
  const palette = SCENE_PALETTES[sceneId];
  const layout = state.layout;
  const eventColor = eventCodeColor(event);
  drawFloor(layout, palette);
  drawWall(layout, palette, seconds);

  // Everything that stands on the floor, back to front. A fraction orders things on the same row.
  const owners = new Map<number, Agent>();
  state.agents.forEach((agent) => {
    if (agent.deskIndex !== undefined) {
      owners.set(agent.deskIndex, agent);
    }
  });
  const layers: { depth: number; paint: () => void }[] = [];
  layout.desks.forEach((desk, index) => {
    layers.push({ depth: desk.desk.y + 0.4, paint: () => drawDesk(desk, owners.get(index), palette, seconds, index, eventColor) });
    layers.push({ depth: desk.seat.y + 0.7, paint: () => drawChairBack(desk.seat, palette) });
  });
  layout.props.forEach((prop, index) => {
    layers.push({ depth: prop.at.y + (prop.kind === "couch" ? 0.3 : 0.8), paint: () => drawProp(prop, palette, seconds, index) });
    if (prop.kind === "couch") {
      layers.push({ depth: prop.at.y + 0.7, paint: () => drawCouchBack(prop, palette) });
    }
  });
  let youBox: { left: number; top: number } | undefined;
  if (station !== undefined && you !== undefined) {
    layers.push({ depth: station.desk.y + 0.4, paint: () => drawStation(station, reaction, palette, seconds) });
    layers.push({ depth: station.seat.y + 0.7, paint: () => drawChairBack(station.seat, palette, TILE / 2) });
    if (atStation) {
      layers.push({ depth: station.seat.y + 0.5, paint: () => { youBox = drawYou(station, reaction); } });
    }
  }
  const nextBoxes: AgentBox[] = [];
  state.agents.forEach((agent) => {
    if (agent.you && atStation) {
      return;
    }
    layers.push({ depth: agent.y + 0.5, paint: () => nextBoxes.push(drawAgent(agent, seconds)) });
  });
  layers.sort((first, second) => first.depth - second.depth).forEach((layer) => layer.paint());
  boxes = nextBoxes;

  boxes.forEach((box) => {
    if (box.agent.mode === "sleep" && box.agent.path.length === 0 && box.agent.bubble === undefined) {
      drawSnore(box, seconds, palette);
    }
    if (box.agent.bubble !== undefined) {
      drawBubble(box, box.agent.bubble.text, palette);
    }
  });
  youArea = youBox;
  const finalYouBox = youBox as { left: number; top: number } | undefined;
  const yourBubble = reaction.bubble ?? (you?.bubble?.text);
  if (finalYouBox !== undefined && yourBubble !== undefined) {
    // Above the monitors, so it never covers the screens.
    const monitorsTop = station === undefined ? finalYouBox.top : station.desk.y * TILE - 2;
    drawBubble(finalYouBox, yourBubble, palette, Math.min(finalYouBox.top, monitorsTop) - 11);
  }
  drawEventTint(event, layout);
  const hovered = boxes.find((box) => box.agent.id === hoveredId);
  if (hovered !== undefined) {
    drawNameTag(hovered, palette);
  }

  const counts = officeCounts(state);
  const countText = [`${counts.working} working`, `${counts.idle} idle`, ...(counts.asleep > 0 ? [`${counts.asleep} asleep`] : [])];
  statusLabel.textContent = state.agents.length === 0 ? "quiet" : countText.join(" · ");
}

let frameHandle = 0;
let lastTime: number | undefined;
function loop(now: number): void {
  frameHandle = requestAnimationFrame(loop);
  const seconds = now / 1000;
  if (lastTime !== undefined) {
    stepOffice(state, seconds - lastTime, random);
    playRoomReactions();
  }
  lastTime = seconds;
  if (width > 0 && height > 0) {
    draw(state.time);
  }
}

document.addEventListener("visibilitychange", () => {
  cancelAnimationFrame(frameHandle);
  lastTime = undefined;
  if (!document.hidden) {
    frameHandle = requestAnimationFrame(loop);
  }
});
frameHandle = requestAnimationFrame(loop);

// ----- Pointer -----

function agentAt(clientX: number, clientY: number): Agent | undefined {
  const bounds = canvas.getBoundingClientRect();
  const roomX = (clientX - bounds.left - originX) / scale;
  const roomY = (clientY - bounds.top - originY) / scale;
  // Front-most first.
  return [...boxes].reverse().find((box) =>
    roomX >= box.left && roomX < box.left + FRAME_WIDTH && roomY >= box.top && roomY < box.top + FRAME_HEIGHT,
  )?.agent;
}

function isOverYou(clientX: number, clientY: number): boolean {
  if (youArea === undefined) {
    return false;
  }
  const bounds = canvas.getBoundingClientRect();
  const roomX = (clientX - bounds.left - originX) / scale;
  const roomY = (clientY - bounds.top - originY) / scale;
  return roomX >= youArea.left && roomX < youArea.left + FRAME_WIDTH && roomY >= youArea.top && roomY < youArea.top + FRAME_HEIGHT;
}

canvas.addEventListener("mousemove", (event) => {
  const hit = agentAt(event.clientX, event.clientY);
  const agent = hit?.you ? undefined : hit;
  hoveredId = agent?.id;
  youHovered = hit?.you === true || (agent === undefined && isOverYou(event.clientX, event.clientY));
  canvas.style.cursor = agent === undefined ? "default" : "pointer";
  if (youHovered) {
    tooltip.hidden = false;
    tooltip.textContent = sceneEvent !== undefined ? `you · ${sceneEvent.kind}!` : hit?.you ? "you · on break" : "you · on watch";
    return;
  }
  if (agent === undefined) {
    tooltip.hidden = true;
    return;
  }
  tooltip.hidden = false;
  tooltip.textContent = `${agent.title} · ${agent.status === "asleep" ? "suspended" : agent.status}`;
});

canvas.addEventListener("mouseleave", () => {
  hoveredId = undefined;
  youHovered = false;
  tooltip.hidden = true;
});

canvas.addEventListener("click", (event) => {
  const agent = agentAt(event.clientX, event.clientY);
  if (agent !== undefined && !agent.you) {
    vscode.postMessage({ type: "open", sessionId: agent.id });
  }
});

vscode.postMessage({ type: "ready" });
