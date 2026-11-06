import type * as vscode from "vscode";
import { resolveDecorativeScene } from "./decorativeScene";
import { CREATURES_SCRIPT } from "./flyingCreatures";
import { ORBIT_LOGOS } from "./orbitLogos";
import type { SceneEventDirector } from "./sceneEvents";

export const CORE_PANEL_VIEW_ID = "overseer.core";

// Decorative only: a spinning lattice globe, solid logos (logos/) orbiting it, creatures that fly past now and
// then, fake telemetry, and its half of the ERROR, HACK, and DEFENSE bits. It reads nothing and does nothing.
export class CorePanelProvider implements vscode.WebviewViewProvider {
  constructor(private readonly sceneEvents: SceneEventDirector) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    resolveDecorativeScene(webviewView, "Core", READOUTS, GLOBE_SCRIPT + CREATURES_SCRIPT);
    this.sceneEvents.attach(webviewView);
  }
}

const READOUTS = `<div class="readout top left"><span class="live">core</span> // <span id="phase">online</span></div>
<div class="readout top right" id="sync"></div>
<div class="readout bottom left" id="angles"></div>
<div class="readout bottom right" id="hex"></div>`;

const GLOBE_SCRIPT = `
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

  function project([x, y, z], radius) {
    const perspective = 3 / (3 - z);
    return [width / 2 + x * radius * perspective, height / 2 - y * radius * perspective, z];
  }

  function strokePath(points, spin, tilt, radius, color, lineWidth, near, far) {
    context.strokeStyle = typeof color === "function" ? color(points[0][1]) : color;
    context.lineWidth = lineWidth;
    for (let index = 1; index < points.length; index++) {
      if (typeof color === "function") context.strokeStyle = color((points[index - 1][1] + points[index][1]) / 2);
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

  // Every so often the scan ring sweeps the globe once and repaints it, as it passes, the next color of a spectrum.
  const SWEEP_SECONDS = 2.8;
  let sweep = { start: -1, from: 0, to: 0, downward: false };
  let nextSweepAt = 6;
  let tintIndex = 0;

  // When a sweep ends the globe bursts. The shock ring recolors each logo as it passes, and the Djaunt view bursts too.
  const BURST_SECONDS = 0.8;
  let shock = { start: -1, sparks: [] };
  let logoTint = 0;
  let logoTintAt = () => tints()[0];
  onTint((index) => {
    if (sweep.start >= 0 || shock.start >= 0) return;
    tintIndex = index;
    logoTint = index;
  });

  const LOGOS = ${JSON.stringify(ORBIT_LOGOS)};
  const LOGO_SIZE = 0.55;
  const LOGO_THICKNESS = 0.12;
  const LIGHT = [-0.35, 0.55, 0.76].map((component, _, vector) => component / Math.hypot(...vector));
  // Each logo becomes a cap shape plus one wall quad per outline edge. A wall's normal points out of its edge.
  const logoSolids = LOGOS.map((logo) => {
    const cap = new Path2D();
    const walls = [];
    logo.contours.forEach((flat) => {
      const count = flat.length / 2;
      for (let point = 0; point < count; point++) {
        const fromX = flat[point * 2], fromY = flat[point * 2 + 1];
        const following = (point + 1) % count;
        const toX = flat[following * 2], toY = flat[following * 2 + 1];
        if (point === 0) cap.moveTo(fromX, fromY); else cap.lineTo(fromX, fromY);
        const length = Math.hypot(toX - fromX, toY - fromY) || 1;
        walls.push({ fromX, fromY, toX, toY, normalX: (toY - fromY) / length, normalY: (fromX - toX) / length });
      }
      cap.closePath();
    });
    return { cap, fillRule: logo.fillRule, walls };
  });
  const copiesPerLogo = logoSolids.length === 1 ? 2 : 1;
  const flyerCount = logoSolids.length * copiesPerLogo;
  const flyers = logoSolids.flatMap((logo, index) => Array.from({ length: copiesPerLogo }, (_, copy) => {
    const slot = index * copiesPerLogo + copy;
    const spread = (factor) => (slot * factor) % 1;
    return {
      logo,
      phase: (slot / flyerCount) * Math.PI * 2,
      node: spread(0.618) * Math.PI * 2,
      inclination: -0.6 + spread(0.414) * 1.2,
      orbitRadius: 1.5 + spread(0.37) * 0.25,
      speed: (0.4 + spread(0.73) * 0.2) * (slot % 2 === 0 ? 1 : -1),
      tumble: 0.7 + spread(0.29) * 0.6,
    };
  }));

  // The DEFENSE shield: a lattice shell, every edge between near neighbors on a sphere. It builds from the bottom up.
  const SHIELD_RADIUS = 1.16;
  const shieldNodes = Array.from({ length: 80 }, (_, index) => {
    const y = 1 - (2 * (index + 0.5)) / 80;
    const ring = Math.sqrt(1 - y * y);
    return [Math.cos(GOLDEN_ANGLE * index) * ring, y, Math.sin(GOLDEN_ANGLE * index) * ring];
  });
  const shieldEdges = [];
  shieldNodes.forEach((from, fromIndex) => shieldNodes.slice(fromIndex + 1).forEach((to) => {
    if (Math.hypot(from[0] - to[0], from[1] - to[1], from[2] - to[2]) < 0.48) shieldEdges.push([from, to]);
  }));
  shieldEdges.sort((first, second) => Math.min(first[0][1], first[1][1]) - Math.min(second[0][1], second[1][1]));

  const dot = (first, second) => first[0] * second[0] + first[1] * second[1] + first[2] * second[2];

  function placeFlyer(flyer, seconds, tilt) {
    const angle = flyer.phase + seconds * flyer.speed;
    const onPlane = [Math.cos(angle) * flyer.orbitRadius, 0, Math.sin(angle) * flyer.orbitRadius];
    const center = rotate(rotate(rotate(onPlane, 0, flyer.inclination), flyer.node, 0), 0, tilt);
    const yaw = seconds * flyer.tumble + flyer.phase;
    const pitch = Math.sin(seconds * 0.7 + flyer.phase) * 0.6;
    const [across, up, normal] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((axis) => rotate(axis, yaw, pitch));
    return { flyer, center, across, up, normal };
  }

  // An opaque extruded solid, painter's order: walls far to near, then the cap that faces the viewer. Every face is
  // lit by its angle to one light. Logo x runs along across, logo y (down) along -up, depth along normal.
  function drawSolid({ flyer, center, across, up, normal }, radius) {
    const perspective = 3 / (3 - center[2]);
    const scale = radius * LOGO_SIZE * perspective;
    const originX = width / 2 + center[0] * radius * perspective;
    const originY = height / 2 - center[1] * radius * perspective;
    const screenX = (x, y, z) => originX + scale * (x * across[0] - y * up[0] + z * normal[0]);
    const screenY = (x, y, z) => originY - scale * (x * across[1] - y * up[1] + z * normal[1]);
    const base = rgbOf(logoTintAt(Math.hypot(originX - width / 2, originY - height / 2)).dot);
    const distance = 0.7 + 0.3 * clamp01((center[2] / flyer.orbitRadius + 1) / 2);
    const half = LOGO_THICKNESS / 2;
    const nearZ = normal[2] >= 0 ? half : -half;
    context.globalAlpha = 1;
    context.lineWidth = 1;
    context.lineJoin = "round";

    flyer.logo.walls
      .map((wall) => {
        const outward = [0, 1, 2].map((axis) => wall.normalX * across[axis] - wall.normalY * up[axis]);
        const middleX = (wall.fromX + wall.toX) / 2, middleY = (wall.fromY + wall.toY) / 2;
        return { wall, depth: middleX * across[2] - middleY * up[2], light: Math.abs(dot(outward, LIGHT)) };
      })
      .sort((first, second) => first.depth - second.depth)
      .forEach(({ wall, light }) => {
        const color = shade(base, distance * (0.2 + 0.5 * light));
        context.fillStyle = color;
        context.strokeStyle = color;
        context.beginPath();
        context.moveTo(screenX(wall.fromX, wall.fromY, half), screenY(wall.fromX, wall.fromY, half));
        context.lineTo(screenX(wall.toX, wall.toY, half), screenY(wall.toX, wall.toY, half));
        context.lineTo(screenX(wall.toX, wall.toY, -half), screenY(wall.toX, wall.toY, -half));
        context.lineTo(screenX(wall.fromX, wall.fromY, -half), screenY(wall.fromX, wall.fromY, -half));
        context.closePath();
        context.fill();
        context.stroke();
      });

    context.save();
    context.transform(scale * across[0], -scale * across[1], -scale * up[0], scale * up[1],
      originX + scale * nearZ * normal[0], originY - scale * nearZ * normal[1]);
    context.fillStyle = shade(base, distance * (0.5 + 0.5 * Math.abs(dot(normal, LIGHT))));
    context.fill(flyer.logo.cap, flyer.logo.fillRule);
    context.strokeStyle = palette.accent;
    context.globalAlpha = 0.45;
    context.lineWidth = 1 / scale;
    context.stroke(flyer.logo.cap);
    context.restore();
  }

  // One event's moving parts: where the HACK infection starts, and the DEFENSE packets, sparks, and impact rings.
  let eventState = { start: null, origin: nodes[0], packets: [], sparks: [], rings: [], nextPacketAt: 0, lastHitAt: -9, shattered: false };
  let lastDrawSeconds = 0;

  function stateFor(event, seconds) {
    if (event === null || event.start === eventState.start) return eventState;
    eventState = { start: event.start, origin: nodes[Math.floor(Math.random() * NODE_COUNT)], packets: [], sparks: [], rings: [], nextPacketAt: seconds, lastHitAt: -9, shattered: false };
    return eventState;
  }

  function burst(x, y, count, color, speed) {
    for (let index = 0; index < count; index++) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = speed * (0.4 + Math.random() * 0.6);
      eventState.sparks.push({ x, y, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity, life: 0.3 + Math.random() * 0.3, age: 0, color });
    }
  }

  // DEFENSE: hostile packets streak in from past the panel edges. Before the shield is up they hit the globe; after,
  // they burst on the shield. Safe shatters whatever is still in flight.
  function drawDefense(seconds, event, radius, spin, tilt, dt) {
    const state = eventState;
    const centerX = width / 2, centerY = height / 2;
    const shieldUp = event.beat >= 1 && (event.beat > 1 || event.beatAge > 0.4);
    if (event.beat < 3 && seconds >= state.nextPacketAt) {
      const angle = Math.random() * Math.PI * 2;
      const reach = Math.hypot(width, height) * 0.55;
      state.packets.push({ angle, distance: reach, speed: (event.beat === 2 ? 420 : 260) + Math.random() * 140 });
      state.nextPacketAt = seconds + [0.14, 0.09, 0.04][event.beat] * (0.6 + Math.random() * 0.8);
    }
    if (event.beat === 3 && !state.shattered) {
      state.shattered = true;
      state.packets.forEach((packet) => burst(centerX + Math.cos(packet.angle) * packet.distance, centerY + Math.sin(packet.angle) * packet.distance, 10, palette.alert, 220));
      state.packets = [];
      state.rings.push({ x: centerX, y: centerY, born: seconds, reach: Math.hypot(width, height) * 0.6, color: palette.shield });
    }

    const forming = event.beat === 1 ? clamp01(event.beatAge / 0.6) : event.beat >= 2 ? 1 : 0;
    const release = event.beat === 3 ? clamp01(event.beatAge / 1.4) : 0;
    if (forming > 0 && release < 1) {
      const hitGlow = Math.exp(-(seconds - state.lastHitAt) * 10);
      const shown = Math.floor(shieldEdges.length * forming);
      const shellRadius = radius * (SHIELD_RADIUS + release * 0.35);
      const color = event.beat === 3 ? shade(rgbOf(palette.shield), 1.5) : palette.shield;
      const strength = (1 - release) * (event.beat === 3 ? 1 : 0.55 + 0.45 * hitGlow);
      for (let index = 0; index < shown; index++) {
        strokePath(shieldEdges[index], -spin * 0.5, tilt, shellRadius, color, event.beat === 3 ? 2 : 1.25, strength, strength * 0.25);
      }
    }

    const stopAt = shieldUp ? radius * SHIELD_RADIUS * 1.02 : radius * 0.95;
    context.lineCap = "round";
    state.packets = state.packets.filter((packet) => {
      packet.distance -= packet.speed * dt;
      const x = centerX + Math.cos(packet.angle) * packet.distance;
      const y = centerY + Math.sin(packet.angle) * packet.distance;
      if (packet.distance <= stopAt) {
        state.lastHitAt = seconds;
        burst(x, y, shieldUp ? 9 : 5, shieldUp ? palette.shield : palette.alert, shieldUp ? 160 : 90);
        state.rings.push({ x, y, born: seconds, reach: shieldUp ? 22 : 12, color: shieldUp ? palette.shield : palette.alert });
        return false;
      }
      const tailX = x + Math.cos(packet.angle) * 44, tailY = y + Math.sin(packet.angle) * 44;
      const streak = context.createLinearGradient(x, y, tailX, tailY);
      streak.addColorStop(0, palette.alert);
      streak.addColorStop(1, "rgba(0,0,0,0)");
      context.globalAlpha = 1;
      context.strokeStyle = streak;
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(tailX, tailY);
      context.stroke();
      context.fillStyle = "#fff";
      context.fillRect(x - 2, y - 2, 4, 4);
      return true;
    });

    if (event.beat === 0) {
      const pulse = (event.beatAge * 1.6) % 1;
      context.globalAlpha = (1 - pulse) * 0.8;
      context.strokeStyle = palette.alert;
      context.lineWidth = 2;
      context.beginPath();
      context.arc(centerX, centerY, radius * (1 + pulse * 0.5), 0, Math.PI * 2);
      context.stroke();
    }
  }

  function drawSparksAndRings(seconds, dt) {
    const state = eventState;
    state.sparks = state.sparks.filter((spark) => {
      spark.age += dt;
      if (spark.age >= spark.life) return false;
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      context.globalAlpha = 1 - spark.age / spark.life;
      context.fillStyle = spark.age < 0.08 ? "#fff" : spark.color;
      context.fillRect(spark.x - 1.25, spark.y - 1.25, 2.5, 2.5);
      return true;
    });
    state.rings = state.rings.filter((ring) => {
      const age = (seconds - ring.born) / (ring.reach > 100 ? 0.9 : 0.35);
      if (age >= 1) return false;
      context.globalAlpha = 1 - age;
      context.strokeStyle = ring.color;
      context.lineWidth = ring.reach > 100 ? 3 : 1.5;
      context.beginPath();
      context.arc(ring.x, ring.y, ring.reach * easeInOut(age) + 2, 0, Math.PI * 2);
      context.stroke();
      return true;
    });
  }

  function draw(seconds, event) {
    const spin = seconds * 0.35;
    const tilt = 0.45 + Math.sin(seconds * 0.4) * 0.15;
    const radius = Math.min(width, height) * 0.36;
    const dt = Math.min(0.1, Math.max(0, seconds - lastDrawSeconds));
    lastDrawSeconds = seconds;
    const state = stateFor(event, seconds);
    const hacking = event !== null && event.kind === "hack";
    const defending = event !== null && event.kind === "defense";
    // HACK: an infection front spreads over the globe from one node until the reveal, then the globe pulses.
    const infection = hacking ? easeInOut(clamp01(event.age / HACK_REVEAL_SECONDS)) * Math.PI * 1.05 : -1;
    const revealAge = hacking ? event.age - HACK_REVEAL_SECONDS : -1;
    const hitFlicker = defending && event.beat === 0 && seconds - state.lastHitAt < 0.12;
    const hackLight = shade(rgbOf(palette.matrix), 1.7);
    if (event === null && sweep.start < 0 && shock.start < 0 && seconds >= nextSweepAt) {
      sweep = { start: seconds, from: tintIndex, to: (tintIndex + 1) % tints().length, downward: !sweep.downward };
    }
    const sweepAge = sweep.start < 0 ? -1 : (seconds - sweep.start) / SWEEP_SECONDS;
    if (sweepAge >= 1) {
      tintIndex = sweep.to;
      sweep.start = -1;
      nextSweepAt = seconds + 20 + Math.random() * 20;
      shock = { start: seconds, sparks: Array.from({ length: 28 }, () => ({ angle: Math.random() * Math.PI * 2, speed: 0.6 + Math.random() * 0.8 })) };
      extension.postMessage({ type: "tint", index: tintIndex });
    }
    const sweeping = sweep.start >= 0;
    const scanY = sweeping ? (sweep.downward ? 1 : -1) * Math.cos(Math.PI * sweepAge) * 0.98 : 2;
    const burstAge = shock.start < 0 ? -1 : (seconds - shock.start) / BURST_SECONDS;
    if (burstAge >= 1) {
      shock.start = -1;
      logoTint = tintIndex;
    }
    const bursting = shock.start >= 0;
    const shockRadius = bursting ? radius * (1 + 1.4 * (1 - Math.pow(1 - burstAge, 3))) : 0;
    // Events recolor the whole scene, so the globe and logos show the theme's own look under them.
    const tintList = tints();
    const restTint = event === null ? tintList[sweeping ? sweep.from : tintIndex] : tintList[0];
    const sweptTint = event === null && sweeping ? tintList[sweep.to] : restTint;
    const tintAt = (y) => sweeping && (y - scanY) * (sweep.downward ? 1 : -1) > 0 ? sweptTint : restTint;
    logoTintAt = (distance) => event !== null ? tintList[0] : tintList[bursting && distance > shockRadius ? logoTint : tintIndex];

    const placed = flyers.map((flyer) => placeFlyer(flyer, seconds, tilt)).sort((a, b) => a.center[2] - b.center[2]);
    drawCreatures(seconds, "behind");
    placed.filter((slab) => slab.center[2] < 0).forEach((slab) => drawSolid(slab, radius));

    meridians.concat(parallels).forEach((path) => strokePath(path, spin, tilt, radius, (y) => tintAt(y).line, 1, 0.35, 0.06));

    if (sweeping && event === null) {
      const scanRing = Math.sqrt(1 - scanY * scanY);
      strokePath(circle(64, (angle) => [Math.cos(angle) * scanRing, scanY, Math.sin(angle) * scanRing]), spin, tilt, radius, sweptTint.ring, 1.5, 0.9, 0.2);
    }

    context.font = "bold 10px " + fontFamily;
    context.textAlign = "center";
    context.textBaseline = "middle";
    nodes.forEach((node, index) => {
      const [x, y, z] = project(rotate(node, spin, tilt), radius);
      const nearScan = Math.abs(node[1] - scanY) < 0.06;
      if (hacking) {
        const distance = Math.acos(Math.max(-1, Math.min(1, dot(node, state.origin))));
        const infected = distance < infection || revealAge >= 0;
        const front = Math.abs(distance - infection) < 0.22 && revealAge < 0;
        context.globalAlpha = depthAlpha(z, infected ? 1 : 0.5, infected ? 0.25 : 0.08);
        context.fillStyle = front || (revealAge >= 0 && revealAge < 0.4) ? hackLight : infected ? palette.matrix : palette.dim;
        if (infected && z > 0 && index % 3 === 0) {
          context.fillText(MATRIX_GLYPHS[Math.floor(glyphNoise(index * 3.7 + Math.floor(seconds * 8)) * MATRIX_GLYPHS.length)], x, y);
          return;
        }
        const size = (front ? 3.4 : infected ? 2.2 : 1.4) * (3 / (3 - z));
        context.fillRect(x - size / 2, y - size / 2, size, size);
        return;
      }
      context.globalAlpha = depthAlpha(z, nearScan ? 1 : 0.85, 0.12) * (hitFlicker && Math.random() < 0.5 ? 0.2 : 1);
      context.fillStyle = nearScan || (bursting && burstAge < 0.15) ? tintList[tintIndex].ring : tintAt(node[1]).dot;
      const size = (nearScan ? 2.4 : 1.6) * (3 / (3 - z));
      context.fillRect(x - size / 2, y - size / 2, size, size);
    });

    if (bursting && event === null) {
      const color = tintList[tintIndex].ring;
      context.globalAlpha = 1 - burstAge;
      context.strokeStyle = color;
      context.lineWidth = 2.5 * (1 - burstAge) + 0.5;
      context.beginPath();
      context.arc(width / 2, height / 2, shockRadius, 0, Math.PI * 2);
      context.stroke();
      context.fillStyle = color;
      shock.sparks.forEach(({ angle, speed }) => {
        const reach = radius * (1 + 1.6 * speed * (1 - Math.pow(1 - burstAge, 2)));
        const size = 2.5 * (1 - burstAge) + 0.5;
        context.fillRect(width / 2 + Math.cos(angle) * reach - size / 2, height / 2 + Math.sin(angle) * reach - size / 2, size, size);
      });
    }

    if (seconds >= nextArcAt) {
      const from = nodes[Math.floor(Math.random() * NODE_COUNT)];
      const to = nodes[Math.floor(Math.random() * NODE_COUNT)];
      arcs.push({ from, to, born: seconds });
      nextArcAt = seconds + (hacking ? 0.05 + Math.random() * 0.08 : 0.4 + Math.random() * 0.6);
    }
    for (let index = arcs.length - 1; index >= 0; index--) {
      const age = (seconds - arcs[index].born) / 1.4;
      if (age >= 1) { arcs.splice(index, 1); continue; }
      const head = Math.min(1, age * 2);
      const tail = Math.max(0, age * 2 - 1);
      const steps = 24;
      const path = Array.from({ length: steps + 1 }, (_, step) => slerpLifted(arcs[index].from, arcs[index].to, tail + (head - tail) * (step / steps)));
      strokePath(path, spin, tilt, radius, hacking ? hackLight : restTint.dot, hacking ? 2 : 1.25, 0.95, 0.15);
    }

    strokePath(orbit, spin * 0.6, tilt + 0.5, radius, palette.dim, 1, 0.4, 0.08);
    const satelliteAngle = seconds * 1.1;
    const [sx, sy, sz] = project(rotate([Math.cos(satelliteAngle) * 1.32, Math.sin(satelliteAngle) * 0.3, Math.sin(satelliteAngle) * 1.28], spin * 0.6, tilt + 0.5), radius);
    context.globalAlpha = depthAlpha(sz, 1, 0.3);
    context.strokeStyle = palette.accent;
    context.lineWidth = 1;
    context.strokeRect(sx - 3, sy - 3, 6, 6);
    placed.filter((slab) => slab.center[2] >= 0).forEach((slab) => drawSolid(slab, radius));
    drawCreatures(seconds, "front");

    if (hacking && revealAge >= 0 && revealAge < 1) {
      [0, 0.18].forEach((delay) => {
        const age = clamp01((revealAge - delay) / 0.8);
        if (age <= 0 || age >= 1) return;
        context.globalAlpha = 1 - age;
        context.strokeStyle = hackLight;
        context.lineWidth = 3 * (1 - age) + 1;
        context.beginPath();
        context.arc(width / 2, height / 2, radius * (1 + easeInOut(age) * 1.6), 0, Math.PI * 2);
        context.stroke();
      });
    }
    if (defending) drawDefense(seconds, event, radius, spin, tilt, dt);
    if (event !== null) drawSparksAndRings(seconds, dt);
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

  // Core's half of each bit. ERROR shows here on even beats and in the Djaunt view on odd ones. During HACK, Core runs
  // the firewall bypass, then answers the Djaunt view's reveal. During DEFENSE, Core sounds the alarm, runs the
  // countermeasures bar, shouts the almost-there line, then answers the Djaunt view's win line.
  const CORE_ERROR_BEAT = 0;
  const FAULT_CODES = ["FAULT 0xDEAD", "SEGV 0xBADC0DE", "PANIC 0xC0FFEE", "TRAP 0xFEEDFACE"];
  let eventReadouts = false;

  function drawProgress(label, percent, textColor, barColor, centerY) {
    const barWidth = Math.min(width * 0.7, 320), barHeight = 10;
    const barX = (width - barWidth) / 2, barY = height * centerY;
    context.fillStyle = "#000";
    context.globalAlpha = 0.7;
    context.fillRect(barX - 10, barY - 30, barWidth + 20, barHeight + 44);
    context.globalAlpha = 1;
    context.font = "bold 11px " + fontFamily;
    context.textAlign = "left";
    context.textBaseline = "bottom";
    context.fillStyle = textColor;
    context.fillText(label, barX, barY - 6);
    context.textAlign = "right";
    context.fillText(String(Math.max(0, percent)).padStart(3, " ") + "%", barX + barWidth, barY - 6);
    context.strokeStyle = barColor;
    context.lineWidth = 1;
    context.strokeRect(barX + 0.5, barY + 0.5, barWidth - 1, barHeight - 1);
    context.fillStyle = barColor;
    context.fillRect(barX + 2, barY + 2, (barWidth - 4) * Math.max(0, percent) / 100, barHeight - 4);
  }

  function drawDefenseWords(event) {
    const percent = defensePercent(event);
    const flashing = Math.floor(event.age * 8) % 2 === 0;
    if (event.beat === 0) {
      if (flashing) drawBigText("HOSTILE TRAFFIC", palette.alert, { maxHeight: 0.13, centerY: 0.16 });
      phaseLabel.textContent = "alert";
      syncLabel.textContent = "threat lvl " + (7 + Math.floor(event.age * 5) % 3) + "\\nlinks under fire";
      anglesLabel.textContent = "src " + [0, 0, 0, 0].map(() => Math.floor(Math.random() * 256)).join(".");
    } else if (event.beat < 3) {
      if (event.beat === 2) {
        const pulse = 1 + 0.08 * Math.sin(event.age * 40);
        drawBigText(event.lines[2], palette.warning, { maxHeight: 0.24, centerY: 0.32, scale: pulse });
      }
      drawProgress("COUNTERMEASURES", percent, palette.shield, palette.shield, event.beat === 2 ? 0.74 : 0.82);
      phaseLabel.textContent = "shields";
      syncLabel.textContent = "shield " + String(percent).padStart(3, "0") + "%\\nblocked " + Math.floor(event.age * 37);
      anglesLabel.textContent = "port " + (1024 + Math.floor(Math.random() * 60000)) + " sealed";
    } else {
      if (Math.floor(event.beatAge * 5) % 2 === 0) drawBigText(event.lines[4], shade(rgbOf(palette.shield), 1.3), { maxHeight: 0.2, alpha: event.strength });
      phaseLabel.textContent = "secure";
      syncLabel.textContent = "threat 0\\nshield 100%";
      anglesLabel.textContent = "trace complete";
    }
    hexLabel.textContent = "0x" + Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, "0");
  }
  let hexLines = [];
  function drawEvent(seconds, event) {
    if (event === null) {
      if (eventReadouts) { eventReadouts = false; phaseLabel.textContent = PHASES[phaseIndex]; }
      return;
    }
    eventReadouts = true;
    const light = shade(rgbOf(palette.matrix), 1.6);
    if (event.kind === "error" && event.age < ERROR_FLASH_SECONDS) {
      if (errorBeatShows(event, CORE_ERROR_BEAT)) drawBigText("ERROR", palette.alert);
      phaseLabel.textContent = "fault";
      syncLabel.textContent = "sync 00.00%\\nlinks --";
      anglesLabel.textContent = FAULT_CODES[Math.floor(event.age * 6) % FAULT_CODES.length];
      hexLabel.textContent = "0x" + Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, "0");
    } else if (event.kind === "error") {
      drawBigText("REBOOTING" + ".".repeat(1 + Math.floor(event.age * 6) % 3), palette.dim, { maxHeight: 0.12, alpha: event.strength });
      phaseLabel.textContent = "reboot";
    } else if (event.kind === "defense") {
      drawDefenseWords(event);
    } else if (event.age < HACK_REVEAL_SECONDS) {
      const progress = clamp01((event.age - 0.2) / (HACK_REVEAL_SECONDS - 0.3));
      const percent = Math.min(100, Math.floor(easeInOut(progress) * 100 + Math.sin(event.age * 23) * 2 * (1 - progress)));
      drawProgress("BYPASSING FIREWALL", percent, light, palette.matrix, 0.5);
      if (hexLines.length === 0 || Math.random() < 0.4) {
        hexLines.push(Array.from({ length: 4 }, () => Math.floor(Math.random() * 0x10000).toString(16).toUpperCase().padStart(4, "0")).join(" "));
        hexLines = hexLines.slice(-3);
      }
      phaseLabel.textContent = "intrusion";
      syncLabel.textContent = "breach " + String(Math.max(0, percent)).padStart(3, "0") + "%\\nproxy x" + (3 + Math.floor(event.age * 4) % 7);
      anglesLabel.textContent = hexLines.join("\\n");
      hexLabel.textContent = "0x" + Math.floor(Math.random() * 0xffffffff).toString(16).toUpperCase().padStart(8, "0");
    } else {
      if (Math.floor((event.age - HACK_REVEAL_SECONDS) * 5) % 2 === 0) drawBigText(event.phrases[1], light, { maxHeight: 0.2, alpha: event.strength });
      phaseLabel.textContent = "root";
      syncLabel.textContent = "access 100.0%\\nlinks ∞";
      anglesLabel.textContent = "uid 0 // gid 0";
    }
  }
`;
