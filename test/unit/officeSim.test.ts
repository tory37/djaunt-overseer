import { describe, expect, it } from "vitest";
import { buildOfficeLayout } from "../../src/officeLayout";
import { Agent, AgentInput, agentPose, createOffice, officeCounts, OfficeState, relayoutOffice, stepOffice, syncOffice } from "../../src/officeSim";
import { seededRandom } from "../../src/pixelGuy";

const input = (id: string, status: AgentInput["status"]): AgentInput => ({ id, seed: id, status, title: `Session ${id}` });

function run(state: OfficeState, seconds: number, random: () => number): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += 0.05) {
    stepOffice(state, 0.05, random);
  }
}

function agent(state: OfficeState, id: string): Agent {
  const found = state.agents.find((candidate) => candidate.id === id);
  if (found === undefined) {
    throw new Error(`no agent ${id}`);
  }
  return found;
}

const atWorkSpot = (guy: Agent) => guy.path.length === 0 && guy.x === guy.workSpot.x && guy.y === guy.workSpot.y;

describe("officeSim", () => {
  it("brings a working session's guy in from the door to type at his desk", () => {
    const random = seededRandom(1);
    const state = createOffice(buildOfficeLayout(12, 8, "office"));
    syncOffice(state, [input("a", "working")], random);
    const guy = agent(state, "a");
    expect(guy.x).toBe(state.layout.door.x);
    expect(guy.deskIndex).toBe(0);
    run(state, 15, random);
    expect(atWorkSpot(guy)).toBe(true);
    expect(guy.mode).toBe("type");
    expect(agentPose(guy, state.time)).toMatchObject({ pose: "type", facing: "up", seated: true });
  });

  it("starts everyone at their desks when the view first opens", () => {
    const random = seededRandom(9);
    const state = createOffice(buildOfficeLayout(12, 8, "office"));
    syncOffice(state, [input("a", "working"), input("b", "idle")], random, "seated");
    expect(atWorkSpot(agent(state, "a"))).toBe(true);
    expect(agent(state, "a").mode).toBe("type");
    expect(atWorkSpot(agent(state, "b"))).toBe(true);
    expect(agent(state, "b").mode).toBe("sit");
  });

  it("gives each guy his own desk and keeps it across syncs", () => {
    const random = seededRandom(2);
    const state = createOffice(buildOfficeLayout(12, 8, "office"));
    syncOffice(state, [input("a", "working"), input("b", "working")], random);
    const desks = state.agents.map((guy) => guy.deskIndex);
    expect(new Set(desks).size).toBe(2);
    syncOffice(state, [input("b", "working"), input("a", "idle"), input("c", "working")], random);
    expect(state.agents.slice(0, 2).map((guy) => guy.deskIndex)).toEqual(desks);
    expect(new Set(state.agents.map((guy) => guy.deskIndex)).size).toBe(3);
  });

  it("gets an idle guy up from his desk eventually, and runs him back when work starts", () => {
    const random = seededRandom(3);
    const state = createOffice(buildOfficeLayout(12, 8, "office"));
    syncOffice(state, [input("a", "working")], random);
    run(state, 15, random);
    syncOffice(state, [input("a", "idle")], random);
    const guy = agent(state, "a");
    let leftDesk = false;
    for (let elapsed = 0; elapsed < 120 && !leftDesk; elapsed += 0.05) {
      stepOffice(state, 0.05, random);
      leftDesk = !atWorkSpot(guy);
    }
    expect(leftDesk).toBe(true);
    run(state, 3, random);
    syncOffice(state, [input("a", "working")], random);
    if (!atWorkSpot(guy)) {
      expect(guy.running).toBe(true);
    }
    run(state, 15, random);
    expect(atWorkSpot(guy)).toBe(true);
    expect(guy.mode).toBe("type");
  });

  it("gets two idle guys chatting with speech bubbles", () => {
    const random = seededRandom(4);
    const state = createOffice(buildOfficeLayout(10, 6, "office"));
    syncOffice(state, [input("a", "idle"), input("b", "idle")], random);
    let chatted = false;
    let bubbled = false;
    for (let elapsed = 0; elapsed < 600 && !(chatted && bubbled); elapsed += 0.05) {
      stepOffice(state, 0.05, random);
      const chatting = state.agents.filter((guy) => guy.mode === "chat");
      if (chatting.length === 2) {
        chatted = true;
        expect(Math.abs(chatting[0].x - chatting[1].x) + Math.abs(chatting[0].y - chatting[1].y)).toBe(1);
        bubbled ||= chatting.some((guy) => guy.bubble !== undefined);
      }
    }
    expect(chatted).toBe(true);
    expect(bubbled).toBe(true);
  });

  it("ends the chat for both when one goes back to work", () => {
    const random = seededRandom(5);
    const state = createOffice(buildOfficeLayout(10, 6, "office"));
    syncOffice(state, [input("a", "idle"), input("b", "idle")], random);
    for (let elapsed = 0; elapsed < 600 && !state.agents.every((guy) => guy.mode === "chat"); elapsed += 0.05) {
      stepOffice(state, 0.05, random);
    }
    expect(state.agents.every((guy) => guy.mode === "chat")).toBe(true);
    syncOffice(state, [input("a", "working"), input("b", "idle")], random);
    stepOffice(state, 0.05, random);
    expect(agent(state, "b").mode).not.toBe("chat");
    expect(agent(state, "a").goal).toEqual({ kind: "work" });
  });

  it("puts a suspended session's guy to sleep at his desk, and wakes him when it resumes", () => {
    const random = seededRandom(10);
    const state = createOffice(buildOfficeLayout(12, 8, "office"));
    syncOffice(state, [input("a", "idle")], random);
    run(state, 20, random);
    syncOffice(state, [input("a", "asleep")], random);
    const guy = agent(state, "a");
    expect(guy.bubble?.text).toBe("*yawn*");
    run(state, 20, random);
    expect(atWorkSpot(guy)).toBe(true);
    expect(guy.mode).toBe("sleep");
    expect(agentPose(guy, state.time)).toMatchObject({ pose: "sleep", facing: "up", seated: true });
    run(state, 60, random);
    expect(guy.mode).toBe("sleep");
    expect(officeCounts(state)).toEqual({ working: 0, idle: 0, asleep: 1 });
    syncOffice(state, [input("a", "working")], random);
    expect(guy.bubble?.text).toBe("!?");
    expect(guy.mode).toBe("type");
  });

  it("starts sleepers asleep when the view opens, and keeps them out of chats", () => {
    const random = seededRandom(11);
    const state = createOffice(buildOfficeLayout(10, 6, "office"));
    syncOffice(state, [input("a", "asleep"), input("b", "idle")], random, "seated");
    expect(agent(state, "a").mode).toBe("sleep");
    run(state, 120, random);
    expect(agent(state, "a").mode).toBe("sleep");
    expect(agent(state, "b").mode).not.toBe("chat");
  });

  it("walks an ended session's guy out the door", () => {
    const random = seededRandom(6);
    const state = createOffice(buildOfficeLayout(12, 8, "office"));
    syncOffice(state, [input("a", "working"), input("b", "working")], random);
    run(state, 15, random);
    syncOffice(state, [input("b", "working")], random);
    expect(agent(state, "a").leaving).toBe(true);
    expect(officeCounts(state)).toEqual({ working: 1, idle: 0, asleep: 0 });
    run(state, 20, random);
    expect(state.agents.map((guy) => guy.id)).toEqual(["b"]);
  });

  it("seats the overflow on the couch when the desks run out", () => {
    const random = seededRandom(7);
    const state = createOffice(buildOfficeLayout(8, 6, "office"));
    const deskCount = state.layout.desks.length;
    syncOffice(state, Array.from({ length: deskCount + 1 }, (_, index) => input(`s${index}`, "working")), random);
    const overflow = state.agents[deskCount];
    expect(overflow.deskIndex).toBeUndefined();
    expect(state.layout.couchSeats).toContainEqual(overflow.workSpot);
    run(state, 20, random);
    expect(state.agents.every((guy) => guy.mode === "type")).toBe(true);
  });

  it("keeps everyone on walkable tiles after a smaller relayout", () => {
    const random = seededRandom(8);
    const state = createOffice(buildOfficeLayout(20, 12, "office"));
    syncOffice(state, Array.from({ length: 6 }, (_, index) => input(`s${index}`, index % 2 === 0 ? "working" : "idle")), random);
    run(state, 30, random);
    relayoutOffice(state, buildOfficeLayout(9, 6, "serverRoom"), random);
    run(state, 30, random);
    for (const guy of state.agents) {
      const tile = state.layout.tiles[Math.round(guy.y)]?.[Math.round(guy.x)];
      expect(["floor", "door", "seat", "couch"]).toContain(tile);
    }
    const working = state.agents.filter((guy) => guy.status === "working");
    expect(working.every((guy) => guy.mode === "type")).toBe(true);
  });
});
