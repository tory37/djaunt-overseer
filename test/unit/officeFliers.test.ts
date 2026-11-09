import { describe, expect, it } from "vitest";
import { FLIER_GAP_SECONDS, flierGap, flierLines, flierPoses, FLIERS, fliersNow, flightDone, planFlight, SCENE_FLIERS } from "../../src/officeFliers";
import { buildOfficeLayout, OFFICE_SCENES } from "../../src/officeLayout";
import { seededRandom } from "../../src/pixelGuy";

const TILE = 16;

describe("officeFliers", () => {
  it("gives every scene its own fliers", () => {
    for (const scene of OFFICE_SCENES) {
      expect(new Set(SCENE_FLIERS[scene.id].map((troupe) => troupe[0])).size).toBeGreaterThanOrEqual(5);
    }
    expect(SCENE_FLIERS.cave.flat()).toContain("dragon");
    expect(SCENE_FLIERS.moon.flat()).toContain("spaceWhale");
  });

  it("flies by less often than the critters run", () => {
    const random = seededRandom(5);
    for (let i = 0; i < 50; i++) {
      const gap = flierGap(random);
      expect(gap).toBeGreaterThanOrEqual(FLIER_GAP_SECONDS.min);
      expect(gap).toBeLessThanOrEqual(FLIER_GAP_SECONDS.max);
    }
  });

  it("keeps owls and fireflies for the night and bluebirds for the day, outdoors only", () => {
    const leads = (night: boolean | undefined) => fliersNow("forest", night).map((troupe) => troupe[0]);
    expect(leads(true)).toContain("owl");
    expect(leads(true)).not.toContain("bluebird");
    expect(leads(false)).toContain("bluebird");
    expect(leads(false)).not.toContain("firefly");
    expect(leads(undefined)).toEqual(SCENE_FLIERS.forest.map((troupe) => troupe[0]));
    // Every outdoor scene has something to send at any hour.
    for (const scene of ["forest", "field", "riverbed", "moon"] as const) {
      expect(fliersNow(scene, true).length).toBeGreaterThan(0);
      expect(fliersNow(scene, false).length).toBeGreaterThan(0);
    }
  });

  it("crosses from off one edge to off the other, then is done", () => {
    for (const scene of OFFICE_SCENES) {
      const random = seededRandom(scene.id.length * 7);
      const layout = buildOfficeLayout(12, 8, scene.id);
      for (let i = 0; i < 20; i++) {
        const flight = planFlight(layout, scene.id, 0, random, TILE);
        expect(flight).toBeDefined();
        if (flight === undefined) {
          continue;
        }
        const roomWidth = layout.cols * TILE;
        const offRoom = (x: number, kind: keyof typeof FLIERS) => x + FLIERS[kind].width / 2 < 0 || x - FLIERS[kind].width / 2 > roomWidth;
        // Darters wander a little around their line, so check well before the start and well after the end.
        const first = flierPoses(flight, 0);
        first.forEach((pose) => expect(offRoom(pose.x, pose.kind) || FLIERS[pose.kind].motion === "dart").toBe(true));
        expect(flightDone(flight, 0)).toBe(false);
        let time = 0;
        while (!flightDone(flight, time)) {
          time += 0.5;
          expect(time).toBeLessThan(600);
          for (const pose of flierPoses(flight, time)) {
            expect(pose.y).toBeGreaterThan(-20);
            expect(pose.y).toBeLessThan(layout.rows * TILE);
          }
        }
        for (const pose of flierPoses(flight, time + 5)) {
          expect(offRoom(pose.x, pose.kind)).toBe(true);
        }
      }
    }
  });

  it("flies a flock as one: a V of geese spreads above and below the lead", () => {
    const layout = buildOfficeLayout(12, 8, "field");
    const random = seededRandom(1);
    let geese;
    for (let i = 0; i < 100 && geese === undefined; i++) {
      const flight = planFlight(layout, "field", 0, random, TILE);
      if (flight?.members[0] === "goose") {
        geese = flight;
      }
    }
    expect(geese).toBeDefined();
    if (geese === undefined) {
      return;
    }
    expect(geese.offsets.some((offset) => offset.y < 0)).toBe(true);
    expect(geese.offsets.some((offset) => offset.y > 0)).toBe(true);
    expect(geese.offsets.slice(1).every((offset) => offset.back > 0)).toBe(true);
  });

  it("swoops low over the room in the middle of a hawk's crossing", () => {
    const layout = buildOfficeLayout(12, 8, "forest");
    const random = seededRandom(2);
    let hawk;
    for (let i = 0; i < 200 && hawk === undefined; i++) {
      const flight = planFlight(layout, "forest", 0, random, TILE, false);
      if (flight?.members[0] === "hawk") {
        hawk = flight;
      }
    }
    expect(hawk).toBeDefined();
    if (hawk === undefined) {
      return;
    }
    const total = Math.abs(hawk.toX - hawk.fromX) / hawk.speed;
    const start = flierPoses(hawk, 0)[0].y;
    const middle = flierPoses(hawk, total / 2)[0].y;
    expect(middle - start).toBeGreaterThan(TILE * 2);
  });

  it("has lines for every flier", () => {
    for (const kind of Object.keys(FLIERS) as (keyof typeof FLIERS)[]) {
      expect(flierLines(kind).length).toBeGreaterThan(4);
    }
  });
});
