// Pure: the Office view's floor plan for a size in tiles, and paths across it. Row 0 is the back wall with the door
// at its left end. Desk blocks repeat down the room: a row of desks in pairs, the seats below them, then an aisle.
// The bottom row holds the props (cooler, coffee, couch, plants), each with a tile to stand on above it.

export type OfficeSceneId = "office" | "serverRoom" | "forest" | "field" | "riverbed" | "cave" | "moon";

export const OFFICE_SCENES: readonly { id: OfficeSceneId; label: string }[] = [
  { id: "office", label: "Office" },
  { id: "serverRoom", label: "Server Room" },
  { id: "forest", label: "Forest" },
  { id: "field", label: "Field" },
  { id: "riverbed", label: "Riverbed" },
  { id: "cave", label: "Cave" },
  { id: "moon", label: "Moon" },
];

export function officeSceneId(value: unknown): OfficeSceneId {
  return OFFICE_SCENES.some((scene) => scene.id === value) ? (value as OfficeSceneId) : "office";
}

export type TileKind = "floor" | "wall" | "door" | "desk" | "seat" | "prop" | "couch";

export type PropKind =
  | "plant" | "cooler" | "coffee" | "couch" | "shelf" | "rack" | "vending"
  | "pine" | "campfire" | "stump" | "mushroom"
  | "hay" | "well" | "flowers" | "scarecrow"
  | "reeds" | "spring" | "boulder"
  | "stalagmite" | "crystal"
  | "moonRock" | "oxygen" | "dish" | "flag";

// Props a guy drinks from. Every scene has one, and the layout never skips them.
export const DRINK_PROPS: ReadonlySet<PropKind> = new Set<PropKind>(["cooler", "coffee", "vending", "campfire", "well", "spring", "oxygen"]);

export interface Point {
  x: number;
  y: number;
}

export interface Desk {
  // The desk tile; the seat is the tile below it.
  desk: Point;
  seat: Point;
}

// Two tiles wide: desk is the left desk tile and seat the left seat tile; you sit centered between the two seats.
export interface Station {
  desk: Point;
  seat: Point;
}

export const STATION_DESKS = 2;

export interface Prop {
  kind: PropKind;
  at: Point;
  // Where a guy stands to use it. Undefined for a couch, which you sit on.
  stand: Point | undefined;
}

export interface OfficeLayout {
  cols: number;
  rows: number;
  tiles: TileKind[][];
  door: Point;
  desks: Desk[];
  // Your own station: a desk pair in the middle of the room, joined into one. Sessions never get it. Undefined when
  // you're not in the room.
  station: Station | undefined;
  props: Prop[];
  couchSeats: Point[];
}

export const MIN_COLS = 8;
export const MIN_ROWS = 6;

const WALKABLE: ReadonlySet<TileKind> = new Set<TileKind>(["floor", "door", "seat", "couch"]);

// Bottom-row props from left to right, repeated to fill the row. Plants and racks pad the corners.
const SCENE_PROPS: Record<OfficeSceneId, { corner: PropKind; middle: PropKind[] }> = {
  office: { corner: "plant", middle: ["cooler", "coffee", "couch", "shelf", "plant"] },
  serverRoom: { corner: "rack", middle: ["vending", "cooler", "couch", "rack", "rack"] },
  forest: { corner: "pine", middle: ["campfire", "stump", "couch", "mushroom", "pine"] },
  field: { corner: "hay", middle: ["well", "flowers", "couch", "scarecrow", "flowers"] },
  riverbed: { corner: "reeds", middle: ["spring", "boulder", "couch", "reeds", "boulder"] },
  cave: { corner: "stalagmite", middle: ["campfire", "crystal", "couch", "mushroom", "stalagmite"] },
  moon: { corner: "moonRock", middle: ["oxygen", "dish", "couch", "flag", "moonRock"] },
};

export function buildOfficeLayout(requestedCols: number, requestedRows: number, sceneId: OfficeSceneId, withStation = false): OfficeLayout {
  const cols = Math.max(MIN_COLS, Math.floor(requestedCols));
  const rows = Math.max(MIN_ROWS, Math.floor(requestedRows));
  const tiles: TileKind[][] = Array.from({ length: rows }, (_, y) =>
    Array.from({ length: cols }, (): TileKind => (y === 0 ? "wall" : "floor")),
  );
  const door = { x: 0, y: 0 };
  tiles[door.y][door.x] = "door";

  const desks: Desk[] = [];
  // Column 0 and the last column stay open as corridors; every third column is a gap between desk pairs.
  for (let deskRow = 1; deskRow + 2 <= rows - 2; deskRow += 3) {
    for (let x = 1; x <= cols - 2; x++) {
      if ((x - 1) % 3 === 2) {
        continue;
      }
      tiles[deskRow][x] = "desk";
      tiles[deskRow + 1][x] = "seat";
      desks.push({ desk: { x, y: deskRow }, seat: { x, y: deskRow + 1 } });
    }
  }

  const station = withStation ? middleStation(desks, rows) : undefined;

  const props: Prop[] = [];
  const couchSeats: Point[] = [];
  const propRow = rows - 1;
  const { corner, middle } = SCENE_PROPS[sceneId];
  let middleIndex = 0;
  for (let x = 0; x < cols; x++) {
    const isCorner = x === 0 || x === cols - 1;
    let kind = isCorner ? corner : middle[middleIndex++ % middle.length];
    if (kind === "couch") {
      if (x + 1 >= cols - 1) {
        kind = corner;
      } else {
        tiles[propRow][x] = "couch";
        tiles[propRow][x + 1] = "couch";
        couchSeats.push({ x, y: propRow }, { x: x + 1, y: propRow });
        props.push({ kind: "couch", at: { x, y: propRow }, stand: undefined });
        x++;
        continue;
      }
    }
    // Leave every other middle tile open so the row doesn't read as a wall of stuff.
    if (!isCorner && x % 2 === 0 && !DRINK_PROPS.has(kind)) {
      continue;
    }
    tiles[propRow][x] = "prop";
    props.push({ kind, at: { x, y: propRow }, stand: { x, y: propRow - 1 } });
  }

  return { cols, rows, tiles, door, desks, station, props, couchSeats };
}

// Takes the desk pair nearest the middle of the room out of the desks, for your station: the desk row whose desk and
// seat straddle the room's middle best (the lower one on a tie), and the middle pair (left of center on a tie).
function middleStation(desks: Desk[], rows: number): Station | undefined {
  const deskRows = [...new Set(desks.map((desk) => desk.desk.y))];
  if (deskRows.length === 0) {
    return undefined;
  }
  const offCenter = (y: number) => Math.abs(y + 1 - rows / 2);
  const row = deskRows.reduce((best, y) => (offCenter(y) <= offCenter(best) ? y : best));
  const inRow = desks.filter((desk) => desk.desk.y === row);
  const pairs = inRow.filter((desk, index) => index % 2 === 0 && inRow[index + 1]?.desk.x === desk.desk.x + 1);
  const left = pairs[Math.floor((pairs.length - 1) / 2)];
  if (left === undefined) {
    return undefined;
  }
  const leftIndex = desks.indexOf(left);
  desks.splice(leftIndex, STATION_DESKS);
  return { desk: left.desk, seat: left.seat };
}

export const MIN_DESKS = 10;
// Empty desks kept beyond the sessions, so a new session has a seat without the room changing shape.
const SPARE_DESKS = 2;
const MIN_PAIRS_PER_ROW = 3;
const MAX_PAIRS_PER_ROW = 12;

export interface OfficeShape {
  cols: number;
  rows: number;
  desks: number;
}

// How many desks the room needs: at least MIN_DESKS, and a couple to spare past the sessions.
export function desksNeeded(sessionCount: number): number {
  return Math.max(MIN_DESKS, Math.max(0, Math.floor(sessionCount)) + SPARE_DESKS);
}

// The room size, in tiles, that holds the desks at the biggest zoom the view allows. A row of p desk pairs is 3p + 1
// tiles wide; r desk rows are 3r + 2 tiles tall with the wall and the props. Ties go to fewer empty desks. With
// oddPairs (your station is in), every row has a middle pair, so the station sits dead center.
export function officeShape(deskCount: number, viewWidth: number, viewHeight: number, tileSize: number, oddPairs = false): OfficeShape {
  let best: (OfficeShape & { zoom: number }) | undefined;
  for (let pairs = MIN_PAIRS_PER_ROW; pairs <= MAX_PAIRS_PER_ROW; pairs += oddPairs ? 2 : 1) {
    const deskRows = Math.max(1, Math.ceil(deskCount / (pairs * 2)));
    const cols = pairs * 3 + 1;
    const rows = Math.max(MIN_ROWS, deskRows * 3 + 2);
    const desks = pairs * 2 * deskRows;
    const zoom = Math.min(viewWidth / (cols * tileSize), viewHeight / (rows * tileSize));
    const isBetter = best === undefined || zoom > best.zoom + 1e-9 || (Math.abs(zoom - best.zoom) <= 1e-9 && desks < best.desks);
    if (isBetter) {
      best = { cols, rows, desks, zoom };
    }
  }
  const { cols, rows, desks } = best as OfficeShape;
  return { cols, rows, desks };
}

export function isWalkable(layout: OfficeLayout, point: Point): boolean {
  const kind = layout.tiles[point.y]?.[point.x];
  return kind !== undefined && WALKABLE.has(kind);
}

// Plain floor tiles: where a wandering guy can stop.
export function openFloorTiles(layout: OfficeLayout): Point[] {
  const open: Point[] = [];
  layout.tiles.forEach((row, y) => row.forEach((kind, x) => {
    if (kind === "floor") {
      open.push({ x, y });
    }
  }));
  return open;
}

const STEPS: readonly Point[] = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];

// Breadth-first, four directions. The path leaves out the start and ends on the goal; undefined when unreachable.
// Seats and couch tiles are walkable only as the start or the goal, so nobody cuts across someone's chair.
export function findPath(layout: OfficeLayout, from: Point, to: Point): Point[] | undefined {
  if (!isWalkable(layout, to)) {
    return undefined;
  }
  if (from.x === to.x && from.y === to.y) {
    return [];
  }
  const key = (point: Point) => point.y * layout.cols + point.x;
  const cameFrom = new Map<number, number>([[key(from), -1]]);
  const queue: Point[] = [from];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    for (const step of STEPS) {
      const next = { x: current.x + step.x, y: current.y + step.y };
      const nextKey = key(next);
      const isGoal = next.x === to.x && next.y === to.y;
      if (cameFrom.has(nextKey) || !isWalkable(layout, next) || (!isGoal && !isPassable(layout, next))) {
        continue;
      }
      cameFrom.set(nextKey, key(current));
      if (isGoal) {
        return tracePath(cameFrom, nextKey, key(from), layout.cols);
      }
      queue.push(next);
    }
  }
  return undefined;
}

function isPassable(layout: OfficeLayout, point: Point): boolean {
  const kind = layout.tiles[point.y][point.x];
  return kind === "floor" || kind === "door";
}

function tracePath(cameFrom: Map<number, number>, goalKey: number, startKey: number, cols: number): Point[] {
  const path: Point[] = [];
  for (let current = goalKey; current !== startKey; current = cameFrom.get(current) ?? startKey) {
    path.push({ x: current % cols, y: Math.floor(current / cols) });
  }
  return path.reverse();
}

// The walkable tile nearest a point, for a guy who was standing somewhere the new layout filled in.
export function nearestWalkable(layout: OfficeLayout, point: Point): Point {
  const clamped = {
    x: Math.max(0, Math.min(layout.cols - 1, Math.round(point.x))),
    y: Math.max(0, Math.min(layout.rows - 1, Math.round(point.y))),
  };
  if (isPassable(layout, clamped)) {
    return clamped;
  }
  let best = layout.door;
  let bestDistance = Infinity;
  layout.tiles.forEach((row, y) => row.forEach((_, x) => {
    const distance = Math.abs(x - clamped.x) + Math.abs(y - clamped.y);
    if (distance < bestDistance && isPassable(layout, { x, y })) {
      best = { x, y };
      bestDistance = distance;
    }
  }));
  return best;
}
