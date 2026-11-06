// Pure: the Office view's floor plan for a size in tiles, and paths across it. Row 0 is the back wall with the door
// at its left end. Desk blocks repeat down the room: a row of desks in pairs, the seats below them, then an aisle.
// The bottom row holds the props (cooler, coffee, couch, plants), each with a tile to stand on above it.

export type OfficeSceneId = "office" | "serverRoom";

export const OFFICE_SCENES: readonly { id: OfficeSceneId; label: string }[] = [
  { id: "office", label: "Office" },
  { id: "serverRoom", label: "Server Room" },
];

export function officeSceneId(value: unknown): OfficeSceneId {
  return OFFICE_SCENES.some((scene) => scene.id === value) ? (value as OfficeSceneId) : "office";
}

export type TileKind = "floor" | "wall" | "door" | "desk" | "seat" | "prop" | "couch";

export type PropKind = "plant" | "cooler" | "coffee" | "couch" | "shelf" | "rack" | "vending";

export interface Point {
  x: number;
  y: number;
}

export interface Desk {
  // The desk tile; the seat is the tile below it.
  desk: Point;
  seat: Point;
}

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
};

export function buildOfficeLayout(requestedCols: number, requestedRows: number, sceneId: OfficeSceneId): OfficeLayout {
  const cols = Math.max(MIN_COLS, Math.floor(requestedCols));
  const rows = Math.max(MIN_ROWS, Math.floor(requestedRows));
  const tiles: TileKind[][] = Array.from({ length: rows }, (_, y) =>
    Array.from({ length: cols }, (): TileKind => (y === 0 ? "wall" : "floor")),
  );
  const door = { x: 1, y: 0 };
  tiles[door.y][door.x] = "door";

  const desks: Desk[] = [];
  // Column 0 and the last column stay open as corridors; every third column is a gap between desk pairs.
  for (let deskRow = 1; deskRow + 2 <= rows - 2; deskRow += 3) {
    for (let x = 1; x <= cols - 2; x++) {
      if ((x - 1) % 3 === 2) {
        continue;
      }
      // The door needs a way in, so the tile under it stays floor.
      if (deskRow === 1 && x === door.x) {
        continue;
      }
      tiles[deskRow][x] = "desk";
      tiles[deskRow + 1][x] = "seat";
      desks.push({ desk: { x, y: deskRow }, seat: { x, y: deskRow + 1 } });
    }
  }

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
    if (!isCorner && x % 2 === 0 && kind !== "cooler" && kind !== "coffee" && kind !== "vending") {
      continue;
    }
    tiles[propRow][x] = "prop";
    props.push({ kind, at: { x, y: propRow }, stand: { x, y: propRow - 1 } });
  }

  return { cols, rows, tiles, door, desks, props, couchSeats };
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
