import * as crypto from "crypto";
import * as vscode from "vscode";

export const CORE_PANEL_VIEW_ID = "overseer.core";

// Decorative only: a spinning lattice globe with fake telemetry. It reads nothing and does nothing.
export class CorePanelProvider implements vscode.WebviewViewProvider {
  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [] };
    webviewView.webview.html = panelHtml(crypto.randomBytes(16).toString("base64"));
  }
}

function panelHtml(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Core</title>
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
  .top { top: 8px; } .bottom { bottom: 8px; } .left { left: 8px; } .right { right: 8px; text-align: right; }
  .live { color: var(--vscode-textLink-foreground); }
</style>
</head>
<body>
<canvas id="core"></canvas>
<div class="readout top left"><span class="live">core</span> // <span id="phase">online</span></div>
<div class="readout top right" id="sync"></div>
<div class="readout bottom left" id="angles"></div>
<div class="readout bottom right" id="hex"></div>
<script nonce="${nonce}">
(() => {
  const canvas = document.getElementById("core");
  const context = canvas.getContext("2d");
  const phaseLabel = document.getElementById("phase");
  const syncLabel = document.getElementById("sync");
  const anglesLabel = document.getElementById("angles");
  const hexLabel = document.getElementById("hex");

  const NODE_COUNT = 240;
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
  const nodes = Array.from({ length: NODE_COUNT }, (_, index) => {
    const y = 1 - (2 * (index + 0.5)) / NODE_COUNT;
    const ring = Math.sqrt(1 - y * y);
    const theta = GOLDEN_ANGLE * index;
    return [Math.cos(theta) * ring, y, Math.sin(theta) * ring];
  });
  const PHASES = ["online", "syncing", "indexing", "resolving", "aligning", "nominal"];

  let palette = readPalette();
  new MutationObserver(() => { palette = readPalette(); })
    .observe(document.body, { attributes: true, attributeFilter: ["class"] });

  function readPalette() {
    const style = getComputedStyle(document.documentElement);
    const pick = (...names) => names.map((name) => style.getPropertyValue(name).trim()).find(Boolean) || "#888";
    return {
      primary: pick("--vscode-textLink-foreground", "--vscode-focusBorder"),
      accent: pick("--vscode-overseer-sessionWorking", "--vscode-charts-orange", "--vscode-textLink-activeForeground"),
      dim: pick("--vscode-descriptionForeground", "--vscode-foreground"),
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

  function project([x, y, z], radius) {
    const perspective = 3 / (3 - z);
    return [width / 2 + x * radius * perspective, height / 2 - y * radius * perspective, z];
  }

  function depthAlpha(z, near, far) {
    return far + (near - far) * ((z + 1) / 2);
  }

  function strokePath(points, spin, tilt, radius, color, lineWidth, near, far) {
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    for (let index = 1; index < points.length; index++) {
      const [ax, ay, az] = project(rotate(points[index - 1], spin, tilt), radius);
      const [bx, by, bz] = project(rotate(points[index], spin, tilt), radius);
      context.globalAlpha = depthAlpha((az + bz) / 2, near, far);
      context.beginPath();
      context.moveTo(ax, ay);
      context.lineTo(bx, by);
      context.stroke();
    }
  }

  function circle(segments, pointAt) {
    return Array.from({ length: segments + 1 }, (_, index) => pointAt((index / segments) * Math.PI * 2));
  }

  const meridians = Array.from({ length: 6 }, (_, index) => {
    const longitude = (index / 6) * Math.PI;
    return circle(48, (angle) => [Math.cos(angle) * Math.cos(longitude), Math.sin(angle), Math.cos(angle) * Math.sin(longitude)]);
  });
  const parallels = [-0.66, -0.33, 0, 0.33, 0.66].map((y) => {
    const ring = Math.sqrt(1 - y * y);
    return circle(48, (angle) => [Math.cos(angle) * ring, y, Math.sin(angle) * ring]);
  });
  const orbit = circle(64, (angle) => [Math.cos(angle) * 1.32, Math.sin(angle) * 0.3, Math.sin(angle) * 1.28]);

  function slerpLifted(from, to, t) {
    const dot = Math.max(-1, Math.min(1, from[0] * to[0] + from[1] * to[1] + from[2] * to[2]));
    const omega = Math.acos(dot) || 1e-6;
    const a = Math.sin((1 - t) * omega) / Math.sin(omega);
    const b = Math.sin(t * omega) / Math.sin(omega);
    const lift = 1 + 0.18 * Math.sin(Math.PI * t);
    return [0, 1, 2].map((axis) => (from[axis] * a + to[axis] * b) * lift);
  }

  const arcs = [];
  let nextArcAt = 0;
  let lastReadoutAt = 0;
  let phaseIndex = 0;
  let frame = 0;

  function draw(now) {
    frame = requestAnimationFrame(draw);
    const seconds = now / 1000;
    const spin = seconds * 0.35;
    const tilt = 0.45 + Math.sin(seconds * 0.4) * 0.15;
    const radius = Math.min(width, height) * 0.36;
    context.clearRect(0, 0, width, height);
    if (radius <= 0) return;

    meridians.concat(parallels).forEach((path) => strokePath(path, spin, tilt, radius, palette.dim, 1, 0.35, 0.06));

    const scanY = Math.sin(seconds * (Math.PI / 2)) * 0.95;
    const scanRing = Math.sqrt(1 - scanY * scanY);
    strokePath(circle(64, (angle) => [Math.cos(angle) * scanRing, scanY, Math.sin(angle) * scanRing]), spin, tilt, radius, palette.accent, 1.5, 0.9, 0.2);

    nodes.forEach((node) => {
      const [x, y, z] = project(rotate(node, spin, tilt), radius);
      const nearScan = Math.abs(node[1] - scanY) < 0.06;
      context.globalAlpha = depthAlpha(z, nearScan ? 1 : 0.85, 0.12);
      context.fillStyle = nearScan ? palette.accent : palette.primary;
      const size = (nearScan ? 2.4 : 1.6) * (3 / (3 - z));
      context.fillRect(x - size / 2, y - size / 2, size, size);
    });

    if (seconds >= nextArcAt) {
      const from = nodes[Math.floor(Math.random() * NODE_COUNT)];
      const to = nodes[Math.floor(Math.random() * NODE_COUNT)];
      arcs.push({ from, to, born: seconds });
      nextArcAt = seconds + 0.4 + Math.random() * 0.6;
    }
    for (let index = arcs.length - 1; index >= 0; index--) {
      const age = (seconds - arcs[index].born) / 1.4;
      if (age >= 1) { arcs.splice(index, 1); continue; }
      const head = Math.min(1, age * 2);
      const tail = Math.max(0, age * 2 - 1);
      const steps = 24;
      const path = Array.from({ length: steps + 1 }, (_, step) => slerpLifted(arcs[index].from, arcs[index].to, tail + (head - tail) * (step / steps)));
      strokePath(path, spin, tilt, radius, palette.primary, 1.25, 0.95, 0.15);
    }

    strokePath(orbit, spin * 0.6, tilt + 0.5, radius, palette.dim, 1, 0.4, 0.08);
    const satelliteAngle = seconds * 1.1;
    const [sx, sy, sz] = project(rotate([Math.cos(satelliteAngle) * 1.32, Math.sin(satelliteAngle) * 0.3, Math.sin(satelliteAngle) * 1.28], spin * 0.6, tilt + 0.5), radius);
    context.globalAlpha = depthAlpha(sz, 1, 0.3);
    context.strokeStyle = palette.accent;
    context.lineWidth = 1;
    context.strokeRect(sx - 3, sy - 3, 6, 6);
    context.globalAlpha = 1;

    if (seconds - lastReadoutAt > 0.125) {
      lastReadoutAt = seconds;
      const degrees = (value) => ((value * 180 / Math.PI) % 360 + 360) % 360;
      syncLabel.textContent = "sync " + (97 + Math.sin(seconds * 0.7) * 2 + Math.random() * 0.5).toFixed(2) + "%\\nlinks " + String(arcs.length).padStart(2, "0");
      anglesLabel.textContent = "θ " + degrees(spin).toFixed(1).padStart(5, "0") + "°  φ " + degrees(tilt).toFixed(1).padStart(4, "0") + "°";
      hexLabel.textContent = "0x" + Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, "0");
      if (Math.random() < 0.02) {
        phaseIndex = (phaseIndex + 1) % PHASES.length;
        phaseLabel.textContent = PHASES[phaseIndex];
      }
    }
  }

  document.addEventListener("visibilitychange", () => {
    cancelAnimationFrame(frame);
    if (!document.hidden) frame = requestAnimationFrame(draw);
  });
  frame = requestAnimationFrame(draw);
})();
</script>
</body>
</html>`;
}
