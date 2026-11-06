import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";

// Reads every logos/*.svg and logos/*.png and writes src/orbitLogos.ts: each logo's fill rule and its outlines flattened to polygons,
// centered and scaled so the longest side is 1 (SVG y-down). The Core view extrudes the polygons into solids. Run `npm run logos` after adding one.
// A PNG is traced: dark, opaque pixels are the logo; light or transparent ones are background. Use 8-bit, non-interlaced.
// SVG supports path, polygon, polyline, rect, circle, and ellipse. A transform anywhere fails the run: flatten it first
// (Inkscape: Path > Object to Path, then save as Plain SVG).

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const logoDirectory = path.join(root, "logos");
const outputFile = path.join(root, "src", "orbitLogos.ts");

const attribute = (tag, name) => tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`))?.[1];
const number = (tag, name, fallback = 0) => Number(attribute(tag, name) ?? fallback);

function shapePath(tag) {
  const element = tag.match(/^<\s*([a-zA-Z]+)/)[1].toLowerCase();
  switch (element) {
    case "path":
      return attribute(tag, "d")?.replace(/\s+/g, " ").trim();
    case "polygon":
    case "polyline": {
      const coordinates = (attribute(tag, "points") ?? "").trim().split(/[\s,]+/).map(Number);
      const pairs = [];
      for (let index = 0; index + 1 < coordinates.length; index += 2) pairs.push(`${coordinates[index]},${coordinates[index + 1]}`);
      return pairs.length > 0 ? `M${pairs.join("L")}${element === "polygon" ? "Z" : ""}` : undefined;
    }
    case "rect": {
      const [x, y, width, height] = ["x", "y", "width", "height"].map((name) => number(tag, name));
      return `M${x},${y}h${width}v${height}h${-width}Z`;
    }
    case "circle":
    case "ellipse": {
      const [cx, cy] = [number(tag, "cx"), number(tag, "cy")];
      const rx = number(tag, element === "circle" ? "r" : "rx");
      const ry = number(tag, element === "circle" ? "r" : "ry");
      return `M${cx - rx},${cy}a${rx},${ry} 0 1,0 ${rx * 2},0a${rx},${ry} 0 1,0 ${-rx * 2},0Z`;
    }
    default:
      return undefined;
  }
}

const TOKEN = /[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

// Flattens one SVG path into closed polygons. Curves and arcs become line runs about `tolerance` long.
function flattenPath(d, tolerance) {
  const tokens = d.match(TOKEN) ?? [];
  const contours = [];
  let contour = [];
  let index = 0;
  let command;
  let x = 0, y = 0, startX = 0, startY = 0;
  let control = null;
  const isCommand = (token) => /^[a-zA-Z]$/.test(token);
  const next = () => Number(tokens[index++]);
  const add = (pointX, pointY) => { contour.push([pointX, pointY]); x = pointX; y = pointY; };
  const steps = (length) => Math.max(2, Math.min(48, Math.ceil(length / tolerance)));
  const finish = () => { if (contour.length > 0) contours.push(contour); contour = []; };

  while (index < tokens.length) {
    if (isCommand(tokens[index])) command = tokens[index++];
    else if (command === undefined) break;
    const relative = command === command.toLowerCase();
    const offsetX = relative ? x : 0, offsetY = relative ? y : 0;
    switch (command.toUpperCase()) {
      case "M": {
        finish();
        const pointX = next() + offsetX, pointY = next() + offsetY;
        startX = pointX; startY = pointY;
        add(pointX, pointY);
        command = relative ? "l" : "L";
        control = null;
        break;
      }
      case "L": add(next() + offsetX, next() + offsetY); control = null; break;
      case "H": add(next() + offsetX, y); control = null; break;
      case "V": add(x, next() + offsetY); control = null; break;
      case "C":
      case "S": {
        const smooth = command.toUpperCase() === "S";
        const [c1x, c1y] = smooth ? (control?.cubic ? [2 * x - control.x, 2 * y - control.y] : [x, y]) : [next() + offsetX, next() + offsetY];
        const c2x = next() + offsetX, c2y = next() + offsetY, endX = next() + offsetX, endY = next() + offsetY;
        const [fromX, fromY] = [x, y];
        const count = steps(Math.hypot(c1x - fromX, c1y - fromY) + Math.hypot(c2x - c1x, c2y - c1y) + Math.hypot(endX - c2x, endY - c2y));
        for (let step = 1; step <= count; step++) {
          const t = step / count, u = 1 - t;
          add(u * u * u * fromX + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * endX,
            u * u * u * fromY + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * endY);
        }
        control = { x: c2x, y: c2y, cubic: true };
        break;
      }
      case "Q":
      case "T": {
        const smooth = command.toUpperCase() === "T";
        const [cx, cy] = smooth ? (control?.quadratic ? [2 * x - control.x, 2 * y - control.y] : [x, y]) : [next() + offsetX, next() + offsetY];
        const endX = next() + offsetX, endY = next() + offsetY;
        const [fromX, fromY] = [x, y];
        const count = steps(Math.hypot(cx - fromX, cy - fromY) + Math.hypot(endX - cx, endY - cy));
        for (let step = 1; step <= count; step++) {
          const t = step / count, u = 1 - t;
          add(u * u * fromX + 2 * u * t * cx + t * t * endX, u * u * fromY + 2 * u * t * cy + t * t * endY);
        }
        control = { x: cx, y: cy, quadratic: true };
        break;
      }
      case "A": {
        let radiusX = Math.abs(next()), radiusY = Math.abs(next());
        const rotation = (next() * Math.PI) / 180, largeArc = next() !== 0, sweep = next() !== 0;
        const endX = next() + offsetX, endY = next() + offsetY;
        flattenArc(x, y, radiusX, radiusY, rotation, largeArc, sweep, endX, endY, steps).forEach(([pointX, pointY]) => add(pointX, pointY));
        control = null;
        break;
      }
      case "Z":
        x = startX; y = startY;
        finish();
        control = null;
        break;
      default:
        index++;
    }
  }
  finish();
  return contours;
}

// SVG arc endpoint form to points, per the SVG spec's center parameterization.
function flattenArc(fromX, fromY, radiusX, radiusY, rotation, largeArc, sweep, endX, endY, steps) {
  if (radiusX === 0 || radiusY === 0) return [[endX, endY]];
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  const halfX = (fromX - endX) / 2, halfY = (fromY - endY) / 2;
  const primeX = cos * halfX + sin * halfY, primeY = -sin * halfX + cos * halfY;
  const lambda = (primeX * primeX) / (radiusX * radiusX) + (primeY * primeY) / (radiusY * radiusY);
  if (lambda > 1) { radiusX *= Math.sqrt(lambda); radiusY *= Math.sqrt(lambda); }
  const numerator = radiusX * radiusX * radiusY * radiusY - radiusX * radiusX * primeY * primeY - radiusY * radiusY * primeX * primeX;
  const denominator = radiusX * radiusX * primeY * primeY + radiusY * radiusY * primeX * primeX;
  const factor = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / denominator));
  const centerPrimeX = (factor * radiusX * primeY) / radiusY, centerPrimeY = (-factor * radiusY * primeX) / radiusX;
  const centerX = cos * centerPrimeX - sin * centerPrimeY + (fromX + endX) / 2;
  const centerY = sin * centerPrimeX + cos * centerPrimeY + (fromY + endY) / 2;
  const angleOf = (vectorX, vectorY) => Math.atan2(vectorY, vectorX);
  const startAngle = angleOf((primeX - centerPrimeX) / radiusX, (primeY - centerPrimeY) / radiusY);
  let delta = angleOf((-primeX - centerPrimeX) / radiusX, (-primeY - centerPrimeY) / radiusY) - startAngle;
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  if (sweep && delta < 0) delta += Math.PI * 2;
  const count = steps(Math.abs(delta) * Math.max(radiusX, radiusY));
  return Array.from({ length: count }, (_, step) => {
    const angle = startAngle + (delta * (step + 1)) / count;
    const ellipseX = radiusX * Math.cos(angle), ellipseY = radiusY * Math.sin(angle);
    return [cos * ellipseX - sin * ellipseY + centerX, sin * ellipseX + cos * ellipseY + centerY];
  });
}

// Drops points closer than `tolerance` to the last kept one, and the closing duplicate.
function simplify(contour, tolerance) {
  const kept = [];
  contour.forEach((point) => {
    const last = kept[kept.length - 1];
    if (last === undefined || Math.hypot(point[0] - last[0], point[1] - last[1]) >= tolerance) kept.push(point);
  });
  while (kept.length > 1 && Math.hypot(kept[0][0] - kept[kept.length - 1][0], kept[0][1] - kept[kept.length - 1][1]) < tolerance) kept.pop();
  return kept;
}

function readLogo(file) {
  const name = path.basename(file, ".svg");
  const svg = fs.readFileSync(file, "utf8").replace(/<!--[\s\S]*?-->/g, "").replace(/<(defs|clipPath|mask|style)[\s\S]*?<\/\1>/g, "");
  if (/\stransform\s*=/.test(svg)) {
    throw new Error(`${name}.svg has a transform. Flatten it (Path > Object to Path, save as Plain SVG) and run again.`);
  }
  const svgTag = svg.match(/<svg[^>]*>/)?.[0];
  if (svgTag === undefined) throw new Error(`${name}.svg has no <svg> tag.`);
  const viewBox = attribute(svgTag, "viewBox")?.trim().split(/[\s,]+/).map(Number)
    ?? [0, 0, number(svgTag, "width"), number(svgTag, "height")];
  if (viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value)) || viewBox[2] <= 0 || viewBox[3] <= 0) {
    throw new Error(`${name}.svg needs a viewBox or a numeric width and height.`);
  }
  const paths = (svg.match(/<(path|polygon|polyline|rect|circle|ellipse)\b[^>]*>/g) ?? [])
    .filter((tag) => attribute(tag, "fill") !== "none")
    .map(shapePath)
    .filter(Boolean);
  if (paths.length === 0) throw new Error(`${name}.svg has no filled shapes.`);
  const fillRule = /fill-rule\s*[:=]\s*["']?evenodd/.test(svg) ? "evenodd" : "nonzero";
  const [minX, minY, viewWidth, viewHeight] = viewBox;
  const longest = Math.max(viewWidth, viewHeight);
  const tolerance = longest * 0.006;
  const centerX = minX + viewWidth / 2, centerY = minY + viewHeight / 2;
  const round = (value) => Math.round(value * 10000) / 10000;
  const contours = paths
    .flatMap((outline) => flattenPath(outline, tolerance))
    .map((contour) => simplify(contour, tolerance))
    .filter((contour) => contour.length >= 3)
    .map((contour) => contour.flatMap(([pointX, pointY]) => [round((pointX - centerX) / longest), round((pointY - centerY) / longest)]));
  return { name, fillRule, contours };
}

// Decodes an 8-bit, non-interlaced PNG to RGBA.
function decodePng(file) {
  const bytes = fs.readFileSync(file);
  const name = path.basename(file);
  let offset = 8;
  let header;
  let palette = Buffer.alloc(0), transparency = Buffer.alloc(0);
  const data = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") header = { width: chunk.readUInt32BE(0), height: chunk.readUInt32BE(4), depth: chunk[8], colorType: chunk[9], interlace: chunk[12] };
    else if (type === "PLTE") palette = chunk;
    else if (type === "tRNS") transparency = chunk;
    else if (type === "IDAT") data.push(chunk);
    offset += length + 12;
  }
  const { width, height, depth, colorType, interlace } = header;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (depth !== 8 || interlace !== 0 || channels === undefined) throw new Error(`${name} must be an 8-bit, non-interlaced PNG.`);
  const raw = zlib.inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row++) {
    const filter = raw[row * (stride + 1)];
    for (let column = 0; column < stride; column++) {
      const value = raw[row * (stride + 1) + 1 + column];
      const left = column >= channels ? pixels[row * stride + column - channels] : 0;
      const above = row > 0 ? pixels[(row - 1) * stride + column] : 0;
      const aboveLeft = row > 0 && column >= channels ? pixels[(row - 1) * stride + column - channels] : 0;
      const paeth = () => {
        const estimate = left + above - aboveLeft;
        const [toLeft, toAbove, toAboveLeft] = [left, above, aboveLeft].map((candidate) => Math.abs(estimate - candidate));
        return toLeft <= toAbove && toLeft <= toAboveLeft ? left : toAbove <= toAboveLeft ? above : aboveLeft;
      };
      const predictor = [0, left, above, (left + above) >> 1, filter === 4 ? paeth() : 0][filter];
      pixels[row * stride + column] = (value + predictor) & 0xff;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const source = pixels.subarray(pixel * channels, pixel * channels + channels);
    const color = colorType === 3
      ? [palette[source[0] * 3], palette[source[0] * 3 + 1], palette[source[0] * 3 + 2], source[0] < transparency.length ? transparency[source[0]] : 255]
      : colorType === 0 ? [source[0], source[0], source[0], 255]
      : colorType === 4 ? [source[0], source[0], source[0], source[1]]
      : colorType === 2 ? [source[0], source[1], source[2], 255]
      : [source[0], source[1], source[2], source[3]];
    rgba.set(color, pixel * 4);
  }
  return { width, height, rgba };
}

// Douglas-Peucker on an open run of points.
function simplifyRun(points, tolerance) {
  if (points.length < 3) return points;
  const [first, last] = [points[0], points[points.length - 1]];
  const length = Math.hypot(last[0] - first[0], last[1] - first[1]) || 1;
  let farthest = 0, farthestIndex = 0;
  for (let index = 1; index < points.length - 1; index++) {
    const distance = Math.abs((last[0] - first[0]) * (first[1] - points[index][1]) - (first[0] - points[index][0]) * (last[1] - first[1])) / length;
    if (distance > farthest) { farthest = distance; farthestIndex = index; }
  }
  if (farthest <= tolerance) return [first, last];
  return simplifyRun(points.slice(0, farthestIndex + 1), tolerance).slice(0, -1).concat(simplifyRun(points.slice(farthestIndex), tolerance));
}

// Traces a PNG's dark pixels into polygons: pixel-border edges linked into loops, staircases smoothed to edge
// midpoints, then Douglas-Peucker. Even-odd fill gives holes, so loop direction does not matter.
function tracePng(file) {
  const name = path.basename(file, ".png");
  const { width, height, rgba } = decodePng(file);
  const filled = (column, row) => {
    if (column < 0 || row < 0 || column >= width || row >= height) return false;
    const at = (row * width + column) * 4;
    return rgba[at + 3] >= 128 && 0.299 * rgba[at] + 0.587 * rgba[at + 1] + 0.114 * rgba[at + 2] < 128;
  };
  const vertexKey = (column, row) => row * (width + 1) + column;
  const outgoing = new Map();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const addEdge = (fromX, fromY, toX, toY) => {
    const key = vertexKey(fromX, fromY);
    if (!outgoing.has(key)) outgoing.set(key, []);
    outgoing.get(key).push([toX, toY]);
  };
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      if (!filled(column, row)) continue;
      minX = Math.min(minX, column); minY = Math.min(minY, row); maxX = Math.max(maxX, column + 1); maxY = Math.max(maxY, row + 1);
      if (!filled(column, row - 1)) addEdge(column, row, column + 1, row);
      if (!filled(column + 1, row)) addEdge(column + 1, row, column + 1, row + 1);
      if (!filled(column, row + 1)) addEdge(column + 1, row + 1, column, row + 1);
      if (!filled(column - 1, row)) addEdge(column, row + 1, column, row);
    }
  }
  if (outgoing.size === 0) throw new Error(`${name}.png has no dark pixels.`);
  const longest = Math.max(maxX - minX, maxY - minY);
  const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
  const tolerance = Math.max(0.75, longest * 0.0025);
  const round = (value) => Math.round(value * 10000) / 10000;
  const contours = [];
  for (const [startKey, targets] of outgoing) {
    while (targets.length > 0) {
      const loop = [[startKey % (width + 1), Math.floor(startKey / (width + 1))]];
      let next = targets.pop();
      while (vertexKey(next[0], next[1]) !== startKey) {
        loop.push(next);
        next = outgoing.get(vertexKey(next[0], next[1])).pop();
      }
      let area = 0;
      loop.forEach(([x, y], index) => { const [nextX, nextY] = loop[(index + 1) % loop.length]; area += x * nextY - nextX * y; });
      if (Math.abs(area) / 2 < 12) continue;
      const smoothed = loop.map(([x, y], index) => { const [nextX, nextY] = loop[(index + 1) % loop.length]; return [(x + nextX) / 2, (y + nextY) / 2]; });
      const half = Math.floor(smoothed.length / 2);
      const polygon = simplifyRun(smoothed.slice(0, half + 1), tolerance).slice(0, -1)
        .concat(simplifyRun(smoothed.slice(half).concat([smoothed[0]]), tolerance).slice(0, -1));
      if (polygon.length >= 3) contours.push(polygon.flatMap(([x, y]) => [round((x - centerX) / longest), round((y - centerY) / longest)]));
    }
  }
  return { name, fillRule: "evenodd", contours };
}

const files = fs.existsSync(logoDirectory)
  ? fs.readdirSync(logoDirectory).filter((file) => /\.(svg|png)$/.test(file)).sort().map((file) => path.join(logoDirectory, file))
  : [];
const logos = files.map((file) => (file.endsWith(".png") ? tracePng(file) : readLogo(file)));

fs.writeFileSync(outputFile, `// Generated by scripts/orbitLogos.mjs from logos/*.svg and logos/*.png. Run \`npm run logos\`; do not edit by hand.
export interface OrbitLogo {
  name: string;
  fillRule: "nonzero" | "evenodd";
  // Each contour is a closed polygon as flat [x0, y0, x1, y1, ...], centered, longest side 1, y down.
  contours: number[][];
}

export const ORBIT_LOGOS: OrbitLogo[] = ${JSON.stringify(logos, null, 2)};
`);
console.log(`Wrote ${logos.length} logo(s) to src/orbitLogos.ts: ${logos.map((logo) => `${logo.name} (${logo.contours.length} contours, ${logo.contours.reduce((sum, contour) => sum + contour.length / 2, 0)} points)`).join(", ") || "none"}`);
