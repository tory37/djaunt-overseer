import * as vscode from "vscode";
import { resolveDecorativeScene } from "./decorativeScene";
import { DJAUNT_MARK_PATHS, DJAUNT_MARK_VIEW_BOX } from "./djauntMark";
import { HACKER_TICKER_SCRIPT } from "./hackerTicker";
import type { SceneEventDirector } from "./sceneEvents";

export const DRAGON_PANEL_VIEW_ID = "overseer.dragon";

const TICKER_SETTING = "overseer.views.ticker";

// Decorative only: the djaunt dragon as a 3D point cloud on a loop, its half of the ERROR, HACK, and DEFENSE bits, and
// the hacker ticker strip along the bottom. It reads nothing and does nothing.
export class DragonPanelProvider implements vscode.WebviewViewProvider {
  constructor(private readonly sceneEvents: SceneEventDirector) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    const render = () => {
      const strip = vscode.workspace.getConfiguration().get<boolean>(TICKER_SETTING, true);
      resolveDecorativeScene(webviewView, "Djaunt", readouts(strip), dragonScript(strip));
    };
    render();
    const configListener = vscode.workspace.onDidChangeConfiguration((change) => {
      if (change.affectsConfiguration(TICKER_SETTING)) render();
    });
    webviewView.onDidDispose(() => configListener.dispose());
    this.sceneEvents.attach(webviewView);
  }
}

function readouts(strip: boolean): string {
  const bottom = strip ? "above-strip" : "bottom";
  return `<div class="readout top left"><span class="live">djaunt</span> // mark</div>
<div class="readout top right" id="points"></div>
<div class="readout ${bottom} left" id="stage"></div>
<div class="readout ${bottom} right" id="clock"></div>`;
}

function dragonScript(strip: boolean): string {
  return `
  const STRIP_HEIGHT = ${strip ? 22 : 0};` + DRAGON_SCRIPT + (strip ? HACKER_TICKER_SCRIPT : "");
}

const DRAGON_SCRIPT = `
  const MARK_VIEW_BOX = ${JSON.stringify(DJAUNT_MARK_VIEW_BOX)};
  const MARK_PATHS = ${JSON.stringify(DJAUNT_MARK_PATHS)};
  const stageLabel = document.getElementById("stage");
  const clockLabel = document.getElementById("clock");
  const dragon = buildDragon();
  document.getElementById("points").textContent = "pts " + dragon.points.length;
  const LOOP_SECONDS = 16;
  const STAGES = [[2, "assemble"], [9, "spin"], [11.5, "ripple"], [13.5, "glitch"], [16, "scatter"]];

  // Rasterizes the mark, then samples it into a point cloud: both faces, plus edge rings through the depth.
  function buildDragon() {
    const [minX, minY, viewWidth, viewHeight] = MARK_VIEW_BOX;
    const columns = 96;
    const rows = Math.round(columns * viewHeight / viewWidth);
    const mask = document.createElement("canvas");
    mask.width = columns;
    mask.height = rows;
    const maskContext = mask.getContext("2d");
    maskContext.scale(columns / viewWidth, rows / viewHeight);
    maskContext.translate(-minX, -minY);
    MARK_PATHS.forEach((path) => maskContext.fill(new Path2D(path)));
    const alpha = maskContext.getImageData(0, 0, columns, rows).data;
    const filled = (column, row) => column >= 0 && row >= 0 && column < columns && row < rows && alpha[(row * columns + column) * 4 + 3] > 96;
    const thickness = 0.14;
    const points = [];
    const add = (column, row, z, kind) => {
      const x = (column / columns) * 2 - 1;
      const y = (1 - row / rows * 2) * (rows / columns);
      const direction = [Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1];
      const length = Math.hypot(...direction) || 1;
      const reach = 1.2 + Math.random() * 1.6;
      points.push({ home: [x, y, z], scatter: direction.map((value) => (value / length) * reach), row, kind, delay: Math.random() * 0.4 });
    };
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        if (!filled(column, row)) continue;
        const edge = !filled(column - 1, row) || !filled(column + 1, row) || !filled(column, row - 1) || !filled(column, row + 1);
        if ((row + column) % 2 === 0) { add(column, row, thickness, "front"); add(column, row, -thickness, "back"); }
        if (edge) [-0.5, 0, 0.5].forEach((depth) => add(column, row, depth * 2 * thickness, "side"));
      }
    }
    return { points, rows };
  }

  // One loop: assemble, spin, ripple, glitch, scatter. The scatter ends where the next assemble starts.
  // During HACK the cloud blows apart, then pulls back together for the reveal.
  function hackGather(event) {
    if (event === null || event.kind !== "hack" || event.age >= HACK_REVEAL_SECONDS) return -1;
    return event.age < 0.6 ? easeInOut(event.age / 0.6) : 1 - easeInOut((event.age - 0.6) / (HACK_REVEAL_SECONDS - 0.6));
  }

  // During DEFENSE the cloud bristles at the alert, holds tight while blocking, and bursts once when safe.
  function defenseSpread(event, point, seconds) {
    if (event === null || event.kind !== "defense") return -1;
    if (event.beat === 0) return 0.015 + 0.035 * (0.5 + 0.5 * Math.sin(seconds * 38 + point.row * 1.7 + point.delay * 40));
    if (event.beat === 2) return 0.02 * Math.random();
    if (event.beat === 3 && event.beatAge < 0.7) return 0.4 * (1 - easeInOut(event.beatAge / 0.7));
    return 0;
  }

  // The scene lives above the ticker strip. Big text centers there too.
  const sceneHeight = () => Math.max(0, height - STRIP_HEIGHT);
  const aboveStrip = (options) => {
    const ratio = height > 0 ? sceneHeight() / height : 1;
    const { maxHeight = 0.3, ...rest } = options || {};
    return { ...rest, centerY: ratio / 2, maxHeight: maxHeight * ratio };
  };

  // When Core's globe bursts, a burst from the mark's center paints it the same tint.
  const TINT_BURST_SECONDS = 0.8;
  let tintBurst = { start: -1, from: 0, to: 0 };
  onTint((index, isBurst) => {
    tintBurst = isBurst ? { start: null, from: tintBurst.to, to: index } : { start: -1, from: index, to: index };
  });

  function draw(seconds, event) {
    const half = Math.min(width, sceneHeight()) * 0.4;
    if (half < 12 || dragon.points.length === 0) return;
    const centerX = width / 2;
    const centerY = sceneHeight() / 2;
    const loop = seconds % LOOP_SECONDS;
    const spin = seconds * 0.9 + (loop > 2 && loop < 9 ? easeInOut((loop - 2) / 7) * Math.PI * 2 : loop >= 9 ? Math.PI * 2 : 0);
    const tilt = Math.sin(seconds * 0.6) * 0.25;
    const ripple = loop > 9 && loop < 11.5 ? Math.sin(((loop - 9) / 2.5) * Math.PI) : 0;
    const erroring = (event !== null && event.kind === "error" && event.age < ERROR_FLASH_SECONDS)
      || (event !== null && event.kind === "defense" && event.beat === 2);
    const glitching = erroring || (loop > 11.5 && loop < 13.5);
    const forcedGather = hackGather(event);
    const glitchSeed = Math.floor(seconds * 12);
    const scanX = loop > 2 && loop < 9 ? Math.sin(seconds * 2.2) * 0.9 : 9;
    if (tintBurst.start === null) tintBurst.start = seconds;
    const burstAge = tintBurst.start < 0 ? 1 : (seconds - tintBurst.start) / TINT_BURST_SECONDS;
    if (burstAge >= 1) tintBurst.start = -1;
    const bursting = burstAge < 1;
    const front = bursting ? 1.15 * (1 - Math.pow(1 - burstAge, 2)) : 9;
    // Events recolor the whole scene, so the mark shows the theme's own look under them.
    const tintList = tints();
    const oldTint = event === null ? tintList[bursting ? tintBurst.from : tintBurst.to] : tintList[0];
    const newTint = event === null ? tintList[tintBurst.to] : tintList[0];

    dragon.points.forEach((point) => {
      const assemble = easeInOut(clamp01((loop / 2 - point.delay) / (1 - point.delay)));
      const explode = easeInOut(clamp01(((loop - 13.5) / 2.5 - point.delay) / (1 - point.delay)));
      const spread = defenseSpread(event, point, seconds);
      const gather = spread >= 0 ? spread : forcedGather >= 0 ? forcedGather : loop < 2 ? 1 - assemble : explode;
      const [hx, hy, hz] = point.home;
      let x = hx + (point.scatter[0] - hx) * gather;
      const y = hy + (point.scatter[1] - hy) * gather;
      const z = hz + (point.scatter[2] - hz) * gather + ripple * 0.35 * Math.sin(point.row * 0.35 - seconds * 8);
      let glitchRow = false;
      if (glitching) {
        const band = Math.floor(point.row / 6);
        glitchRow = Math.sin(band * 91.7 + glitchSeed * 13.3) > (erroring ? 0 : 0.55);
        if (glitchRow) x += Math.sin(band * 7.1 + glitchSeed) * (erroring ? 0.5 : 0.25);
      }
      const [rx, ry, rz] = rotate([x, y, z], spin, tilt);
      const perspective = 3 / (3 - rz);
      const screenX = centerX + rx * half * perspective;
      const screenY = centerY - ry * half * perspective;
      const fromCenter = Math.hypot(rx, ry);
      const onFront = bursting && Math.abs(fromCenter - front) < 0.08;
      const tint = !bursting || fromCenter < front ? newTint : oldTint;
      const lit = glitchRow || onFront || Math.abs(rx - scanX) < 0.05;
      context.fillStyle = lit ? (onFront ? newTint.ring : tint.ring) : point.kind === "side" ? tint.line : tint.dot;
      context.globalAlpha = depthAlpha(rz, point.kind === "side" ? 0.7 : 1, 0.15) * (glitchRow && Math.random() < 0.3 ? 0.2 : 1);
      const dot = (point.kind === "side" ? 1.4 : 1.8) * perspective;
      context.fillRect(screenX - dot / 2, screenY - dot / 2, dot, dot);
    });

    stageLabel.textContent = STAGES.find(([end]) => loop < end)[1];
    clockLabel.textContent = "t+" + loop.toFixed(2).padStart(5, "0");
  }

  // Djaunt's half of each bit. ERROR shows here on odd beats and in the Core view on even ones. During HACK, Djaunt
  // decrypts, then slams the big line that Core answers. During DEFENSE, Djaunt shouts the alert and the blocking
  // line, counts the shield up while Core shouts, then slams the win line that Core answers.
  const DJAUNT_ERROR_BEAT = 1;
  function drawEvent(seconds, event) {
    drawDjauntEvent(seconds, event);
    if (STRIP_HEIGHT > 0) drawTicker(seconds, event, height - STRIP_HEIGHT, STRIP_HEIGHT);
  }

  function drawDjauntEvent(seconds, event) {
    if (event === null) return;
    const light = shade(rgbOf(palette.matrix), 1.6);
    if (event.kind === "error" && event.age < ERROR_FLASH_SECONDS) {
      if (errorBeatShows(event, DJAUNT_ERROR_BEAT)) drawBigText("ERROR", palette.alert, aboveStrip());
      stageLabel.textContent = "fault";
      clockLabel.textContent = "err " + Math.floor(Math.random() * 0xffff).toString(16).toUpperCase().padStart(4, "0");
    } else if (event.kind === "error") {
      drawBigText("REBOOTING" + ".".repeat(1 + Math.floor(event.age * 6) % 3), palette.dim, aboveStrip({ maxHeight: 0.12, alpha: event.strength }));
      stageLabel.textContent = "reboot";
    } else if (event.kind === "defense") {
      const percent = defensePercent(event);
      if (event.beat === 0) {
        if (Math.floor(event.age * 6) % 3 !== 2) drawBigText(event.lines[0], palette.alert, aboveStrip({ maxHeight: 0.3 }));
        stageLabel.textContent = "alert";
      } else if (event.beat === 1) {
        drawBigText(event.lines[1], palette.warning, aboveStrip({ maxHeight: 0.26 }));
        stageLabel.textContent = "blocking";
      } else if (event.beat === 2) {
        drawBigText(percent + "%", palette.warning, aboveStrip({ maxHeight: 0.5, scale: 1 + 0.06 * Math.sin(event.age * 40) }));
        stageLabel.textContent = "holding";
      } else {
        const slam = clamp01(event.beatAge / 0.15);
        drawBigText(event.lines[3], shade(rgbOf(palette.shield), 1.3), aboveStrip({ scale: 1 + 0.8 * (1 - slam), maxHeight: 0.3, alpha: event.strength }));
        stageLabel.textContent = "secure";
      }
      clockLabel.textContent = "shield " + String(percent).padStart(3, "0") + "%";
    } else if (event.age < HACK_REVEAL_SECONDS) {
      stageLabel.textContent = "decrypting" + (Math.floor(event.age * 4) % 2 === 0 ? "_" : " ");
      clockLabel.textContent = "key " + Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, "0");
    } else {
      const slam = clamp01((event.age - HACK_REVEAL_SECONDS) / 0.15);
      if (slam < 1) tint("#fff", 0.5 * (1 - slam));
      drawBigText(event.phrases[0], light, aboveStrip({ scale: 1 + 0.8 * (1 - slam), maxHeight: 0.3, alpha: event.strength }));
      stageLabel.textContent = "breached";
      clockLabel.textContent = "root";
    }
  }
`;
