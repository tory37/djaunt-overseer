import { describe, expect, it } from "vitest";
import {
  audienceLine, isPerformanceKind, PERFORMANCE_KINDS, PERFORMANCES, performanceFrequency, performanceGap, planPerformance, ROLE_OUTFITS,
} from "../../src/officePerformances";
import { seededRandom } from "../../src/pixelGuy";

describe("officePerformances", () => {
  it("plans every kind with a title per performer, lines, a closer, and a length in range", () => {
    const random = seededRandom(3);
    for (const kind of PERFORMANCE_KINDS) {
      for (let trial = 0; trial < 20; trial++) {
        const plan = planPerformance(random, kind);
        const spec = PERFORMANCES[kind];
        expect(plan.kind).toBe(kind);
        expect(plan.titles).toHaveLength(spec.roles.length);
        expect(plan.lines.length).toBeGreaterThanOrEqual(4);
        expect(plan.lines.every((line) => line.text.length > 0 && !line.text.includes("{"))).toBe(true);
        expect(plan.closer.text.length).toBeGreaterThan(0);
        expect(plan.length).toBeGreaterThanOrEqual(spec.length[0]);
        expect(plan.length).toBeLessThanOrEqual(spec.length[1]);
        expect(plan.food.length > 0).toBe(spec.effect === "food");
        expect(new Set(plan.lines.map((line) => line.text)).size).toBe(plan.lines.length);
      }
    }
  });

  it("picks a random kind when none is asked for", () => {
    const random = seededRandom(8);
    const kinds = new Set(Array.from({ length: 200 }, () => planPerformance(random).kind));
    expect(kinds.size).toBe(PERFORMANCE_KINDS.length);
  });

  it("gives the comedian's punchlines a laugh cue", () => {
    const plan = planPerformance(seededRandom(5), "comedian");
    const punchlines = plan.lines.filter((line) => line.cue === "laugh");
    expect(punchlines).toHaveLength(4);
  });

  it("has an outfit for every role", () => {
    for (const kind of PERFORMANCE_KINDS) {
      for (const role of PERFORMANCES[kind].roles) {
        expect(ROLE_OUTFITS[role].shirt).toMatch(/^#[0-9A-F]{6}$/i);
      }
    }
  });

  it("answers cues and fills in the food", () => {
    const random = seededRandom(2);
    for (let trial = 0; trial < 50; trial++) {
      expect(audienceLine("comedian", "laugh", "grumbler", false, random).length).toBeGreaterThan(0);
      expect(audienceLine("lunch", "idle", "eager", false, random, "pizza")).not.toContain("{");
    }
  });

  it("reads the frequency setting and spaces shows out by it", () => {
    expect(performanceFrequency("often")).toBe("often");
    expect(performanceFrequency(false)).toBe("off");
    expect(performanceFrequency("bogus")).toBe("normal");
    const random = seededRandom(4);
    for (let trial = 0; trial < 50; trial++) {
      const gap = performanceGap(random, "normal");
      expect(gap).toBeGreaterThanOrEqual(12 * 60);
      expect(gap).toBeLessThanOrEqual(25 * 60);
      expect(performanceGap(random, "rare", true)).toBeLessThanOrEqual(60 * 60);
    }
    expect(isPerformanceKind("band")).toBe(true);
    expect(isPerformanceKind("opera")).toBe(false);
  });
});
