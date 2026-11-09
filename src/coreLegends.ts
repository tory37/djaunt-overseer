// Decorative only: the Core's second wave of legendaries, joined into CREATURES_SCRIPT (flyingCreatures.ts) and
// sharing its helpers. Celebi flits, the three legendary dogs gallop on air, Jirachi drifts with its wish tags,
// Kyogre swims, Groudon leaps over in an arc, and a few Unown drift by, sometimes spelling a word.
// Each is drawn facing +x in units of its body size, y down, from palette colors so events recolor them.
export const UNOWN_WORDS = [
  "UNOWN", "HELLO", "HACK", "LGTM", "SHIP IT", "WIP", "TODO", "BUG", "NOPE", "GIT", "YOLO", "DJAUNT", "OOPS",
  "MERGE", "PING", "RETRY", "HI", "WHY", "?!", "SUDO", "DEPLOY", "CLAUDE", "NULL", "RTFM", "AFK", "BRB",
  "HELP", "LOL", "NO", "YES", "TEST", "FIX IT", "WHO?", "WOW", "OK",
];

// Unown come in letters, ! and ?, so the words use only those.
export const UNOWN_GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ!?";

export const LEGENDS_SCRIPT = `
  const UNOWN_WORDS = ${JSON.stringify(UNOWN_WORDS)};
  const UNOWN_GLYPHS = ${JSON.stringify(UNOWN_GLYPHS)};
  const INK = [28, 24, 34];

  const pickOf = (list) => list[Math.floor(Math.random() * list.length)];

  // A two-part leg from the hip: angle 0 points down, positive swings forward; bend turns the lower part.
  function drawLeg([hipX, hipY], angle, bend, length, legWidth, color, pawColor) {
    const knee = [hipX + Math.sin(angle) * length, hipY + Math.cos(angle) * length];
    const lowerAngle = angle + bend;
    const foot = [knee[0] + Math.sin(lowerAngle) * length, knee[1] + Math.cos(lowerAngle) * length];
    context.fillStyle = color;
    fillTube([[hipX, hipY], knee, foot], [legWidth, legWidth * 0.7, legWidth * 0.55]);
    context.fillStyle = pawColor || color;
    fillEllipse(foot[0] + Math.sin(lowerAngle + 1.2) * 0.012, foot[1] + Math.cos(lowerAngle + 1.2) * 0.012, legWidth * 0.45, legWidth * 0.32, -lowerAngle);
  }

  // A gallop on air: front legs reach while the hind legs kick back, then they gather. Far legs trail a little.
  function drawGallop(seconds, side, legColor, pawColor) {
    const lag = side === "far" ? 0.7 : 0;
    const stride = Math.sin(seconds * 9 - lag);
    const reach = Math.max(0, stride), gather = Math.max(0, -stride);
    drawLeg([0.13, 0.03], 0.25 + stride * 0.8, -0.15 - gather * 1.3, 0.085, 0.045, legColor, pawColor);
    drawLeg([-0.14, 0.02], -0.35 - stride * 0.75, 0.5 + reach * 0.5 - gather * 0.3, 0.09, 0.055, legColor, pawColor);
  }

  // The legendary dogs share a frame: body, chest, neck, and a head whose center is returned.
  function drawHound(bodyColor) {
    context.fillStyle = bodyColor;
    fillEllipse(0, 0, 0.2, 0.068, -0.04);
    fillEllipse(0.12, 0.005, 0.09, 0.072);
    fillTube([[0.15, -0.02], [0.22, -0.07], [0.26, -0.1]], [0.09, 0.075, 0.065]);
    const head = [0.28, -0.11];
    context.fillStyle = bodyColor;
    fillPolygon([[-0.045, -0.035], [0.02, -0.05], [0.07, -0.035], [0.115, -0.01], [0.12, 0.018], [0.06, 0.03], [-0.02, 0.035]]
      .map(([x, y]) => [head[0] + x, head[1] + y]));
    return head;
  }

  function drawEye([x, y], color, radius = 0.012) {
    context.fillStyle = shade(INK, 1);
    fillEllipse(x, y, radius * 1.4, radius, -0.25);
    context.fillStyle = color;
    fillEllipse(x + radius * 0.2, y, radius * 0.75, radius * 0.6, -0.25);
  }

  // Raikou: yellow with dark zigzag stripes, a storm cloud on its back, a lightning-bolt tail, and white fangs.
  function drawRaikou(seconds, tone, pass, layer) {
    const fur = rgbOf(palette.fire[0]), cloud = rgbOf(palette.dragon), pale = rgbOf(palette.ice[0]);
    const body = shade(fur, 0.95 * tone), far = shade(fur, 0.55 * tone), ink = shade(INK, 1);
    context.translate(0, Math.cos(seconds * 9) * 0.012);

    context.fillStyle = shade(pale, tone);
    const bolt = [[-0.17, -0.03], [-0.29, -0.13], [-0.25, -0.135], [-0.37, -0.25], [-0.31, -0.15], [-0.35, -0.145], [-0.19, 0.01]];
    const wag = Math.sin(seconds * 6) * 0.15;
    const tail = bolt.map(([x, y]) => [-0.17 + (x + 0.17) * Math.cos(wag) - y * Math.sin(wag), (x + 0.17) * Math.sin(wag) + y * Math.cos(wag)]);
    fillPolygon(tail);
    context.strokeStyle = ink;
    context.lineWidth = 0.01;
    context.stroke();

    drawGallop(seconds, "far", far, shade(pale, 0.6 * tone));
    const head = drawHound(body);
    context.fillStyle = ink;
    [-0.1, -0.03, 0.04].forEach((x, index) => fillTube([[x + 0.03, -0.065], [x - 0.005, -0.03], [x + 0.025, -0.005], [x - 0.01, 0.03]], [0.026, 0.02, 0.016, 0.004 + index * 0.002]));
    fillPolygon([[head[0] - 0.03, head[1] - 0.04], [head[0] + 0.07, head[1] - 0.04], [head[0] + 0.1, head[1] - 0.015], [head[0] + 0.02, head[1] - 0.012]]);
    context.fillStyle = shade(pale, tone);
    fillTube([[head[0] + 0.08, head[1] + 0.012], [head[0] + 0.09, head[1] + 0.05], [head[0] + 0.07, head[1] + 0.08]], [0.018, 0.012, 0.003]);
    fillTube([[head[0] + 0.05, head[1] + 0.02], [head[0] + 0.05, head[1] + 0.05], [head[0] + 0.03, head[1] + 0.075]], [0.016, 0.01, 0.003]);
    drawEye([head[0] + 0.045, head[1] - 0.022], palette.fire[2]);

    context.fillStyle = shade(cloud, 0.7 * tone);
    const puffs = [[0.14, -0.08, 0.06], [0.07, -0.1, 0.075], [-0.01, -0.1, 0.08], [-0.09, -0.09, 0.07], [-0.15, -0.07, 0.05]];
    puffs.forEach(([x, y, radius], index) => fillEllipse(x, y + Math.sin(seconds * 4 + index) * 0.008, radius, radius * 0.75));
    context.fillStyle = shade(cloud, 1.05 * tone);
    puffs.forEach(([x, y, radius], index) => fillEllipse(x + 0.01, y - radius * 0.3 + Math.sin(seconds * 4 + index) * 0.008, radius * 0.6, radius * 0.4));

    drawGallop(seconds, "near", body, shade(pale, tone));
    if (Math.random() < 0.6) {
      const spark = toDevice([(Math.random() - 0.5) * 0.4, -0.1 + (Math.random() - 0.5) * 0.12]);
      emit(layer, spark, [(Math.random() - 0.5) * 70, (Math.random() - 0.5) * 70], Math.random() < 0.4 ? "#fff" : palette.fire[0], 0.08 + Math.random() * 0.12, 1.5 + Math.random() * 2, 0);
    }
    if (Math.random() < 0.03) strike(layer, [-0.01, -0.12], -Math.PI * (0.2 + Math.random() * 0.6), 0.35 + Math.random() * 0.25);
  }

  function drawEntei(seconds, tone, pass, layer) {
    const fur = shade(rgbOf(palette.fire[2]), 0.62), gold = rgbOf(palette.fire[0]), smoke = rgbOf(palette.dim), pale = rgbOf(palette.ice[0]);
    const furRgb = rgbOf(fur);
    const body = shade(furRgb, tone), far = shade(furRgb, 0.6 * tone), ink = shade(INK, 1);
    context.translate(0, Math.cos(seconds * 9) * 0.012);

    context.fillStyle = shade(furRgb, 0.8 * tone);
    fillTube([[-0.17, -0.02], [-0.25, -0.06 + Math.sin(seconds * 6) * 0.02], [-0.3, -0.03 + Math.sin(seconds * 6 - 1) * 0.03]], [0.06, 0.06, 0.02]);
    drawGallop(seconds, "far", far, shade(INK, 1.4));
    const head = drawHound(body);

    context.fillStyle = shade(smoke, 0.75 * tone);
    const puffs = [[0.16, -0.06, 0.06], [0.1, -0.1, 0.07], [0.02, -0.1, 0.07], [-0.06, -0.09, 0.06], [-0.13, -0.065, 0.045]];
    puffs.forEach(([x, y, radius], index) => {
      const sway = Math.sin(seconds * 5 + index * 1.3) * 0.01;
      fillEllipse(x, y + sway, radius, radius * 0.7);
      fillPolygon([[x - radius * 0.5, y + sway - radius * 0.4], [x - radius * 1.1, y - radius * 1.1 + sway * 2], [x + radius * 0.2, y + sway - radius * 0.6]]);
    });
    context.fillStyle = shade(smoke, 1.05 * tone);
    puffs.forEach(([x, y, radius], index) => fillEllipse(x + 0.01, y - radius * 0.3 + Math.sin(seconds * 5 + index * 1.3) * 0.01, radius * 0.5, radius * 0.35));

    context.fillStyle = shade(pale, tone);
    [0, 1, 2].forEach((tuft) => fillPolygon([[head[0] + 0.02 + tuft * 0.02, head[1] + 0.02], [head[0] - 0.02 + tuft * 0.015, head[1] + 0.08 + tuft * 0.005], [head[0] + 0.04 + tuft * 0.02, head[1] + 0.025]]));
    context.fillStyle = shade(gold, tone);
    fillPolygon([[head[0] - 0.02, head[1] - 0.035], [head[0] + 0.09, head[1] - 0.03], [head[0] + 0.11, head[1] - 0.005], [head[0] + 0.03, head[1] - 0.005]]);
    [[0, 0.1], [0.025, 0.12], [0.05, 0.09]].forEach(([x, rise]) => fillPolygon([[head[0] + x - 0.012, head[1] - 0.04], [head[0] + x - 0.03, head[1] - 0.04 - rise], [head[0] + x + 0.015, head[1] - 0.04]]));
    drawEye([head[0] + 0.05, head[1] - 0.018], palette.fire[1]);
    context.fillStyle = ink;
    context.fillRect(head[0] + 0.1, head[1] + 0.012, 0.02, 0.006);

    drawGallop(seconds, "near", body, shade(INK, 1.6));
    if (Math.random() < 0.7) {
      const ember = toDevice([(Math.random() - 0.4) * 0.3, -0.13 + Math.random() * 0.04]);
      emit(layer, ember, [(Math.random() - 0.5) * 25, -15 - Math.random() * 30], palette.fire[Math.floor(Math.random() * 3)], 0.5 + Math.random() * 0.5, 1.5 + Math.random() * 2.5);
    }
  }

  function drawSuicune(seconds, tone, pass, layer) {
    const fur = rgbOf(palette.ice[1]), pale = rgbOf(palette.ice[0]), mane = rgbOf(palette.dragon);
    const body = shade(fur, 0.95 * tone), far = shade(fur, 0.6 * tone);
    context.translate(0, Math.cos(seconds * 8) * 0.012);

    [-0.02, 0.03].forEach((spread, ribbon) => {
      const streamer = Array.from({ length: 18 }, (_, index) => {
        const along = index / 17;
        return [-0.16 - along * 0.7, -0.02 + spread * along * 2 + Math.sin(seconds * 3 - along * 5 + ribbon * 1.4) * 0.06 * along];
      });
      context.fillStyle = shade(pale, (ribbon === 0 ? 0.75 : 0.95) * tone);
      fillTube(streamer, taper(18, 0.045, 0.012));
    });
    drawGallop(seconds, "far", far, shade(pale, 0.6 * tone));
    const head = drawHound(body);

    context.fillStyle = shade(pale, tone);
    [[-0.1, -0.01], [-0.03, 0.02], [0.04, -0.015], [-0.12, 0.03], [0.06, 0.025]].forEach(([x, y]) => fillPolygon([[x, y - 0.022], [x + 0.016, y], [x, y + 0.022], [x - 0.016, y]]));

    [0, 1, 2].forEach((ribbon) => {
      const streamer = Array.from({ length: 16 }, (_, index) => {
        const along = index / 15;
        return [head[0] - 0.02 - along * (0.5 + ribbon * 0.08), head[1] - 0.03 + along * (0.02 + ribbon * 0.05) + Math.sin(seconds * 3.4 - along * 5 + ribbon) * 0.04 * along];
      });
      context.fillStyle = shade(mane, (0.65 + ribbon * 0.15) * tone);
      fillTube(streamer, taper(16, 0.05, 0.008));
    });
    context.fillStyle = shade(pale, tone);
    fillPolygon([[head[0] + 0.07, head[1] + 0.005], [head[0] + 0.12, head[1] + 0.012], [head[0] + 0.115, head[1] + 0.03], [head[0] + 0.05, head[1] + 0.03]]);
    const crest = [[0.02, -0.04], [0.05, -0.06], [0.04, -0.13], [0.0, -0.17], [-0.02, -0.1], [-0.01, -0.05]].map(([x, y]) => [head[0] + x, head[1] + y]);
    fillPolygon(crest);
    context.strokeStyle = shade(rgbOf(palette.ice[2]), tone);
    context.lineWidth = 0.008;
    context.stroke();
    drawEye([head[0] + 0.05, head[1] - 0.02], palette.fire[2]);

    drawGallop(seconds, "near", body, shade(pale, tone));
    if (Math.random() < 0.5) {
      const drop = toDevice([-0.2 - Math.random() * 0.4, Math.random() * 0.1]);
      emit(layer, drop, [(Math.random() - 0.5) * 12, 5 + Math.random() * 12], palette.ice[Math.floor(Math.random() * 2)], 0.8 + Math.random() * 0.8, 1.5 + Math.random() * 2, 15, Math.random() < 0.4 ? "bubble" : "flake");
    }
  }

  function drawCelebi(seconds, tone, pass, layer) {
    const green = rgbOf(palette.scales), pale = rgbOf(palette.ice[0]), blue = rgbOf(palette.ice[2]);
    context.translate(0, Math.sin(seconds * 6) * 0.02);
    context.rotate(Math.sin(seconds * 3) * 0.1);

    const buzz = 0.35 + 0.65 * Math.abs(Math.sin(seconds * 42));
    context.globalAlpha = 0.55;
    context.fillStyle = shade(pale, tone);
    [[-0.5, 0.16], [-0.85, 0.12]].forEach(([angle, length]) => {
      context.save();
      context.translate(-0.03, -0.02);
      context.rotate(angle);
      context.scale(1, buzz);
      fillEllipse(0, -length, length * 0.38, length);
      context.restore();
    });
    context.globalAlpha = 1;

    context.fillStyle = shade(green, 1.15 * tone);
    fillTube([[-0.02, 0.1], [-0.03, 0.15]], [0.035, 0.025]);
    fillTube([[0.02, 0.1], [0.03, 0.15]], [0.035, 0.025]);
    fillEllipse(0, 0.06, 0.055, 0.065);
    fillTube([[0.03, 0.04], [0.08, 0.07]], [0.025, 0.016]);

    const head = [0.03, -0.08];
    fillEllipse(head[0], head[1], 0.11, 0.1);
    fillPolygon([[head[0] - 0.08, head[1] - 0.06], [head[0] - 0.17, head[1] - 0.2 + Math.sin(seconds * 4) * 0.015], [head[0] - 0.02, head[1] - 0.1]]);
    context.fillStyle = shade(green, 0.75 * tone);
    [0, 1].forEach((antenna) => {
      const tip = [head[0] + 0.06 + antenna * 0.04, head[1] - 0.2 + antenna * 0.01 + Math.sin(seconds * 5 + antenna) * 0.01];
      fillTube(quadraticPoints([head[0] + 0.02 + antenna * 0.02, head[1] - 0.09], [head[0] + 0.02 + antenna * 0.03, head[1] - 0.16], tip, 5), taper(5, 0.012, 0.008));
      context.fillStyle = shade(blue, tone);
      fillEllipse(tip[0], tip[1], 0.016, 0.014);
      context.fillStyle = shade(green, 0.75 * tone);
    });
    context.fillStyle = shade(INK, 1);
    fillEllipse(head[0] + 0.06, head[1] + 0.005, 0.042, 0.05, 0.15);
    context.fillStyle = shade(blue, 1.1 * tone);
    fillEllipse(head[0] + 0.062, head[1] + 0.008, 0.03, 0.038, 0.15);
    context.fillStyle = "#fff";
    fillEllipse(head[0] + 0.07, head[1] - 0.012, 0.012, 0.014);

    if (Math.random() < 0.7) {
      const glint = toDevice([-0.08 + (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.15]);
      emit(layer, glint, [(Math.random() - 0.5) * 15, (Math.random() - 0.5) * 15], Math.random() < 0.5 ? palette.scales : palette.ice[0], 0.8 + Math.random() * 0.8, 2 + Math.random() * 2, 8, "star");
    }
  }

  // Jirachi: a three-point star hat with a wish tag hanging from each point, a sleepy face, and two long streamers.
  function drawJirachi(seconds, tone, pass, layer) {
    const gold = rgbOf(palette.fire[0]), pale = rgbOf(palette.ice[0]), tagColor = rgbOf(palette.ice[1]);
    context.translate(0, Math.sin(seconds * 2) * 0.025);

    [-1, 1].forEach((side, index) => {
      const streamer = Array.from({ length: 16 }, (_, step) => {
        const along = step / 15;
        return [-0.04 - along * 0.55, 0.06 + side * along * 0.08 + Math.sin(seconds * 2.6 - along * 5 + index * 1.5) * 0.05 * along];
      });
      context.fillStyle = shade(gold, (index === 0 ? 0.6 : 0.85) * tone);
      fillTube(streamer, taper(16, 0.03, 0.012));
    });

    context.fillStyle = shade(pale, tone);
    fillEllipse(0, 0.09, 0.05, 0.06);
    fillTube([[-0.015, 0.13], [-0.02, 0.18]], [0.03, 0.022]);
    fillTube([[0.02, 0.13], [0.025, 0.18]], [0.03, 0.022]);
    fillTube([[0.035, 0.07], [0.08, 0.09 + Math.sin(seconds * 3) * 0.02]], [0.024, 0.02]);
    context.fillStyle = shade(gold, tone);
    fillEllipse(0.08, 0.09 + Math.sin(seconds * 3) * 0.02, 0.014, 0.014);

    const face = [0.01, -0.01];
    const points = [-Math.PI / 2 - 1.05, -Math.PI / 2, -Math.PI / 2 + 1.05];
    const around = (angle, reach) => [face[0] + Math.cos(angle) * reach, face[1] + Math.sin(angle) * reach];
    const star = [[face[0] - 0.07, face[1] + 0.03]];
    points.forEach((angle) => star.push(around(angle - 0.52, 0.075), around(angle, 0.17)));
    star.push(around(points[2] + 0.52, 0.075), [face[0] + 0.07, face[1] + 0.03]);
    context.fillStyle = shade(gold, tone);
    fillPolygon(star);
    context.fillStyle = shade(pale, tone);
    fillEllipse(face[0], face[1] + 0.012, 0.065, 0.055);
    context.strokeStyle = shade(INK, 1);
    context.lineWidth = 0.008;
    [-0.025, 0.025].forEach((x) => {
      context.beginPath();
      context.arc(face[0] + x, face[1] + 0.005, 0.014, 0.2, Math.PI - 0.2);
      context.stroke();
    });
    points.forEach((angle, index) => {
      const tip = [face[0] + Math.cos(angle) * 0.17, face[1] + Math.sin(angle) * 0.17];
      const swing = Math.sin(seconds * 3 + index * 2) * 0.25;
      const hang = [tip[0] + Math.sin(swing) * 0.06, tip[1] + Math.cos(swing) * 0.06];
      context.strokeStyle = shade(pale, 0.8 * tone);
      context.lineWidth = 0.006;
      context.beginPath();
      context.moveTo(tip[0], tip[1]);
      context.lineTo(hang[0], hang[1]);
      context.stroke();
      context.save();
      context.translate(hang[0], hang[1]);
      context.rotate(-swing);
      context.fillStyle = shade(tagColor, tone);
      context.fillRect(-0.018, 0, 0.036, 0.055);
      context.restore();
    });

    if (Math.random() < 0.45) {
      const glint = toDevice([-0.1 - Math.random() * 0.4, 0.05 + (Math.random() - 0.5) * 0.12]);
      emit(layer, glint, [(Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10], Math.random() < 0.7 ? palette.fire[0] : palette.ice[0], 1 + Math.random(), 2.5 + Math.random() * 3, 0, "star");
    }
  }

  // Kyogre swims through the air like the sea: a broad blue body, red sea lines, four paddling fins, and bubbles.
  function drawKyogre(seconds, tone, pass, layer) {
    const blue = rgbOf(palette.ice[2]), pale = rgbOf(palette.ice[0]), red = rgbOf(palette.fire[2]), gold = rgbOf(palette.fire[0]);
    const body = shade(blue, 0.95 * tone), far = shade(blue, 0.6 * tone), lines = shade(red, tone);
    const paddle = Math.sin(seconds * 3);
    const fin = (root, angle, scale, color, tipColor) => {
      context.save();
      context.translate(root[0], root[1]);
      context.rotate(angle);
      context.scale(scale, scale);
      context.fillStyle = color;
      fillPolygon([[0.05, -0.02], [0.03, 0.12], [-0.06, 0.24], [-0.26, 0.26], [-0.2, 0.1], [-0.06, -0.02]]);
      context.fillStyle = tipColor;
      fillPolygon([[-0.06, 0.24], [-0.26, 0.26], [-0.235, 0.2], [-0.2, 0.23], [-0.16, 0.19], [-0.12, 0.22], [-0.08, 0.2]]);
      context.fillStyle = lines;
      fillTube([[0.0, 0.02], [-0.04, 0.1], [-0.12, 0.17]], [0.014, 0.012, 0.006]);
      context.restore();
    };
    fin([0.1, 0.05], 0.1 + paddle * 0.35, 1, far, shade(pale, 0.6 * tone));
    fin([-0.12, 0.05], 0.1 - paddle * 0.35, 0.8, far, shade(pale, 0.6 * tone));

    const sway = Math.sin(seconds * 3 - 1.2) * 0.04;
    context.fillStyle = body;
    fillPolygon([[-0.28, -0.02], [-0.44, -0.12 + sway], [-0.4, -0.01 + sway], [-0.46, 0.1 + sway], [-0.28, 0.04]]);
    fillEllipse(0, 0, 0.3, 0.13);
    fillEllipse(0.18, -0.01, 0.14, 0.115);
    context.save();
    context.beginPath();
    context.ellipse(0, 0, 0.3, 0.13, 0, 0, Math.PI * 2);
    context.ellipse(0.18, -0.01, 0.14, 0.115, 0, 0, Math.PI * 2);
    context.clip();
    context.fillStyle = shade(pale, 0.9 * tone);
    fillEllipse(0.04, 0.13, 0.32, 0.075);
    context.fillStyle = shade(INK, 1.2);
    fillPolygon([[0.32, 0.02], [0.18, 0.045], [0.05, 0.05], [0.18, 0.06], [0.32, 0.04]]);
    context.restore();

    context.fillStyle = lines;
    fillTube([[0.26, -0.06], [0.2, -0.07], [0.14, -0.04], [0.15, 0.0]], [0.016, 0.014, 0.014, 0.008]);
    fillTube([[0.08, -0.1], [-0.05, -0.08], [-0.14, -0.04], [-0.24, -0.03]], [0.006, 0.018, 0.016, 0.006]);
    fillTube([[0.06, 0.03], [-0.06, 0.04], [-0.2, 0.03]], [0.006, 0.016, 0.006]);
    context.fillStyle = shade(gold, tone);
    fillEllipse(0.25, -0.04, 0.022, 0.016, -0.2);
    context.fillStyle = shade(INK, 1);
    fillEllipse(0.255, -0.04, 0.009, 0.012);

    fin([0.12, 0.07], 0.2 - paddle * 0.4, 1.1, body, shade(pale, tone));
    fin([-0.1, 0.07], 0.2 + paddle * 0.4, 0.9, body, shade(pale, tone));

    if (Math.random() < 0.35) {
      const bubble = toDevice([0.3 - Math.random() * 0.7, (Math.random() - 0.5) * 0.2]);
      emit(layer, bubble, [(Math.random() - 0.5) * 10, -12 - Math.random() * 20], palette.ice[Math.floor(Math.random() * 2)], 1.2 + Math.random() * 1.2, 3 + Math.random() * 5, -6, "bubble");
    }
    if (Math.random() < 0.3) {
      const drip = toDevice([(Math.random() - 0.5) * 0.4, 0.12]);
      emit(layer, drip, [(Math.random() - 0.5) * 8, 10 + Math.random() * 10], palette.ice[1], 0.8 + Math.random() * 0.6, 1.5 + Math.random() * 1.5, 60);
    }
  }

  // Groudon doesn't fly: it leaps across in a big arc, arms out, raining lava.
  function drawGroudon(seconds, tone, pass, layer) {
    const red = rgbOf(palette.fire[2]), gold = rgbOf(palette.fire[0]), stone = rgbOf(palette.dim), pale = rgbOf(palette.ice[0]);
    const body = shade(red, 0.9 * tone), far = shade(red, 0.55 * tone), ink = shade(INK, 1), plate = shade(stone, 0.9 * tone);
    const rise = pass.progress < 0.5;
    const kick = Math.sin(seconds * 2.5) * 0.08;

    context.fillStyle = far;
    fillTube([[0.06, 0.0], [0.15, rise ? -0.05 : 0.06], [0.22, rise ? -0.08 : 0.1]], [0.07, 0.06, 0.05]);
    drawLeg([-0.05, 0.1], rise ? -0.6 + kick : 0.3 + kick, rise ? 0.4 : -0.3, 0.09, 0.08, far, plate);

    const tail = Array.from({ length: 12 }, (_, index) => {
      const along = index / 11;
      return [-0.1 - along * 0.38, 0.06 + along * 0.08 + Math.sin(seconds * 2 - along * 3) * 0.03 * along];
    });
    context.fillStyle = body;
    fillTube(tail, taper(12, 0.13, 0.02));
    context.fillStyle = plate;
    [2, 4, 6, 8].forEach((index) => {
      const [x, y] = tail[index];
      const height = 0.06 * (1 - index / 12);
      fillPolygon([[x + 0.03, y - height * 0.5], [x - 0.01, y - height * 1.6], [x - 0.03, y - height * 0.4]]);
    });

    context.fillStyle = body;
    fillEllipse(0, 0.02, 0.17, 0.14, -0.2);
    context.fillStyle = shade(red, 0.75 * tone);
    fillEllipse(0.05, 0.06, 0.1, 0.08, -0.2);
    context.fillStyle = plate;
    fillPolygon([[-0.12, -0.08], [-0.02, -0.15], [0.06, -0.12], [0.0, -0.06], [-0.1, -0.03]]);
    [[-0.08, -0.1], [-0.02, -0.14], [0.04, -0.13]].forEach(([x, y]) => fillPolygon([[x - 0.02, y + 0.01], [x - 0.03, y - 0.06], [x + 0.02, y]]));
    context.fillStyle = ink;
    fillTube([[-0.06, 0.06], [-0.1, 0.01], [-0.06, -0.04]], [0.012, 0.012, 0.006]);
    fillTube([[0.1, 0.1], [0.04, 0.04], [0.08, -0.02]], [0.006, 0.012, 0.006]);

    const head = [0.15, -0.12];
    context.fillStyle = body;
    fillTube([[0.08, -0.06], [head[0], head[1]]], [0.1, 0.08]);
    fillPolygon([[-0.04, -0.03], [0.04, -0.045], [0.1, -0.02], [0.1, 0.02], [0.02, 0.035], [-0.04, 0.03]].map(([x, y]) => [head[0] + x, head[1] + y]));
    context.fillStyle = plate;
    fillPolygon([[head[0] - 0.01, head[1] + 0.0], [head[0] - 0.1, head[1] - 0.05], [head[0] - 0.06, head[1] + 0.025]]);
    fillPolygon([[head[0] - 0.005, head[1] + 0.025], [head[0] - 0.09, head[1] + 0.045], [head[0] - 0.03, head[1] + 0.045]]);
    drawEye([head[0] + 0.035, head[1] - 0.012], shade(gold, 1.1));
    context.fillStyle = ink;
    context.fillRect(head[0] + 0.05, head[1] + 0.015, 0.05, 0.005);

    drawLeg([0.0, 0.11], rise ? -0.4 - kick : 0.5 - kick, rise ? 0.5 : -0.4, 0.09, 0.085, body, plate);
    context.fillStyle = body;
    const hand = [0.24, rise ? -0.04 : 0.1];
    fillTube([[0.08, 0.02], [0.17, rise ? -0.01 : 0.07], hand], [0.075, 0.065, 0.055]);
    context.fillStyle = shade(pale, tone);
    [-0.02, 0, 0.02].forEach((spread) => fillPolygon([[hand[0], hand[1] + spread - 0.01], [hand[0] + 0.055, hand[1] + spread * 1.5], [hand[0], hand[1] + spread + 0.01]]));

    if (Math.random() < 0.75) {
      const drop = toDevice([(Math.random() - 0.5) * 0.35, 0.08 + Math.random() * 0.08]);
      emit(layer, drop, [(Math.random() - 0.5) * 30, 10 + Math.random() * 30], palette.fire[Math.floor(Math.random() * 3)], 0.6 + Math.random() * 0.6, 2 + Math.random() * 3, 120);
    }
    if (Math.random() < 0.3) {
      const ember = toDevice([(Math.random() - 0.5) * 0.3, -0.1]);
      emit(layer, ember, [(Math.random() - 0.5) * 20, -20 - Math.random() * 20], palette.fire[0], 0.4 + Math.random() * 0.4, 1.5 + Math.random() * 1.5);
    }
  }

  // A drift of Unown: a word in a row, or a few letters scattered. Each bobs, sways, and blinks its one eye.
  function unownFormation(pass) {
    const spelled = Math.random() < 0.55;
    const word = spelled ? pickOf(UNOWN_WORDS) : Array.from({ length: 3 + Math.floor(Math.random() * 4) }, () => pickOf(UNOWN_GLYPHS)).join("");
    pass.glyphs = Array.from(word, (letter) => ({
      letter,
      phase: Math.random() * Math.PI * 2,
      offsetX: spelled ? 0 : (Math.random() - 0.5) * 0.12,
      offsetY: spelled ? 0 : (Math.random() - 0.5) * 0.5,
      blinkAt: Math.random() * 5,
    }));
    pass.reach = word.length * 0.11 + 0.3;
  }

  function drawUnown(seconds, tone, pass) {
    const count = pass.glyphs.length, spacing = 0.21;
    const rim = shade(rgbOf(palette.dim), 1.1 * tone), ink = shade(INK, tone);
    pass.glyphs.forEach((glyph, index) => {
      if (glyph.letter === " ") return;
      const x = (index - (count - 1) / 2) * spacing * pass.direction + glyph.offsetX;
      const y = glyph.offsetY + Math.sin(seconds * 2.4 + glyph.phase) * 0.04;
      context.save();
      context.translate(x, y);
      context.scale(pass.direction, 1);
      context.rotate(Math.sin(seconds * 1.7 + glyph.phase) * 0.2);
      context.scale(0.01, 0.01);
      context.font = "900 22px sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.lineJoin = "round";
      context.lineWidth = 4;
      context.strokeStyle = rim;
      context.strokeText(glyph.letter, 0, 1);
      context.fillStyle = ink;
      context.fillText(glyph.letter, 0, 1);
      const blink = (seconds + glyph.blinkAt) % 5 < 0.15 ? 0.15 : 1;
      context.fillStyle = shade(rgbOf(palette.ice[0]), tone);
      fillEllipse(0, 0, 4.6, 4.6 * blink);
      context.fillStyle = ink;
      fillEllipse(0.8, 0, 2.2, 2.2 * blink);
      context.restore();
    });
  }
`;
