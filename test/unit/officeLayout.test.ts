import { describe, expect, it } from "vitest";
import { buildOfficeLayout, DRINK_PROPS, OFFICE_SCENES, desksNeeded, STATION_DESKS, findPath, isWalkable, MIN_COLS, MIN_DESKS, MIN_ROWS, nearestWalkable, officeSceneId, officeShape } from "../../src/officeLayout";

describe("buildOfficeLayout", () => {
  it("joins the middle desk pair into your station when asked", () => {
    const plain = buildOfficeLayout(16, 11, "office");
    const withStation = buildOfficeLayout(16, 11, "office", true);
    expect(plain.station).toBeUndefined();
    expect(withStation.desks).toHaveLength(plain.desks.length - STATION_DESKS);
    // Five pairs a row and three desk rows: the third pair of the middle row.
    expect(withStation.station).toEqual({ desk: { x: 7, y: 4 }, seat: { x: 7, y: 5 } });
    const { desk, seat } = withStation.station!;
    expect(withStation.tiles[desk.y].slice(desk.x, desk.x + 2)).toEqual(["desk", "desk"]);
    expect(withStation.tiles[seat.y].slice(seat.x, seat.x + 2)).toEqual(["seat", "seat"]);
    expect(withStation.desks.some((other) => other.desk.y === desk.y && Math.abs(other.desk.x - desk.x) <= 1)).toBe(false);
    // Two desk rows: the lower one is nearer the middle of the room.
    expect(buildOfficeLayout(16, 8, "office", true).station?.desk.y).toBe(4);
    expect(buildOfficeLayout(16, 6, "office", true).station?.desk.y).toBe(1);
  });

  it("never goes below the minimum size", () => {
    const layout = buildOfficeLayout(2, 2, "office");
    expect(layout.cols).toBe(MIN_COLS);
    expect(layout.rows).toBe(MIN_ROWS);
    expect(layout.desks.length).toBeGreaterThan(0);
  });

  it("puts each seat just below its desk", () => {
    const layout = buildOfficeLayout(14, 10, "office");
    for (const { desk, seat } of layout.desks) {
      expect(layout.tiles[desk.y][desk.x]).toBe("desk");
      expect(layout.tiles[seat.y][seat.x]).toBe("seat");
      expect(seat).toEqual({ x: desk.x, y: desk.y + 1 });
    }
  });

  it("adds desk rows as the room gets taller", () => {
    expect(buildOfficeLayout(14, 12, "office").desks.length).toBeGreaterThan(buildOfficeLayout(14, 6, "office").desks.length);
  });

  it("reaches every seat, prop, and couch seat from the door", () => {
    for (const { id: sceneId } of OFFICE_SCENES) {
      for (const [cols, rows] of [[8, 6], [11, 7], [18, 12], [30, 9]]) {
        const layout = buildOfficeLayout(cols, rows, sceneId);
        const goals = [
          ...layout.desks.map((desk) => desk.seat),
          ...layout.props.flatMap((prop) => (prop.stand === undefined ? [] : [prop.stand])),
          ...layout.couchSeats,
        ];
        for (const goal of goals) {
          expect(findPath(layout, layout.door, goal), `${sceneId} ${cols}x${rows} to ${goal.x},${goal.y}`).toBeDefined();
        }
      }
    }
  });

  it("uses each scene's props", () => {
    expect(buildOfficeLayout(14, 8, "office").props.map((prop) => prop.kind)).toContain("coffee");
    expect(buildOfficeLayout(14, 8, "serverRoom").props.map((prop) => prop.kind)).toContain("rack");
  });

  it("gives every scene something to drink from", () => {
    for (const { id } of OFFICE_SCENES) {
      for (const cols of [8, 11, 18]) {
        expect(buildOfficeLayout(cols, 8, id).props.some((prop) => DRINK_PROPS.has(prop.kind)), `${id} ${cols}`).toBe(true);
      }
    }
  });

  it("reads an unknown scene as the office", () => {
    expect(officeSceneId("serverRoom")).toBe("serverRoom");
    expect(officeSceneId("moon")).toBe("moon");
    expect(officeSceneId("mars")).toBe("office");
    expect(officeSceneId(undefined)).toBe("office");
  });
});

describe("findPath", () => {
  const layout = buildOfficeLayout(12, 8, "office");

  it("returns an empty path when already there", () => {
    expect(findPath(layout, { x: 0, y: 3 }, { x: 0, y: 3 })).toEqual([]);
  });

  it("steps one tile at a time and ends on the goal", () => {
    const goal = layout.desks[layout.desks.length - 1].seat;
    const path = findPath(layout, layout.door, goal);
    expect(path?.[path.length - 1]).toEqual(goal);
    let previous = layout.door;
    for (const point of path ?? []) {
      expect(Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y)).toBe(1);
      expect(isWalkable(layout, point)).toBe(true);
      previous = point;
    }
  });

  it("doesn't walk through other seats", () => {
    const [first, second] = layout.desks;
    const path = findPath(layout, layout.door, second.seat) ?? [];
    expect(path.slice(0, -1).some((point) => point.x === first.seat.x && point.y === first.seat.y)).toBe(false);
  });

  it("refuses a goal that isn't walkable", () => {
    expect(findPath(layout, layout.door, layout.desks[0].desk)).toBeUndefined();
  });
});

describe("nearestWalkable", () => {
  it("moves off a desk to an open tile", () => {
    const layout = buildOfficeLayout(12, 8, "office");
    const moved = nearestWalkable(layout, layout.desks[0].desk);
    expect(layout.tiles[moved.y][moved.x]).toMatch(/floor|door/);
  });
});

describe("officeShape", () => {
  it("keeps an odd number of pairs per row when your station is in, so it sits in the middle", () => {
    for (const [width, height] of [[320, 260], [500, 200], [260, 600], [900, 300]]) {
      const shape = officeShape(13, width, height, 16, true);
      expect(((shape.cols - 1) / 3) % 2).toBe(1);
      const station = buildOfficeLayout(shape.cols, shape.rows, "office", true).station!;
      expect(station.desk.x + 1).toBe(shape.cols / 2);
    }
  });

  it("builds at least ten desks, and exactly the desks it promises", () => {
    for (const [width, height] of [[300, 250], [600, 200], [200, 600], [1, 1]]) {
      const shape = officeShape(desksNeeded(0), width, height, 16);
      expect(shape.desks).toBeGreaterThanOrEqual(MIN_DESKS);
      expect(buildOfficeLayout(shape.cols, shape.rows, "office").desks).toHaveLength(shape.desks);
    }
  });

  it("keeps a couple of spare desks past the sessions", () => {
    expect(desksNeeded(3)).toBe(MIN_DESKS);
    expect(desksNeeded(9)).toBe(11);
    expect(desksNeeded(20)).toBe(22);
  });

  it("adds desks as sessions open, and never builds fewer than needed", () => {
    let previous = 0;
    for (let sessions = 0; sessions <= 40; sessions += 4) {
      const shape = officeShape(desksNeeded(sessions), 320, 260, 16);
      expect(shape.desks).toBeGreaterThanOrEqual(desksNeeded(sessions));
      expect(shape.desks).toBeGreaterThanOrEqual(previous);
      previous = shape.desks;
    }
  });

  it("goes wide in a wide view and tall in a tall one", () => {
    const wide = officeShape(12, 800, 200, 16);
    const tall = officeShape(12, 200, 800, 16);
    expect(wide.cols / wide.rows).toBeGreaterThan(tall.cols / tall.rows);
  });
});
