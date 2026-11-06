import { describe, expect, it } from "vitest";
import { buildOfficeLayout } from "../../src/officeLayout";
import { AgentInput, createOffice, lookToward, officeCounts, OfficeState, stepOffice, syncOffice, visitorAgents, visitorArrives } from "../../src/officeSim";
import { MAX_VISITORS, Personality, personalityOf, planVisit, VISITOR_KINDS, visitorFrequency, visitorGap, visitorReaction, visitorSmallTalk } from "../../src/officeVisitors";
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
      // A closer is said on arrival only by someone who isn't staying.
      expect(plan.stay > 0 ? plan.lines.length : 1).toBe(1);
      expect(plan.farewell === undefined || plan.kind.closers.includes(plan.farewell)).toBe(true);
    }
    const brief = plans.filter((plan) => plan.stay === 0).length;
    const settled = plans.filter((plan) => plan.stay >= 180).length;
    expect(brief).toBeGreaterThan(80);
    expect(settled).toBeGreaterThan(50);
    expect(Math.max(...plans.map((plan) => plan.stay))).toBeLessThanOrEqual(600);
  });

  it("spaces visitors by the frequency setting, the first sooner", () => {
    expect(visitorGap(() => 0)).toBe(60);
    expect(visitorGap(() => 0.999)).toBeLessThan(150);
    expect(visitorGap(() => 0, "normal", true)).toBe(24);
    expect(visitorGap(() => 0.999, "normal", true)).toBeLessThan(60);
    expect(visitorGap(() => 0, "rare")).toBe(180);
    expect(visitorGap(() => 0.999, "packed")).toBeLessThan(30);
    expect(visitorFrequency("often")).toBe("often");
    expect(visitorFrequency("off")).toBe("off");
    expect(visitorFrequency(false)).toBe("off");
    expect(visitorFrequency(true)).toBe("normal");
    expect(visitorFrequency("bogus")).toBe("normal");
  });

  it("walks a visitor in, has him say his lines facing the room, and walks him out", () => {
    const random = seededRandom(5);
    const state = createOffice(buildOfficeLayout(12, 8, "office"));
    syncOffice(state, [input("a", "working"), input("b", "idle")], random, "seated");
    const visitor = visitorArrives(state, { id: "v", seed: "v", title: "Manager", lines: ["Keep up the synergy!", "Carry on!"] }, random);
    expect(visitor).toBeDefined();
    expect(officeCounts(state)).toEqual({ working: 1, idle: 1, asleep: 0 });
    const said: string[] = [];
    let addressed = false;
    run(state, 40, random, () => {
      const here = visitorAgents(state)[0];
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
    expect(visitorAgents(state)).toEqual([]);
    expect(state.agents.map((agent) => agent.id).sort()).toEqual(["a", "b"]);
  });

  it("leaves a visitor alone when the sessions change, and keeps him off the desks", () => {
    const random = seededRandom(8);
    const state = createOffice(buildOfficeLayout(12, 8, "office"));
    syncOffice(state, [input("a", "working")], random, "seated");
    visitorArrives(state, { id: "v", seed: "v", title: "HR", lines: ["Who microwaved fish?"] }, random);
    syncOffice(state, [input("a", "working"), input("c", "working")], random);
    const visitor = visitorAgents(state)[0];
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

  it("lets up to five visitors in at once", () => {
    const random = seededRandom(9);
    const state = createOffice(buildOfficeLayout(16, 10, "office"));
    syncOffice(state, [input("a", "working")], random, "seated");
    for (let index = 0; index < MAX_VISITORS; index++) {
      expect(visitorArrives(state, { id: `v${index}`, seed: `v${index}`, title: "IT", lines: ["hi"], stay: 100 }, random)).toBeDefined();
    }
    expect(visitorArrives(state, { id: "extra", seed: "extra", title: "IT", lines: ["hi"] }, random)).toBeUndefined();
    expect(visitorAgents(state)).toHaveLength(MAX_VISITORS);
    expect(officeCounts(state)).toEqual({ working: 1, idle: 0, asleep: 0 });
  });

  it("has a staying visitor hang around, make small talk, then say bye and leave", () => {
    const random = seededRandom(4);
    const state = createOffice(buildOfficeLayout(14, 9, "office"));
    syncOffice(state, [input("a", "working"), input("b", "idle"), input("c", "idle")], random, "seated");
    const kind = VISITOR_KINDS.find((candidate) => candidate.id === "manager")!;
    visitorArrives(state, {
      id: "v", seed: "v", title: "Manager", lines: ["Keep up the synergy!"], boss: true,
      smallTalk: visitorSmallTalk(kind), farewell: "Carry on!", stay: 120,
    }, random);
    const said: string[] = [];
    const modes = new Set<string>();
    let stillHereAt100 = false;
    let elapsed = 0;
    run(state, 200, random, () => {
      elapsed += 0.05;
      const visitor = visitorAgents(state)[0];
      if (visitor === undefined) {
        return;
      }
      modes.add(visitor.mode);
      if (elapsed > 100 && elapsed < 101) {
        stillHereAt100 = !visitor.leaving;
      }
      if (visitor.bubble !== undefined && said[said.length - 1] !== visitor.bubble.text) {
        said.push(visitor.bubble.text);
      }
    });
    expect(stillHereAt100).toBe(true);
    expect(said[0]).toBe("Keep up the synergy!");
    expect(said.slice(1).some((line) => visitorSmallTalk(kind).includes(line))).toBe(true);
    expect(said[said.length - 1]).toBe("Carry on!");
    expect([...modes].some((mode) => mode !== "walk" && mode !== "address")).toBe(true);
    expect(visitorAgents(state)).toEqual([]);
    expect(state.agents.map((agent) => agent.id).sort()).toEqual(["a", "b", "c"]);
  });
});
