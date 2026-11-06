import { describe, expect, it } from "vitest";
import { buildOfficeLayout } from "../../src/officeLayout";
import { AgentInput, createOffice, lookToward, officeCounts, OfficeState, stepOffice, syncOffice, visitorAgent, visitorArrives } from "../../src/officeSim";
import { Personality, personalityOf, planVisit, VISITOR_KINDS, visitorGap, visitorReaction } from "../../src/officeVisitors";
import { seededRandom } from "../../src/pixelGuy";

const input = (id: string, status: AgentInput["status"]): AgentInput => ({ id, seed: id, status, title: `Session ${id}` });

function run(state: OfficeState, seconds: number, random: () => number, each?: () => void): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += 0.05) {
    stepOffice(state, 0.05, random);
    each?.();
  }
}

describe("officeVisitors", () => {
  it("gives every seed a fixed personality, mostly reasonable ones", () => {
    expect(personalityOf("abc")).toBe(personalityOf("abc"));
    const counts = new Map<Personality, number>();
    for (let index = 0; index < 1200; index++) {
      const personality = personalityOf(`session-${index}`);
      counts.set(personality, (counts.get(personality) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual(["deadpan", "eager", "grumbler", "snark", "suckUp"]);
    expect(counts.get("grumbler") ?? 0).toBeGreaterThan(counts.get("suckUp") ?? 0);
  });

  it("has the suck-up answer every boss, and the grumbler grumble", () => {
    const random = seededRandom(3);
    for (let index = 0; index < 30; index++) {
      expect(visitorReaction("suckUp", true, false, random)).toMatch(/boss|BOSS|Synergy|Yes sir/);
    }
    const grumbles = Array.from({ length: 40 }, () => visitorReaction("grumbler", true, false, random)).filter((line) => line !== undefined);
    expect(grumbles.length).toBeGreaterThan(10);
    expect(grumbles.length).toBeLessThan(40);
    expect(grumbles.every((line) => /grumble|sigh|mhm|sure/.test(line as string))).toBe(true);
    expect(visitorReaction("suckUp", true, true, () => 0.1)).toBe("zzz…");
  });

  it("plans a visit from a department, sometimes a manager, with an opener and maybe a closer", () => {
    const random = seededRandom(11);
    const plans = Array.from({ length: 400 }, () => planVisit(random));
    expect(new Set(plans.map((plan) => plan.kind.id)).size).toBe(VISITOR_KINDS.length);
    const bosses = plans.filter((plan) => plan.kind.boss).length;
    expect(bosses).toBeGreaterThan(80);
    expect(bosses).toBeLessThan(250);
    for (const plan of plans) {
      expect(plan.kind.openers).toContain(plan.lines[0]);
      expect(plan.lines.length === 1 || plan.kind.closers.includes(plan.lines[1])).toBe(true);
    }
  });

  it("spaces visitors a minute or two apart, the first sooner", () => {
    expect(visitorGap(() => 0, true)).toBe(30);
    expect(visitorGap(() => 0.999, true)).toBeLessThan(70);
    expect(visitorGap(() => 0)).toBe(70);
    expect(visitorGap(() => 0.999)).toBeLessThan(180);
  });

  it("walks a visitor in, has him say his lines facing the room, and walks him out", () => {
    const random = seededRandom(5);
    const state = createOffice(buildOfficeLayout(12, 8, "office"));
    syncOffice(state, [input("a", "working"), input("b", "idle")], random, "seated");
    const visitor = visitorArrives(state, { id: "v", seed: "v", title: "Manager", lines: ["Keep up the synergy!", "Carry on!"] }, random);
    expect(visitor).toBeDefined();
    expect(visitorArrives(state, { id: "w", seed: "w", title: "IT", lines: ["hi"] }, random)).toBeUndefined();
    expect(officeCounts(state)).toEqual({ working: 1, idle: 1, asleep: 0 });
    const said: string[] = [];
    let addressed = false;
    run(state, 40, random, () => {
      const here = visitorAgent(state);
      if (here?.mode === "address") {
        addressed = true;
        expect(here.facing).toBe("down");
      }
      if (here?.bubble !== undefined && said[said.length - 1] !== here.bubble.text) {
        said.push(here.bubble.text);
      }
    });
    expect(addressed).toBe(true);
    expect(said).toEqual(["Keep up the synergy!", "Carry on!"]);
    expect(visitorAgent(state)).toBeUndefined();
    expect(state.agents.map((agent) => agent.id).sort()).toEqual(["a", "b"]);
  });

  it("leaves a visitor alone when the sessions change, and keeps him off the desks", () => {
    const random = seededRandom(8);
    const state = createOffice(buildOfficeLayout(12, 8, "office"));
    syncOffice(state, [input("a", "working")], random, "seated");
    visitorArrives(state, { id: "v", seed: "v", title: "HR", lines: ["Who microwaved fish?"] }, random);
    syncOffice(state, [input("a", "working"), input("c", "working")], random);
    const visitor = visitorAgent(state);
    expect(visitor?.leaving).toBe(false);
    expect(visitor?.deskIndex).toBeUndefined();
    expect(state.agents.find((agent) => agent.id === "c")?.deskIndex).toBeDefined();
  });

  it("turns a standing idle guy to look, but not one at his desk", () => {
    const random = seededRandom(2);
    const state = createOffice(buildOfficeLayout(12, 8, "office"));
    syncOffice(state, [input("a", "idle"), input("b", "working")], random, "seated");
    const [idle, busy] = state.agents;
    idle.mode = "loiter";
    lookToward(state, idle, { x: idle.x - 3, y: idle.y }, 2);
    expect(idle.watch?.facing).toBe("left");
    lookToward(state, busy, { x: busy.x - 3, y: busy.y }, 2);
    expect(busy.watch).toBeUndefined();
  });
});
