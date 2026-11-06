import * as crypto from "crypto";
import type * as vscode from "vscode";
import {
  DEFENSE_BEATS,
  DEFENSE_SCRIPTS,
  ERROR_BEAT_SECONDS,
  ERROR_FLASH_SECONDS,
  EVENT_SECONDS,
  HACK_PHRASES,
  HACK_REVEAL_SECONDS,
} from "./sceneEventSchedule";

// The shared shell for the decorative canvas views. The scene script gets canvas, context, width, height,
// palette, color shading, and the 3D helpers, and must define draw(seconds, event). The loop pauses while the view is
// hidden. A scene event (ERROR, HACK, or DEFENSE, from SceneEventDirector) recolors the palette while it plays, and the scene's
// optional drawEvent(seconds, event) draws its part of the bit on top.
export function resolveDecorativeScene(webviewView: vscode.WebviewView, title: string, readoutsHtml: string, sceneScript: string): void {
  webviewView.webview.options = { enableScripts: true, localResourceRoots: [] };
  webviewView.webview.html = sceneHtml(crypto.randomBytes(16).toString("base64"), title, readoutsHtml, sceneScript);
}

function sceneHtml(nonce: string, title: string, readoutsHtml: string, sceneScript: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style nonce="${nonce}">
  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: var(--vscode-sideBar-background); }
  canvas { display: block; width: 100%; height: 100%; }
  .readout {
    position: absolute;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 10px;
    line-height: 14px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-variant-numeric: tabular-nums;
    color: var(--vscode-descriptionForeground);
    pointer-events: none;
    white-space: pre;
  }
  .top { top: 8px; } .bottom { bottom: 8px; } .above-strip { bottom: 30px; } .left { left: 8px; } .right { right: 8px; text-align: right; }
  .live { color: var(--vscode-textLink-foreground); }
</style>
</head>
<body>
<canvas id="scene"></canvas>
${readoutsHtml}
<script nonce="${nonce}">
(() => {
  const canvas = document.getElementById("scene");
  const context = canvas.getContext("2d");

  let palette = readPalette();
  new MutationObserver(() => { palette = readPalette(); })
    .observe(document.body, { attributes: true, attributeFilter: ["class"] });

  function readPalette() {
    const style = getComputedStyle(document.documentElement);
    const pick = (fallback, ...names) => names.map((name) => style.getPropertyValue(name).trim()).find(Boolean) || fallback;
    return {
      primary: pick("#888", "--vscode-textLink-foreground", "--vscode-focusBorder"),
      accent: pick("#888", "--vscode-overseer-sessionWorking", "--vscode-charts-orange", "--vscode-textLink-activeForeground"),
      dim: pick("#888", "--vscode-descriptionForeground", "--vscode-foreground"),
      fire: [pick("#F0C24B", "--vscode-charts-yellow"), pick("#E08A55", "--vscode-charts-orange"), pick("#E0624A", "--vscode-charts-red")],
      dragon: pick("#9A72E0", "--vscode-charts-purple"),
      scales: pick("#5FC27E", "--vscode-charts-green"),
      ice: [pick("#EAF6FF"), pick("#8FD0F5", "--vscode-terminal-ansiBrightCyan"), pick("#4E9BE0", "--vscode-charts-blue")],
      alert: pick("#F14C4C", "--vscode-errorForeground", "--vscode-charts-red"),
      warning: pick("#E8A33D", "--vscode-editorWarning-foreground", "--vscode-charts-orange"),
      shield: pick("#4FC3F7", "--vscode-charts-blue", "--vscode-terminal-ansiBrightBlue"),
      matrix: pick("#3DDC6A", "--vscode-terminal-ansiBrightGreen", "--vscode-terminal-ansiGreen", "--vscode-charts-green"),
    };
  }

  let width = 0, height = 0;
  new ResizeObserver(() => {
    const scale = window.devicePixelRatio || 1;
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    context.setTransform(scale, 0, 0, scale, 0, 0);
  }).observe(canvas);

  function rotate([x, y, z], spin, tilt) {
    const x1 = x * Math.cos(spin) + z * Math.sin(spin);
    const z1 = -x * Math.sin(spin) + z * Math.cos(spin);
    const y2 = y * Math.cos(tilt) - z1 * Math.sin(tilt);
    const z2 = y * Math.sin(tilt) + z1 * Math.cos(tilt);
    return [x1, y2, z2];
  }

  function depthAlpha(z, near, far) {
    return far + (near - far) * ((z + 1) / 2);
  }

  // Reads any CSS color back as numbers through the canvas, so a theme color can be shaded.
  function rgbOf(color) {
    context.fillStyle = color;
    const normalized = context.fillStyle;
    if (normalized.startsWith("#")) return [1, 3, 5].map((start) => parseInt(normalized.slice(start, start + 2), 16));
    return (normalized.match(/[0-9.]+/g) || ["136", "136", "136"]).slice(0, 3).map(Number);
  }
  const shade = ([red, green, blue], factor) => "rgb(" + [red, green, blue].map((channel) => Math.round(Math.min(255, channel * factor))).join(",") + ")";

  const easeInOut = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const clamp01 = (t) => Math.max(0, Math.min(1, t));

  const HACK_PHRASES = ${JSON.stringify(HACK_PHRASES)};
  const DEFENSE_SCRIPTS = ${JSON.stringify(DEFENSE_SCRIPTS)};
  const EVENT_SECONDS = ${JSON.stringify(EVENT_SECONDS)};
  const ERROR_FLASH_SECONDS = ${ERROR_FLASH_SECONDS};
  const ERROR_BEAT_SECONDS = ${ERROR_BEAT_SECONDS};
  const HACK_REVEAL_SECONDS = ${HACK_REVEAL_SECONDS};
  // DEFENSE beats start here: incoming, blocking, almost there, safe.
  const DEFENSE_BEATS = ${JSON.stringify(DEFENSE_BEATS)};
  const MATRIX_GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜ0123456789";
  const MATRIX_CELL = 12;
  const fontFamily = [getComputedStyle(document.documentElement).getPropertyValue("--vscode-editor-font-family").trim(), "monospace"].filter(Boolean).join(", ");

  // Every view gets the same message at the same moment, then keeps time from its next frame. A hidden view skips it.
  let sceneEvent = null;
  window.addEventListener("message", (message) => {
    const data = message.data;
    if (document.hidden || !data || data.type !== "sceneEvent" || !(data.kind in EVENT_SECONDS)) return;
    sceneEvent = { kind: data.kind, variant: Number(data.variant) || 0, start: null };
  });

  // The playing event, or null once it has run its length. Strength ramps the recolor in and out.
  function currentEvent(seconds) {
    if (sceneEvent === null) return null;
    if (sceneEvent.start === null) sceneEvent.start = seconds;
    const age = Math.max(0, seconds - sceneEvent.start);
    const duration = EVENT_SECONDS[sceneEvent.kind];
    if (age >= duration) { sceneEvent = null; return null; }
    const strength = sceneEvent.kind === "error"
      ? 1 - clamp01((age - ERROR_FLASH_SECONDS) / (duration - ERROR_FLASH_SECONDS))
      : clamp01(Math.min(age / 0.4, (duration - age) / 0.7));
    const beat = sceneEvent.kind === "defense" ? DEFENSE_BEATS.filter((beatStart) => age >= beatStart).length - 1 : 0;
    return {
      kind: sceneEvent.kind, start: sceneEvent.start, age, duration, strength, beat,
      beatAge: sceneEvent.kind === "defense" ? age - DEFENSE_BEATS[beat] : age,
      phrases: HACK_PHRASES[sceneEvent.variant % HACK_PHRASES.length],
      lines: DEFENSE_SCRIPTS[sceneEvent.variant % DEFENSE_SCRIPTS.length],
    };
  }

  // The DEFENSE countermeasures percent, the same in both views: it climbs while blocking, then sticks near the top.
  function defensePercent(event) {
    if (event.beat === 0) return 0;
    if (event.beat === 3) return 100;
    if (event.beat === 1) return Math.floor(easeInOut(clamp01(event.beatAge / 2)) * 72);
    const progress = clamp01(event.beatAge / 1.6);
    return Math.min(99, Math.floor(72 + 27 * Math.sqrt(progress) + Math.sin(event.age * 31) * 2 * (1 - progress)));
  }

  // Which of the two views shows ERROR on this beat, so the word bounces between them.
  const errorBeatShows = (event, beat) => event.age < ERROR_FLASH_SECONDS && Math.floor(event.age / ERROR_BEAT_SECONDS) % 2 === beat;

  function mix(from, to, amount) {
    const start = rgbOf(from), end = rgbOf(to);
    return "rgb(" + start.map((channel, index) => Math.round(channel + (end[index] - channel) * amount)).join(",") + ")";
  }

  // The spectrum Core's sweep repaints the globe with, shared so the Djaunt view matches. Tint 0 is the theme's own
  // look. The rest run red to purple from the theme's chart colors.
  let tintCache = { palette: null, list: [] };
  function tints() {
    if (tintCache.palette === palette) return tintCache.list;
    const hues = [palette.primary, palette.fire[2], palette.fire[1], palette.fire[0], palette.scales, palette.ice[1], palette.shield, palette.dragon];
    const list = hues.map((hue, index) => ({
      dot: hue,
      line: index === 0 ? palette.dim : mix(palette.dim, hue, 0.6),
      ring: index === 0 ? palette.accent : shade(rgbOf(hue), 1.35),
    }));
    tintCache = { palette, list };
    return list;
  }

  // A tint message: { index, burst }. A burst paints it in, otherwise it shows at once. The extension relays Core's
  // bursts and answers "ready" with the current tint.
  const extension = acquireVsCodeApi();
  const tintListeners = [];
  const onTint = (listener) => tintListeners.push(listener);
  window.addEventListener("message", (message) => {
    const data = message.data;
    if (!data || data.type !== "tint" || !Number.isInteger(data.index)) return;
    const index = ((data.index % tints().length) + tints().length) % tints().length;
    tintListeners.forEach((listener) => listener(index, data.burst === true && !document.hidden));
  });

  // DEFENSE goes red on the alert, amber while the shield holds, then shield blue once safe.
  function eventColor(base, event) {
    if (event.kind === "error") return base.alert;
    if (event.kind === "hack") return base.matrix;
    if (event.beat === 0) return base.alert;
    return event.beat < 3 ? base.warning : base.shield;
  }

  // ERROR turns every scene color red, HACK turns it matrix green, DEFENSE follows its beat.
  function eventPalette(base, event) {
    const target = rgbOf(eventColor(base, event));
    const amount = event.kind === "defense" ? event.strength * 0.8 : event.strength;
    const toward = (color, factor) => mix(color, shade(target, factor), amount);
    return {
      ...base,
      primary: toward(base.primary, 1),
      accent: toward(base.accent, 1.5),
      dim: toward(base.dim, 0.6),
      dragon: toward(base.dragon, 0.85),
      scales: toward(base.scales, 1.3),
      fire: base.fire.map((color, index) => toward(color, 1.4 - index * 0.25)),
      ice: base.ice.map((color, index) => toward(color, 1.4 - index * 0.25)),
    };
  }

  const glyphNoise = (value) => { const wave = Math.sin(value) * 43758.5453; return wave - Math.floor(wave); };

  // Matrix rain over the whole view: one falling column per cell, a bright head, and a fading trail.
  function drawMatrix(seconds, strength) {
    const columns = Math.ceil(width / MATRIX_CELL), rows = Math.ceil(height / MATRIX_CELL);
    context.globalAlpha = 0.9 * strength;
    context.fillStyle = "#020803";
    context.fillRect(0, 0, width, height);
    context.font = "bold " + (MATRIX_CELL - 1) + "px " + fontFamily;
    context.textAlign = "center";
    context.textBaseline = "top";
    const head = shade(rgbOf(palette.matrix), 1.8);
    for (let column = 0; column < columns; column++) {
      const speed = 8 + glyphNoise(column * 12.99) * 14;
      const trail = 6 + Math.floor(glyphNoise(column * 78.23) * 14);
      const cycle = rows + trail;
      const headRow = Math.floor((seconds * speed + glyphNoise(column * 3.71) * cycle) % cycle);
      for (let step = 0; step < trail; step++) {
        const row = headRow - step;
        if (row < 0 || row >= rows) continue;
        const glyph = MATRIX_GLYPHS[Math.floor(glyphNoise(column * 7.13 + row * 3.31 + Math.floor(seconds * 6 + column)) * MATRIX_GLYPHS.length)];
        context.globalAlpha = strength * (step === 0 ? 1 : 0.75 * (1 - step / trail));
        context.fillStyle = step === 0 ? head : palette.matrix;
        context.fillText(glyph, column * MATRIX_CELL + MATRIX_CELL / 2, row * MATRIX_CELL);
      }
    }
    context.globalAlpha = 1;
  }

  // Big centered words on a dark band, as large as the view allows. A long phrase in a narrow view breaks in two.
  function drawBigText(text, color, options) {
    const { scale = 1, centerY = 0.5, maxHeight = 0.3, alpha = 1 } = options || {};
    context.save();
    context.font = "bold 100px " + fontFamily;
    const fitted = (line) => Math.min(height * maxHeight, (width * 0.88 / context.measureText(line).width) * 100);
    let lines = [text];
    const middle = text.indexOf(" ", Math.floor(text.length / 2) - 3);
    if (middle > 0 && fitted(text) < height * maxHeight * 0.55) lines = [text.slice(0, middle), text.slice(middle + 1)];
    const size = Math.min(...lines.map(fitted), height * maxHeight / lines.length * 1.4) * scale;
    const lineHeight = size * 1.05;
    const top = height * centerY - (lineHeight * (lines.length - 1)) / 2;
    context.globalAlpha = 0.6 * alpha;
    context.fillStyle = "#000";
    context.fillRect(0, top - size * 0.75, width, lineHeight * (lines.length - 1) + size * 1.5);
    context.globalAlpha = alpha;
    context.font = "bold " + size + "px " + fontFamily;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.shadowColor = color;
    context.shadowBlur = size * 0.4;
    context.fillStyle = color;
    lines.forEach((line, index) => context.fillText(line, width / 2, top + index * lineHeight));
    context.restore();
  }

  function tint(color, alpha) {
    context.globalAlpha = alpha;
    context.fillStyle = color;
    context.fillRect(0, 0, width, height);
    context.globalAlpha = 1;
  }

  // Copies a few thin strips of the finished frame sideways, in device pixels.
  function glitchSlices(count, maxShift) {
    const scale = canvas.width / width;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    for (let slice = 0; slice < count; slice++) {
      const sliceY = Math.random() * canvas.height;
      const sliceHeight = (2 + Math.random() * 14) * scale;
      context.drawImage(canvas, 0, sliceY, canvas.width, sliceHeight, (Math.random() - 0.5) * 2 * maxShift * scale, sliceY, canvas.width, sliceHeight);
    }
    context.restore();
  }

${sceneScript}
  extension.postMessage({ type: "ready" });

  let frame = 0;
  function loop(now) {
    frame = requestAnimationFrame(loop);
    context.clearRect(0, 0, width, height);
    if (width > 0 && height > 0) {
      const seconds = now / 1000;
      const event = currentEvent(seconds);
      const basePalette = palette;
      context.save();
      if (event !== null && event.kind === "hack") drawMatrix(seconds, event.strength);
      const shake = event === null ? 0
        : event.kind === "error" ? (event.age < ERROR_FLASH_SECONDS ? 3 : 0)
        : event.kind === "defense" ? [0.8, 1.5, 2 + 3 * clamp01(event.beatAge / 1.6), Math.max(0, 4 - event.beatAge * 12)][event.beat]
        : 0;
      if (shake > 0) context.translate((Math.random() - 0.5) * 2 * shake, (Math.random() - 0.5) * 1.4 * shake);
      if (event !== null) palette = eventPalette(basePalette, event);
      draw(seconds, event);
      palette = basePalette;
      context.restore();
      context.globalAlpha = 1;
      if (event !== null && event.kind === "error") {
        tint(palette.alert, 0.14 * event.strength);
        if (event.age < ERROR_FLASH_SECONDS) glitchSlices(5, 18);
      }
      if (event !== null && event.kind === "defense") {
        if (event.beat === 0) tint(palette.alert, (0.06 + 0.1 * (0.5 + 0.5 * Math.sin(event.age * 14))) * event.strength);
        if (event.beat === 2) glitchSlices(2, 6 + 10 * clamp01(event.beatAge / 1.6));
        if (event.beat === 3 && event.beatAge < 0.5) tint(palette.shield, 0.4 * (1 - event.beatAge / 0.5));
      }
      if (typeof drawEvent === "function") drawEvent(seconds, event);
    }
    context.globalAlpha = 1;
  }
  document.addEventListener("visibilitychange", () => {
    cancelAnimationFrame(frame);
    if (!document.hidden) frame = requestAnimationFrame(loop);
  });
  frame = requestAnimationFrame(loop);
})();
</script>
</body>
</html>`;
}
