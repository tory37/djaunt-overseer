import { describe, expect, it } from "vitest";
import { CRITTER_GAP_SECONDS, critterGap, critterLanes, critterLines, critterPoses, critterRunDone, CRITTERS, planCritterRun, SCENE_CRITTERS } from "../../src/officeCritters";
import { buildOfficeLayout, OFFICE_SCENES } from "../../src/officeLayout";
import { agentPose, createOffice, reactToCritter, stepOffice, syncOffice } from "../../src/officeSim";
import { seededRandom } from "../../src/pixelGuy";

const TILE = 16;

describe("officeCritters", () => {
  it("gives every scene its own troupes", () => {
    for (const scene of OFFICE_SCENES) {
      expect(SCENE_CRITTERS[scene.id].length).toBeGreaterThan(0);
    }
    expect(SCENE_CRITTERS.moon.flat()).toContain("alien");
    expect(SCENE_CRITTERS.forest.flat()).toContain("fox");
  });

  it("keeps the gap between troupes short enough to see them often", () => {
    const random = seededRandom(3);
    for (let i = 0; i < 50; i++) {
      const gap = critterGap(random);
      expect(gap).toBeGreaterThanOrEqual(CRITTER_GAP_SECONDS.min);
      expect(gap).toBeLessThanOrEqual(CRITTER_GAP_SECONDS.max);
    }
  });

  it("crosses only on rows with nothing in the way", () => {
    const layout = buildOfficeLayout(12, 8, "forest");
    const lanes = critterLanes(layout);
    expect(lanes.length).toBeGreaterThan(0);
    for (const row of lanes) {
      expect(layout.tiles[row].every((tile) => tile === "floor")).toBe(true);
    }
  });

  it("runs from off one edge to off the other, then is done", () => {
    for (const scene of OFFICE_SCENES) {
      const random = seededRandom(scene.id.length);
      const layout = buildOfficeLayout(12, 8, scene.id);
      for (let i = 0; i < 20; i++) {
        const run = planCritterRun(layout, scene.id, 0, random, TILE);
        expect(run).toBeDefined();
        if (run === undefined) {
          continue;
        }
        const roomWidth = layout.cols * TILE;
        const start = critterPoses(run, 0);
        start.forEach((pose) => expect(pose.x < 0 || pose.x > roomWidth).toBe(true));
        expect(critterRunDone(run, 0)).toBe(false);
        let time = 0;
        while (!critterRunDone(run, time) && time < 120) {
          time += 0.25;
        }
        expect(time).toBeLessThan(60);
        critterPoses(run, time).forEach((pose) => expect(pose.x < 0 || pose.x > roomWidth).toBe(true));
      }
    }
  });

  it("stops once partway when it pauses, then carries on", () => {
    const layout = buildOfficeLayout(12, 8, "office");
    const run = planCritterRun(layout, "office", 0, seededRandom(1), TILE);
    expect(run).toBeDefined();
    if (run === undefined) {
      return;
    }
    run.pauseAt = 60;
    run.pauseSeconds = 1;
    const pauseStart = 60 / run.speed;
    const during = critterPoses(run, pauseStart + 0.5)[0];
    expect(during.still).toBe(true);
    expect(during.x).toBeCloseTo(run.fromX + run.direction * 60);
    expect(critterPoses(run, pauseStart + 1.5)[0].still).toBe(false);
  });

  it("has lines for every critter", () => {
    for (const kind of Object.keys(CRITTERS) as (keyof typeof CRITTERS)[]) {
      expect(critterLines(kind).length).toBeGreaterThan(0);
    }
  });

  it("has idle guys nearby stop and look, and leaves busy guys alone", () => {
    const random = seededRandom(5);
    const state = createOffice(buildOfficeLayout(12, 8, "forest"));
    syncOffice(state, [{ id: "idle", seed: "a", status: "idle", title: "" }, { id: "busy", seed: "b", status: "working", title: "" }], random, "seated");
    const idle = state.agents.find((agent) => agent.id === "idle")!;
    const busy = state.agents.find((agent) => agent.id === "busy")!;
    idle.mode = "loiter";
    idle.path = [];
    const at = { x: idle.x + 2, y: idle.y };
    const near = { x: busy.x + 1, y: busy.y };
    const reacted = reactToCritter(state, at, ["a fox!"], new Set(), () => 0.5);
    expect(reacted).toEqual(["idle"]);
    expect(idle.bubble?.text).toBe("a fox!");
    expect(agentPose(idle, state.time)).toMatchObject({ pose: "stand", facing: "right" });
    expect(reactToCritter(state, near, ["a fox!"], new Set(), () => 0.5)).toEqual([]);
    // Once per troupe.
    idle.bubble = undefined;
    expect(reactToCritter(state, at, ["a fox!"], new Set(["idle"]), () => 0.5)).toEqual([]);
    // Stands still while he watches, then goes back to his day.
    const x = idle.x;
    idle.path = [{ x: idle.x, y: idle.y + 1 }];
    stepOffice(state, 0.2, random);
    expect(idle.x).toBe(x);
    for (let i = 0; i < 60; i++) {
      stepOffice(state, 0.05, random);
    }
    expect(idle.watch).toBeUndefined();
  });
});
