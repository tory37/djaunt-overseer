// Decorative only: a western dragon and three legendary birds (Moltres, Zapdos, Articuno) that cross the Core
// view now and then, one at a time, in front of or behind the globe. A scene script for the decorative shell; the scene calls drawCreatures(seconds, "behind" | "front").
// Each creature is drawn facing +x in units of its body size, y down. Wings are drawn spread flat, then squashed
// by the flap so the span tips up and down past the body.
export const CREATURES_SCRIPT = `
  const DRAGON_WING = { elbow: [-0.06, 0.2], wrist: [0.1, 0.36], tips: [[0.02, 0.66], [-0.16, 0.6], [-0.3, 0.46], [-0.36, 0.26]], root: [-0.2, 0.02] };
  const BIRD_ARM = [[0, 0], [0.06, 0.16], [0.02, 0.32], [-0.05, 0.46]];
  // Particles live in device pixels, velocities in device pixels per second.
  const MAX_PARTICLES = 500;
  const particles = [];
  // Lightning bolts: device-pixel polylines that last a few frames.
  const bolts = [];
  let lastCreatureSeconds;
  const creatures = [
    { draw: drawDragon, nextAt: 5, pass: null },
    { draw: drawMoltres, nextAt: 14, pass: null },
    { draw: drawZapdos, nextAt: 24, pass: null },
    { draw: drawArticuno, nextAt: 34, pass: null },
  ];

  function fillPolygon(points) {
    context.beginPath();
    points.forEach(([x, y], index) => (index === 0 ? context.moveTo(x, y) : context.lineTo(x, y)));
    context.closePath();
    context.fill();
  }

  function fillEllipse(x, y, radiusX, radiusY, angle = 0) {
    context.beginPath();
    context.ellipse(x, y, radiusX, radiusY, angle, 0, Math.PI * 2);
    context.fill();
  }

  // A tapered band along a polyline, one width per point.
  function fillTube(points, widths) {
    const left = [], right = [];
    points.forEach(([x, y], index) => {
      const [previousX, previousY] = points[Math.max(0, index - 1)];
      const [nextX, nextY] = points[Math.min(points.length - 1, index + 1)];
      const length = Math.hypot(nextX - previousX, nextY - previousY) || 1;
      const offsetX = (-(nextY - previousY) / length) * widths[index] / 2;
      const offsetY = ((nextX - previousX) / length) * widths[index] / 2;
      left.push([x + offsetX, y + offsetY]);
      right.push([x - offsetX, y - offsetY]);
    });
    fillPolygon(left.concat(right.reverse()));
  }

  function quadraticPoints([fromX, fromY], [controlX, controlY], [toX, toY], count) {
    return Array.from({ length: count }, (_, index) => {
      const t = index / (count - 1), u = 1 - t;
      return [u * u * fromX + 2 * u * t * controlX + t * t * toX, u * u * fromY + 2 * u * t * controlY + t * t * toY];
    });
  }

  // A flap that lingers at full spread up and down instead of passing through edge-on half the time.
  const flapAt = (seconds, rate) => { const wave = Math.sin(seconds * rate); return Math.sign(wave) * Math.pow(Math.abs(wave), 0.55); };

  const taper = (count, from, to) => Array.from({ length: count }, (_, index) => from + (to - from) * (index / (count - 1)));

  // Local point to device pixels, for particles that live in screen space after the creature moves on.
  function toDevice([x, y]) {
    const point = context.getTransform().transformPoint(new DOMPoint(x, y));
    return [point.x, point.y];
  }

  // gravity is in device pixels per second squared; negative rises like a spark, positive falls like frost.
  function emit(layer, [x, y], [velocityX, velocityY], color, life, size, gravity = -20, flake = false) {
    if (particles.length >= MAX_PARTICLES) particles.shift();
    particles.push({ layer, x, y, velocityX, velocityY, color, life, maxLife: life, size, gravity, flake });
  }

  // A jagged bolt from a local point, outward along a local angle.
  function strike(layer, from, angle, length) {
    const points = [toDevice(from)];
    const segments = 6;
    for (let segment = 1; segment <= segments; segment++) {
      const reach = (segment / segments) * length;
      const jag = segment === segments ? 0 : (Math.random() - 0.5) * length * 0.35;
      points.push(toDevice([from[0] + Math.cos(angle) * reach - Math.sin(angle) * jag, from[1] + Math.sin(angle) * reach + Math.cos(angle) * jag]));
    }
    bolts.push({ layer, points, life: 0.08 + Math.random() * 0.08 });
  }

  // lift runs -1 to 1: the share of the span that points up. Fingers sweep back on the downstroke.
  function wingMapper(shoulder, lift) {
    const sweep = (1 - lift) * 0.05;
    return ([x, span]) => [shoulder[0] + x - sweep * span, shoulder[1] - span * lift];
  }

  function drawBatWing(shoulder, lift, membraneColor, boneColor) {
    const at = wingMapper(shoulder, lift);
    const { elbow, wrist, tips, root } = DRAGON_WING;
    const scallop = (from, to) => {
      const middleX = (from[0] + to[0]) / 2, middleY = (from[1] + to[1]) / 2;
      return [middleX + (wrist[0] - middleX) * 0.3, middleY + (wrist[1] - middleY) * 0.3];
    };
    const edge = [[0, 0], elbow, wrist];
    tips.forEach((tip, index) => {
      edge.push(tip);
      edge.push(scallop(tip, tips[index + 1] || root));
    });
    edge.push(root);
    context.fillStyle = membraneColor;
    fillPolygon(edge.map(at));
    context.fillStyle = boneColor;
    fillTube([[0, 0], elbow, wrist].map(at), [0.045, 0.03, 0.022]);
    tips.forEach((tip) => fillTube([wrist, tip].map(at), [0.016, 0.004]));
  }

  function drawFeatherWing(shoulder, lift, innerColor, outerColor, tipColor) {
    const at = wingMapper(shoulder, lift);
    const alongArm = (fraction) => {
      const scaled = fraction * (BIRD_ARM.length - 1);
      const index = Math.min(BIRD_ARM.length - 2, Math.floor(scaled));
      const local = scaled - index;
      return [0, 1].map((axis) => BIRD_ARM[index][axis] + (BIRD_ARM[index + 1][axis] - BIRD_ARM[index][axis]) * local);
    };
    for (let feather = 10; feather >= 0; feather--) {
      const fraction = feather / 10;
      const base = alongArm(fraction);
      const directionX = -1 + fraction * 0.7, directionY = 0.15 + fraction * 0.85;
      const length = (0.16 + fraction * 0.2) / Math.hypot(directionX, directionY);
      const tip = [base[0] + directionX * length, base[1] + directionY * length];
      const middle = [base[0] + directionX * length * 0.5, base[1] + directionY * length * 0.5];
      context.fillStyle = fraction > 0.55 ? outerColor : innerColor;
      fillTube([base, middle, tip].map(at), [0.05, 0.05, 0.004]);
      if (tipColor) {
        context.fillStyle = tipColor;
        fillTube([[base[0] + directionX * length * 0.7, base[1] + directionY * length * 0.7], tip].map(at), [0.034, 0.004]);
      }
    }
    context.fillStyle = innerColor;
    fillTube(BIRD_ARM.map(at), [0.07, 0.055, 0.04, 0.02]);
  }

  // Zapdos' wing: sharp sawtooth feathers instead of rounded ones, each with a dark tip.
  function drawSpikyWing(shoulder, lift, innerColor, tipColor) {
    const at = wingMapper(shoulder, lift);
    const alongArm = (fraction) => {
      const scaled = clamp01(fraction) * (BIRD_ARM.length - 1);
      const index = Math.min(BIRD_ARM.length - 2, Math.floor(scaled));
      const local = scaled - index;
      return [0, 1].map((axis) => BIRD_ARM[index][axis] + (BIRD_ARM[index + 1][axis] - BIRD_ARM[index][axis]) * local);
    };
    for (let feather = 6; feather >= 0; feather--) {
      const fraction = feather / 6;
      const base = alongArm(fraction);
      const directionX = -1 + fraction * 0.85, directionY = 0.15 + fraction * 0.85;
      const length = (0.17 + fraction * 0.2) / Math.hypot(directionX, directionY);
      const tip = [base[0] + directionX * length, base[1] + directionY * length];
      const lower = alongArm(fraction - 0.16), upper = alongArm(fraction + 0.16);
      context.fillStyle = innerColor;
      fillPolygon([lower, tip, upper].map(at));
      const notch = (point) => [point[0] + (tip[0] - point[0]) * 0.55, point[1] + (tip[1] - point[1]) * 0.55];
      context.fillStyle = tipColor;
      fillPolygon([notch(lower), tip, notch(upper)].map(at));
    }
    context.fillStyle = innerColor;
    fillTube(BIRD_ARM.map(at), [0.08, 0.06, 0.045, 0.02]);
  }

  function drawDragon(seconds, tone, pass, layer) {
    const flap = flapAt(seconds, 5.5);
    const base = rgbOf(palette.dragon), green = rgbOf(palette.scales);
    const body = shade(base, 0.85 * tone), mid = shade(base, 0.62 * tone), dark = shade(base, 0.42 * tone);
    const scales = shade(green, tone), scalesDark = shade(green, 0.6 * tone);
    context.translate(0, flap * 0.025);
    drawBatWing([0.02, -0.06], flap * 0.9, dark, scalesDark);

    const tail = Array.from({ length: 16 }, (_, index) => {
      const along = index / 15;
      return [-0.16 - along * 0.62, 0.01 + along * 0.05 + Math.sin(seconds * 3 - along * 5) * 0.05 * along];
    });
    context.fillStyle = body;
    fillTube(tail, taper(16, 0.1, 0.012));
    const [tipX, tipY] = tail[15], [beforeX, beforeY] = tail[14];
    const angle = Math.atan2(tipY - beforeY, tipX - beforeX);
    const forward = [Math.cos(angle), Math.sin(angle)], across = [-forward[1], forward[0]];
    const spadeAt = (ahead, side) => [tipX + forward[0] * ahead + across[0] * side, tipY + forward[1] * ahead + across[1] * side];
    context.fillStyle = scales;
    fillPolygon([spadeAt(0, 0), spadeAt(0.03, 0.035), spadeAt(0.08, 0), spadeAt(0.03, -0.035)]);
    for (let index = 1; index < 12; index += 2) {
      const [x, y] = tail[index], [nextX, nextY] = tail[index + 1];
      const length = Math.hypot(nextX - x, nextY - y) || 1;
      const upX = (nextY - y) / length, upY = -(nextX - x) / length;
      const height = 0.04 * (1 - index / 15);
      fillPolygon([[x - 0.015, y - 0.03 * (1 - index / 15)], [x + upX * height - 0.01, y + upY * height - 0.03], [nextX, nextY - 0.03 * (1 - index / 15)]]);
    }
    [-0.12, -0.06, 0, 0.06].forEach((x) => fillPolygon([[x - 0.025, -0.065], [x - 0.02, -0.11], [x + 0.02, -0.07]]));

    context.fillStyle = mid;
    fillTube([[-0.1, 0.04], [-0.17, 0.12], [-0.1, 0.16]], [0.06, 0.035, 0.02]);
    fillTube([[0.1, 0.04], [0.15, 0.11], [0.2, 0.12]], [0.045, 0.028, 0.015]);
    context.fillStyle = body;
    fillEllipse(0, 0, 0.2, 0.075, -0.08);
    context.save();
    context.beginPath();
    context.ellipse(0, 0, 0.2, 0.075, -0.08, 0, Math.PI * 2);
    context.clip();
    context.fillStyle = scales;
    fillEllipse(0.02, 0.06, 0.19, 0.04, -0.08);
    context.restore();

    const neck = quadraticPoints([0.12, -0.02], [0.27, -0.01], [0.34, -0.11], 9);
    context.fillStyle = body;
    fillTube(neck, taper(9, 0.09, 0.045));
    context.fillStyle = scales;
    fillTube(neck.slice(0, 8).map(([x, y], index) => [x + 0.012 + index * 0.0015, y + 0.026 - index * 0.002]), taper(8, 0.04, 0.016));
    context.fillStyle = body;
    const [headX, headY] = neck[8];
    const breathing = pass.breatheAt >= 0 && pass.progress > pass.breatheAt && pass.progress < pass.breatheAt + 0.16;
    const jaw = breathing ? 0.35 : 0.05;
    const hinge = [headX + 0.01, headY + 0.012];
    const jawPoint = ([x, y]) => [hinge[0] + x * Math.cos(jaw) - y * Math.sin(jaw), hinge[1] + x * Math.sin(jaw) + y * Math.cos(jaw)];
    fillPolygon([[0, 0], [0.11, 0], [0.095, 0.016], [0.015, 0.026]].map(jawPoint));
    fillPolygon([[-0.015, -0.035], [0.04, -0.045], [0.09, -0.03], [0.135, -0.012], [0.135, 0.004], [0.06, 0.008], [0, 0.026]].map(([x, y]) => [headX + x, headY + y]));
    context.fillStyle = scales;
    fillTube([[headX, headY - 0.03], [headX - 0.045, headY - 0.07], [headX - 0.1, headY - 0.085]], [0.022, 0.012, 0.002]);
    fillTube([[headX + 0.02, headY - 0.035], [headX - 0.005, headY - 0.075], [headX - 0.045, headY - 0.1]], [0.016, 0.009, 0.002]);
    context.fillStyle = palette.fire[0];
    context.fillRect(headX + 0.045, headY - 0.025, 0.014, 0.01);

    drawBatWing([0.05, -0.05], flap, mid, scales);

    if (breathing) {
      const mouth = toDevice([headX + 0.14, headY + 0.01]);
      const ahead = toDevice([headX + 0.24, headY + 0.03]);
      for (let spark = 0; spark < 9; spark++) {
        const spread = 0.35;
        emit(layer, mouth, [(ahead[0] - mouth[0]) * (4 + Math.random() * 3) + (Math.random() - 0.5) * spread * 200, (ahead[1] - mouth[1]) * (4 + Math.random() * 3) + (Math.random() - 0.5) * spread * 200],
          palette.fire[Math.floor(Math.random() * 3)], 0.45 + Math.random() * 0.35, 3 + Math.random() * 4);
      }
    }
  }

  function drawMoltres(seconds, tone, pass, layer) {
    const flap = flapAt(seconds, 6);
    const [yellow, orange, red] = palette.fire.map((color) => rgbOf(color));
    context.scale(1.15, 1.15);
    context.translate(0, flap * 0.03);
    drawFeatherWing([0, -0.03], flap * 0.9, shade(red, 0.6 * tone), shade(orange, 0.6 * tone));

    [-1, 0, 1].forEach((spread) => {
      const streamer = Array.from({ length: 14 }, (_, index) => {
        const along = index / 13;
        return [-0.1 - along * 0.72, 0.02 + spread * along * 0.12 + Math.sin(seconds * 3.2 - along * 4 + spread) * 0.05 * along];
      });
      context.fillStyle = shade(red, tone);
      fillTube(streamer, taper(14, 0.05, 0.008));
      const [endX, endY] = streamer[13];
      context.fillStyle = shade(orange, tone);
      fillEllipse(endX, endY, 0.04, 0.026);
      context.fillStyle = shade(yellow, tone);
      fillEllipse(endX, endY, 0.016, 0.012);
      if (Math.random() < 0.5) {
        emit(layer, toDevice([endX, endY]), [(Math.random() - 0.5) * 30, -10 - Math.random() * 30], palette.fire[Math.floor(Math.random() * 3)], 0.5 + Math.random() * 0.5, 1.5 + Math.random() * 2.5);
      }
    });

    context.fillStyle = shade(orange, tone);
    fillEllipse(0, 0, 0.13, 0.05, -0.1);
    context.fillStyle = shade(yellow, tone);
    fillEllipse(0.05, 0.015, 0.065, 0.028, -0.1);
    context.fillStyle = shade(orange, tone);
    fillTube(quadraticPoints([0.08, -0.02], [0.13, -0.03], [0.15, -0.05], 5), taper(5, 0.06, 0.05));
    fillEllipse(0.155, -0.055, 0.035, 0.03);
    context.fillStyle = shade(yellow, tone);
    fillPolygon([[0.18, -0.065], [0.235, -0.05], [0.18, -0.04]]);
    context.fillStyle = shade(red, tone);
    [0, 1, 2].forEach((plume) => fillTube(quadraticPoints([0.15, -0.08], [0.12 - plume * 0.02, -0.13 - plume * 0.01], [0.07 - plume * 0.035, -0.14 + plume * 0.02], 6), taper(6, 0.022, 0.003)));
    context.fillStyle = shade([20, 12, 8], 1);
    context.fillRect(0.162, -0.065, 0.012, 0.01);

    drawFeatherWing([0.02, -0.03], flap, shade(orange, tone), shade(yellow, tone));
    if (Math.random() < 0.6) {
      const tip = toDevice(wingMapper([0.02, -0.03], flap)([-0.25, 0.6]));
      emit(layer, tip, [(Math.random() - 0.5) * 20, -5 - Math.random() * 20], palette.fire[Math.floor(Math.random() * 2)], 0.4 + Math.random() * 0.3, 1 + Math.random() * 2);
    }
  }

  function drawZapdos(seconds, tone, pass, layer) {
    const flap = flapAt(seconds, 7);
    const [yellow, orange] = palette.fire.map((color) => rgbOf(color));
    const body = shade(yellow, tone), dark = shade(orange, 0.5 * tone);
    context.scale(1.1, 1.1);
    context.translate(0, flap * 0.03);
    drawSpikyWing([0, -0.03], flap * 0.9, shade(yellow, 0.65 * tone), shade(orange, 0.35 * tone));

    context.fillStyle = body;
    [-0.05, 0, 0.05].forEach((spread) => fillPolygon([[-0.08, -0.02], [-0.3, spread - 0.01 + Math.sin(seconds * 9 + spread * 20) * 0.01], [-0.24, spread + 0.03], [-0.08, 0.03]]));
    context.fillStyle = dark;
    fillTube([[0.02, 0.04], [0.0, 0.1], [0.04, 0.13]], [0.025, 0.018, 0.01]);
    fillTube([[-0.03, 0.04], [-0.05, 0.1], [-0.01, 0.13]], [0.025, 0.018, 0.01]);
    context.fillStyle = body;
    fillPolygon([[-0.12, -0.03], [-0.02, -0.06], [0.1, -0.05], [0.14, -0.02], [0.08, 0.04], [-0.04, 0.05], [-0.12, 0.02]]);
    fillPolygon([[0.08, -0.04], [0.15, -0.09], [0.2, -0.08], [0.2, -0.04], [0.13, -0.01]]);
    [0, 1, 2, 3].forEach((spike) => fillPolygon([[0.15 - spike * 0.012, -0.085], [0.11 - spike * 0.04, -0.16 + spike * 0.012], [0.17 - spike * 0.015, -0.075]]));
    context.fillStyle = dark;
    fillPolygon([[0.195, -0.075], [0.27, -0.06], [0.195, -0.045]]);
    context.fillStyle = "#fff";
    fillPolygon([[0.17, -0.072], [0.19, -0.066], [0.17, -0.062]]);

    drawSpikyWing([0.02, -0.03], flap, body, dark);
    if (Math.random() < 0.7) {
      const tip = toDevice(wingMapper([0.02, -0.03], flap)([-0.12, 0.62]));
      emit(layer, tip, [(Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80], Math.random() < 0.4 ? "#fff" : palette.fire[0], 0.08 + Math.random() * 0.12, 1.5 + Math.random() * 2, 0);
    }
    if (Math.random() < 0.035) strike(layer, [0, 0], Math.PI * (0.25 + Math.random() * 1.5), 0.4 + Math.random() * 0.3);
  }

  function drawArticuno(seconds, tone, pass, layer) {
    const flap = flapAt(seconds, 4.5);
    const [pale, light, blue] = palette.ice.map((color) => rgbOf(color));
    context.scale(1.1, 1.1);
    context.translate(0, flap * 0.03);
    drawFeatherWing([0, -0.03], flap * 0.9, shade(blue, 0.6 * tone), shade(blue, 0.75 * tone), shade(light, 0.7 * tone));

    [-1, 0.2, 1.2].forEach((spread, ribbon) => {
      const streamer = Array.from({ length: 22 }, (_, index) => {
        const along = index / 21;
        return [-0.08 - along * 1.15, 0.02 + spread * along * 0.07 + Math.sin(seconds * 2.2 - along * 5 + ribbon) * 0.07 * along];
      });
      context.fillStyle = shade(ribbon === 1 ? light : blue, tone);
      fillTube(streamer, taper(22, 0.05, 0.014));
      if (Math.random() < 0.35) {
        const [x, y] = streamer[Math.floor(10 + Math.random() * 12)];
        emit(layer, toDevice([x, y]), [(Math.random() - 0.5) * 10, 4 + Math.random() * 8], palette.ice[Math.floor(Math.random() * 2)], 1.2 + Math.random() * 1, 2 + Math.random() * 2, 12, true);
      }
    });

    context.fillStyle = shade(light, tone);
    fillEllipse(0, 0, 0.13, 0.05, -0.1);
    context.fillStyle = shade(pale, tone);
    fillEllipse(0.05, 0.015, 0.065, 0.028, -0.1);
    context.fillStyle = shade(light, tone);
    fillTube(quadraticPoints([0.08, -0.02], [0.13, -0.04], [0.15, -0.07], 5), taper(5, 0.055, 0.045));
    fillEllipse(0.155, -0.075, 0.035, 0.028);
    context.fillStyle = shade(pale, tone);
    fillPolygon([[0.18, -0.083], [0.225, -0.072], [0.18, -0.062]]);
    context.fillStyle = shade(blue, tone);
    [0, 1].forEach((plume) => fillTube(quadraticPoints([0.15, -0.1], [0.1, -0.16 - plume * 0.02], [-0.02 - plume * 0.05, -0.13 + Math.sin(seconds * 3 + plume) * 0.02], 8), taper(8, 0.03, 0.004)));
    context.fillStyle = shade([150, 30, 60], 1);
    context.fillRect(0.162, -0.085, 0.012, 0.01);

    drawFeatherWing([0.02, -0.03], flap, shade(light, tone), shade(blue, tone), shade(pale, tone));
    if (Math.random() < 0.5) {
      const tip = toDevice(wingMapper([0.02, -0.03], flap)([-0.25, 0.6]));
      emit(layer, tip, [(Math.random() - 0.5) * 12, 6 + Math.random() * 10], palette.ice[0], 1.4 + Math.random() * 0.8, 2 + Math.random() * 2, 10, true);
    }
  }

  function launch(creature, seconds) {
    creature.pass = {
      start: seconds,
      duration: 7 + Math.random() * 3,
      direction: Math.random() < 0.5 ? 1 : -1,
      behind: Math.random() < 0.35,
      fromY: 0.25 + Math.random() * 0.5,
      toY: 0.2 + Math.random() * 0.6,
      bobPhase: Math.random() * Math.PI * 2,
      breatheAt: Math.random() < 0.6 ? 0.3 + Math.random() * 0.35 : -1,
      progress: 0,
    };
  }

  // Crosses the view edge to edge with a gentle bob; the climb tilts the nose along the path.
  function passPose(pass, size) {
    const margin = size * 0.9;
    const travel = width + margin * 2;
    const along = (progress) => [
      pass.direction > 0 ? -margin + progress * travel : width + margin - progress * travel,
      height * (pass.fromY + (pass.toY - pass.fromY) * easeInOut(clamp01(progress))) + Math.sin(progress * Math.PI * 2 + pass.bobPhase) * height * 0.06,
    ];
    const [x, y] = along(pass.progress);
    const [aheadX, aheadY] = along(pass.progress + 0.01);
    const climb = Math.max(-0.4, Math.min(0.4, Math.atan2(aheadY - y, Math.abs(aheadX - x))));
    return { x, y, climb };
  }

  function drawCreatures(seconds, layer) {
    if (layer === "behind") {
      const elapsed = lastCreatureSeconds === undefined ? 0 : Math.min(0.1, Math.max(0, seconds - lastCreatureSeconds));
      lastCreatureSeconds = seconds;
      for (let index = particles.length - 1; index >= 0; index--) {
        const particle = particles[index];
        particle.life -= elapsed;
        if (particle.life <= 0) { particles.splice(index, 1); continue; }
        particle.x += particle.velocityX * elapsed;
        particle.y += particle.velocityY * elapsed;
        particle.velocityY += particle.gravity * elapsed;
      }
      for (let index = bolts.length - 1; index >= 0; index--) {
        bolts[index].life -= elapsed;
        if (bolts[index].life <= 0) bolts.splice(index, 1);
      }
      creatures.forEach((creature) => {
        if (creature.pass === null && seconds >= creature.nextAt) {
          if (creatures.some((other) => other.pass !== null)) creature.nextAt = seconds + 3 + Math.random() * 4;
          else launch(creature, seconds);
        }
        if (creature.pass !== null) {
          creature.pass.progress = (seconds - creature.pass.start) / creature.pass.duration;
          if (creature.pass.progress > 1) {
            creature.pass = null;
            creature.nextAt = seconds + 15 + Math.random() * 25;
          }
        }
      });
    }

    const behind = layer === "behind";
    creatures.forEach((creature) => {
      if (creature.pass === null || creature.pass.behind !== behind) return;
      const size = Math.max(48, Math.min(width, height) * 0.45) * (behind ? 0.55 : 1);
      const { x, y, climb } = passPose(creature.pass, size);
      context.save();
      context.globalAlpha = 1;
      context.translate(x, y);
      context.scale(size * creature.pass.direction, size);
      context.rotate(climb);
      creature.draw(seconds, behind ? 0.6 : 1, creature.pass, layer);
      context.restore();
    });

    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    const scale = window.devicePixelRatio || 1;
    particles.forEach((particle) => {
      if (particle.layer !== layer) return;
      const remaining = particle.life / particle.maxLife;
      context.globalAlpha = remaining * (behind ? 0.6 : 1);
      context.fillStyle = particle.color;
      const size = particle.size * scale * (0.4 + 0.6 * remaining);
      if (particle.flake) {
        context.fillRect(particle.x - size / 2, particle.y - size / 6, size, size / 3);
        context.fillRect(particle.x - size / 6, particle.y - size / 2, size / 3, size);
      } else {
        context.fillRect(particle.x - size / 2, particle.y - size / 2, size, size);
      }
    });
    context.lineJoin = "miter";
    bolts.forEach((bolt) => {
      if (bolt.layer !== layer) return;
      context.globalAlpha = behind ? 0.6 : 1;
      [[palette.fire[0], 3.5], ["#fff", 1.4]].forEach(([color, lineWidth]) => {
        context.strokeStyle = color;
        context.lineWidth = lineWidth * scale;
        context.beginPath();
        bolt.points.forEach(([x, y], index) => (index === 0 ? context.moveTo(x, y) : context.lineTo(x, y)));
        context.stroke();
      });
    });
    context.restore();
    context.globalAlpha = 1;
  }
`;
