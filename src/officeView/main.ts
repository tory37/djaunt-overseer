// The Office webview: draws the floor plan and the pixel guys, and runs the simulation every frame. The extension
// posts the live sessions ({ type: "office" }); a click on a guy posts { type: "open" } back.

import { buildOfficeLayout, Desk, OFFICE_SCENES, OfficeLayout, OfficeSceneId, officeSceneId, Point, Prop } from "../officeLayout";
import { Agent, AgentInput, agentPose, createOffice, officeCounts, relayoutOffice, stepOffice, syncOffice } from "../officeSim";
import { Facing, FRAME_HEIGHT, FRAME_WIDTH, pixelGuyFrame, pixelGuyLook, PixelGuyLook, Pose } from "../pixelGuy";
import { SCENE_PALETTES, ScenePalette } from "./palettes";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

interface OfficeMessage {
  type: "office";
  scene: string;
  agents: AgentInput[];
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

const random = Math.random;

// Sizes the room to the view: whole-pixel zoom when there's space, shrunk to fit when there isn't.
function fitLayout(): void {
  const zoom = Math.max(1, Math.min(4, Math.floor(Math.min(width / (TILE * 10), height / (TILE * 6)))));
  const cols = Math.floor(width / (TILE * zoom));
  const rows = Math.floor(height / (TILE * zoom));
  const layout = state.layout;
  const target = buildOfficeLayout(cols, rows, sceneId);
  if (target.cols !== layout.cols || target.rows !== layout.rows || sceneChanged) {
    sceneChanged = false;
    relayoutOffice(state, target, random);
  }
  scale = Math.min(zoom, width / (state.layout.cols * TILE), height / (state.layout.rows * TILE));
  originX = Math.floor((width - state.layout.cols * TILE * scale) / 2);
  originY = Math.floor((height - state.layout.rows * TILE * scale) / 2);
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

window.addEventListener("message", (event: MessageEvent<OfficeMessage>) => {
  const data = event.data;
  if (data === null || typeof data !== "object" || data.type !== "office" || !Array.isArray(data.agents)) {
    return;
  }
  const nextScene = officeSceneId(data.scene);
  if (nextScene !== sceneId) {
    sceneId = nextScene;
    sceneChanged = true;
    if (width > 0 && height > 0) {
      fitLayout();
    }
  }
  latestInputs = data.agents.filter((agent) => typeof agent?.id === "string" && (agent.status === "working" || agent.status === "idle"));
  // The first sync seats everyone where they belong; later ones walk newcomers in from the door.
  syncOffice(state, latestInputs, random, hasSynced ? "door" : "seated");
  hasSynced = true;
  sceneLabel.textContent = OFFICE_SCENES.find((scene) => scene.id === sceneId)?.label.toLowerCase() ?? "office";
});

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
      rect(left, top, TILE, TILE, (x + y) % 2 === 0 ? palette.floor : palette.floorAlt);
      rect(left, top + TILE - 1, TILE, 1, palette.floorLine);
      if (palette.planks) {
        rect(left + ((y * 5) % TILE), top, 1, TILE - 1, palette.floorLine);
      } else {
        rect(left + TILE - 1, top, 1, TILE, palette.floorLine);
      }
    }
  }
  // A soft shadow under the back wall.
  rect(0, TILE, layout.cols * TILE, 2, palette.shadow);
}

function drawWall(layout: OfficeLayout, palette: ScenePalette, seconds: number): void {
  rect(0, 0, layout.cols * TILE, TILE, palette.wall);
  rect(0, TILE - 3, layout.cols * TILE, 3, palette.wallTrim);
  for (let x = 3; x < layout.cols - 1; x += 5) {
    if (palette.windows) {
      drawWindow(x * TILE + 1, 2, palette);
    } else {
      drawWallPanel(x * TILE + 1, 2, palette, seconds, x);
    }
  }
  if (layout.cols >= 12) {
    drawWallClock((layout.cols - 2) * TILE + 4, 3, palette);
  }
  drawDoor(layout.door, palette);
}

function drawWindow(left: number, top: number, palette: ScenePalette): void {
  const hour = new Date().getHours() + new Date().getMinutes() / 60;
  const isNight = hour < 6.5 || hour >= 19.5;
  const isDusk = !isNight && (hour < 8 || hour >= 18);
  rect(left, top, 14, 10, palette.windowFrame);
  rect(left + 1, top + 1, 12, 8, isNight ? "#1B2340" : isDusk ? "#F2A65A" : "#8FD3F4");
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

function drawWallClock(left: number, top: number, palette: ScenePalette): void {
  const now = new Date();
  rect(left, top, 8, 8, palette.wallTrim);
  rect(left + 1, top + 1, 6, 6, "#F5F1E6");
  const centerX = left + 4;
  const centerY = top + 4;
  const hand = (fraction: number, length: number) => {
    const angle = fraction * Math.PI * 2 - Math.PI / 2;
    rect(Math.round(centerX + Math.cos(angle) * length) - 0.5, Math.round(centerY + Math.sin(angle) * length) - 0.5, 1, 1, "#222");
  };
  hand((now.getHours() % 12) / 12, 1.5);
  hand(now.getMinutes() / 60, 2.5);
  rect(centerX - 0.5, centerY - 0.5, 1, 1, "#C0392B");
}

function drawDoor(door: Point, palette: ScenePalette): void {
  const open = state.agents.some((agent) => Math.abs(agent.x - door.x) + Math.abs(agent.y - door.y) < 1.2);
  const left = door.x * TILE + 2;
  rect(left, 1, 12, TILE - 1, palette.doorFrame);
  rect(left + 1, 2, 10, TILE - 2, open ? "#121212" : palette.door);
  if (!open) {
    rect(left + 8, 9, 1, 1, "#F1C24B");
  }
}

function drawDesk(desk: Desk, owner: Agent | undefined, palette: ScenePalette, seconds: number, index: number): void {
  const left = desk.desk.x * TILE;
  const top = desk.desk.y * TILE;
  // Monitor, facing the seat below.
  rect(left + 3, top, 10, 8, palette.monitor);
  const typing = owner !== undefined && owner.mode === "type" && owner.path.length === 0;
  const present = owner !== undefined && !owner.leaving;
  rect(left + 4, top + 1, 8, 6, typing ? palette.screenOn : present ? palette.screenIdle : palette.screenOff);
  if (typing) {
    for (let line = 0; line < 3; line++) {
      const scroll = Math.floor(seconds * 4) + line;
      const lineWidth = 2 + Math.floor(noise(index * 31 + scroll) * 6);
      const indent = Math.floor(noise(index * 17 + scroll) * 2);
      rect(left + 5 + indent, top + 2 + line * 2, Math.min(lineWidth, 6 - indent), 1, palette.code[(scroll + index) % palette.code.length]);
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

function drawChairBack(seat: Point, palette: ScenePalette): void {
  const left = seat.x * TILE;
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
      rect(left + 2, top + 5, TILE - 3, 4, palette.couchLight);
      rect(left + TILE + 1, top + 5, TILE - 3, 4, palette.couchLight);
      return;
  }
}

function drawCouchBack(prop: Prop, palette: ScenePalette): void {
  const left = prop.at.x * TILE;
  const top = prop.at.y * TILE;
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
  const left = Math.round(agent.x * TILE + (TILE - FRAME_WIDTH) / 2);
  const top = Math.round(agent.y * TILE + TILE - FRAME_HEIGHT - (seated ? SEATED_LIFT : 0));
  return { agent, left, top };
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

function drawBubble(box: AgentBox, text: string, palette: ScenePalette): void {
  context.font = "7px monospace";
  const textWidth = Math.ceil(context.measureText(text).width);
  const bubbleWidth = textWidth + 6;
  const bubbleLeft = Math.round(box.left + FRAME_WIDTH / 2 - bubbleWidth / 2);
  const bubbleTop = box.top - 11;
  rect(bubbleLeft, bubbleTop, bubbleWidth, 9, palette.bubbleEdge);
  rect(bubbleLeft + 1, bubbleTop + 1, bubbleWidth - 2, 7, palette.bubble);
  rect(box.left + FRAME_WIDTH / 2 - 1, bubbleTop + 9, 2, 1, palette.bubbleEdge);
  context.fillStyle = palette.bubbleText;
  context.textBaseline = "top";
  context.fillText(text, bubbleLeft + 3, bubbleTop + 1.5);
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

// ----- Frame -----

let boxes: AgentBox[] = [];

function draw(seconds: number): void {
  const pixelRatio = window.devicePixelRatio || 1;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.setTransform(pixelRatio * scale, 0, 0, pixelRatio * scale, pixelRatio * originX, pixelRatio * originY);
  context.imageSmoothingEnabled = false;
  const palette = SCENE_PALETTES[sceneId];
  const layout = state.layout;
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
    layers.push({ depth: desk.desk.y + 0.4, paint: () => drawDesk(desk, owners.get(index), palette, seconds, index) });
    layers.push({ depth: desk.seat.y + 0.7, paint: () => drawChairBack(desk.seat, palette) });
  });
  layout.props.forEach((prop, index) => {
    layers.push({ depth: prop.at.y + (prop.kind === "couch" ? 0.3 : 0.8), paint: () => drawProp(prop, palette, seconds, index) });
    if (prop.kind === "couch") {
      layers.push({ depth: prop.at.y + 0.7, paint: () => drawCouchBack(prop, palette) });
    }
  });
  const nextBoxes: AgentBox[] = [];
  state.agents.forEach((agent) => {
    layers.push({ depth: agent.y + 0.5, paint: () => nextBoxes.push(drawAgent(agent, seconds)) });
  });
  layers.sort((first, second) => first.depth - second.depth).forEach((layer) => layer.paint());
  boxes = nextBoxes;

  boxes.forEach((box) => {
    if (box.agent.bubble !== undefined) {
      drawBubble(box, box.agent.bubble.text, palette);
    }
  });
  const hovered = boxes.find((box) => box.agent.id === hoveredId);
  if (hovered !== undefined) {
    drawNameTag(hovered, palette);
  }

  const counts = officeCounts(state);
  statusLabel.textContent = state.agents.length === 0 ? "quiet" : `${counts.working} working · ${counts.idle} idle`;
}

let frameHandle = 0;
let lastTime: number | undefined;
function loop(now: number): void {
  frameHandle = requestAnimationFrame(loop);
  const seconds = now / 1000;
  if (lastTime !== undefined) {
    stepOffice(state, seconds - lastTime, random);
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

canvas.addEventListener("mousemove", (event) => {
  const agent = agentAt(event.clientX, event.clientY);
  hoveredId = agent?.id;
  canvas.style.cursor = agent === undefined ? "default" : "pointer";
  if (agent === undefined) {
    tooltip.hidden = true;
    return;
  }
  tooltip.hidden = false;
  tooltip.textContent = `${agent.title} · ${agent.status === "working" ? "working" : "idle"}`;
});

canvas.addEventListener("mouseleave", () => {
  hoveredId = undefined;
  tooltip.hidden = true;
});

canvas.addEventListener("click", (event) => {
  const agent = agentAt(event.clientX, event.clientY);
  if (agent !== undefined) {
    vscode.postMessage({ type: "open", sessionId: agent.id });
  }
});

vscode.postMessage({ type: "ready" });
