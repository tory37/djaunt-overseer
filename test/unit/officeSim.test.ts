import { SLEEP_LINES, WAKE_TO_WORK_LINES } from "../../src/officePhrases";
import { describe, expect, it } from "vitest";
import { buildOfficeLayout } from "../../src/officeLayout";
import { Agent, AgentInput, agentPose, callYouBack, createOffice, crewAgents, endShow, hasDesk, isAtStation, officeCounts, OfficeState, relayoutOffice, ShowInput, showPerformers, startShow, stepOffice, syncOffice, syncYou, youAgent } from "../../src/officeSim";
import { PERFORMANCES, PerformanceKindId, planPerformance } from "../../src/officePerformances";
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
    expect(SLEEP_LINES).toContain(guy.bubble?.text);
    run(state, 20, random);
    expect(atWorkSpot(guy)).toBe(true);
    expect(guy.mode).toBe("sleep");
    expect(agentPose(guy, state.time)).toMatchObject({ pose: "sleep", facing: "up", seated: true });
    run(state, 60, random);
    expect(guy.mode).toBe("sleep");
    expect(officeCounts(state)).toEqual({ working: 0, idle: 0, asleep: 1 });
    syncOffice(state, [input("a", "working")], random);
    expect(WAKE_TO_WORK_LINES).toContain(guy.bubble?.text);
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
    // The crew brings the desks in one trip at a time.
    run(state, 90, random);
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

  describe("desks and the crew", () => {
    const deskTile = (state: OfficeState, index: number) => {
      const desk = state.layout.desks[index];
      return [state.layout.tiles[desk.desk.y][desk.desk.x], state.layout.tiles[desk.seat.y][desk.seat.x]];
    };

    it("starts with bare floor where the desks go", () => {
      const state = createOffice(buildOfficeLayout(12, 8, "office"));
      expect(state.placed.size).toBe(0);
      state.layout.desks.forEach((_, index) => expect(deskTile(state, index)).toEqual(["floor", "floor"]));
    });

    it("sends the crew in with a new guy's desk while he waits beside its spot, then sends them home", () => {
      const random = seededRandom(21);
      const state = createOffice(buildOfficeLayout(12, 8, "office"));
      syncOffice(state, [input("a", "working")], random);
      const guy = agent(state, "a");
      stepOffice(state, 0.05, random);
      expect(crewAgents(state)).toHaveLength(2);
      let sawWaiting = false;
      let sawCarrying = false;
      let sawChair = false;
      for (let elapsed = 0; elapsed < 40 && !(hasDesk(state, guy) && guy.mode === "type"); elapsed += 0.05) {
        stepOffice(state, 0.05, random);
        sawWaiting ||= guy.goal?.kind === "waitDesk" && guy.mode === "wait";
        sawCarrying ||= crewAgents(state).some((member) => member.crew?.carrying === "a" && agentPose(member, state.time).pose === "carry");
        sawChair ||= crewAgents(state).some((member) => member.crew?.chair === true);
      }
      expect(sawWaiting).toBe(true);
      expect(sawCarrying).toBe(true);
      expect(sawChair).toBe(true);
      expect(hasDesk(state, guy)).toBe(true);
      expect(state.placed.get(guy.deskIndex as number)).toBe("a");
      expect(deskTile(state, guy.deskIndex as number)).toEqual(["desk", "seat"]);
      expect(guy.mode).toBe("type");
      run(state, 30, random);
      expect(crewAgents(state)).toHaveLength(0);
    });

    it("has the crew carry an ended session's desk out", () => {
      const random = seededRandom(22);
      const state = createOffice(buildOfficeLayout(12, 8, "office"));
      syncOffice(state, [input("a", "working"), input("b", "working")], random, "seated");
      expect(crewAgents(state)).toHaveLength(0);
      const index = agent(state, "a").deskIndex as number;
      syncOffice(state, [input("b", "working")], random);
      stepOffice(state, 0.05, random);
      expect(crewAgents(state)).toHaveLength(2);
      let sawHauling = false;
      for (let elapsed = 0; elapsed < 60 && crewAgents(state).length > 0; elapsed += 0.05) {
        stepOffice(state, 0.05, random);
        sawHauling ||= crewAgents(state).some((member) => member.crew?.phase === "haul" && member.crew.carrying === "a");
      }
      expect(sawHauling).toBe(true);
      expect(state.placed.has(index)).toBe(false);
      expect(deskTile(state, index)).toEqual(["floor", "floor"]);
      expect(hasDesk(state, agent(state, "b"))).toBe(true);
      expect(crewAgents(state)).toHaveLength(0);
    });

    it("hands a newcomer a desk that's still standing instead of hauling it out", () => {
      const random = seededRandom(23);
      const state = createOffice(buildOfficeLayout(12, 8, "office"));
      syncOffice(state, [input("a", "working")], random, "seated");
      const index = agent(state, "a").deskIndex;
      syncOffice(state, [input("c", "working")], random);
      expect(agent(state, "c").deskIndex).toBe(index);
      expect(hasDesk(state, agent(state, "c"))).toBe(true);
    });

    it("puts everyone's desk in at once when the room changes shape", () => {
      const random = seededRandom(24);
      const state = createOffice(buildOfficeLayout(20, 12, "office"));
      syncOffice(state, [input("a", "working"), input("b", "idle")], random);
      run(state, 1, random);
      relayoutOffice(state, buildOfficeLayout(14, 9, "office"), random);
      expect(state.agents.filter((guy) => guy.crew === undefined).every((guy) => hasDesk(state, guy))).toBe(true);
      run(state, 30, random);
      expect(crewAgents(state)).toHaveLength(0);
    });
  });

  describe("you", () => {
    const office = (random: () => number) => {
      const state = createOffice(buildOfficeLayout(15, 11, "office", true));
      syncOffice(state, [input("a", "working"), input("b", "working")], random, "seated");
      syncYou(state, "you-look", random);
      return state;
    };

    it("starts you typing at your station, not counted with the sessions", () => {
      const random = seededRandom(21);
      const state = office(random);
      const you = youAgent(state) as Agent;
      expect(you.workSpot).toEqual(state.layout.station?.seat);
      expect(isAtStation(you)).toBe(true);
      expect(you.deskIndex).toBeUndefined();
      expect(officeCounts(state)).toEqual({ working: 2, idle: 0, asleep: 0 });
      syncOffice(state, [input("a", "working")], random);
      expect(youAgent(state)).toBeDefined();
    });

    it("takes a break now and then, visits busy guys, and comes back on his own", () => {
      const random = seededRandom(22);
      const state = office(random);
      const you = youAgent(state) as Agent;
      let away = 0;
      let visits = 0;
      let backAfterBreak = false;
      for (let step = 0; step < 6000; step++) {
        stepOffice(state, 0.05, random);
        if (!isAtStation(you)) {
          away++;
        } else if (away > 0) {
          backAfterBreak = true;
        }
        if (you.goal?.kind === "visit" && you.mode === "chat") {
          visits++;
        }
      }
      expect(away).toBeGreaterThan(0);
      expect(visits).toBeGreaterThan(0);
      expect(backAfterBreak).toBe(true);
    });

    it("runs you back to your desk when an event hits", () => {
      const random = seededRandom(23);
      const state = office(random);
      const you = youAgent(state) as Agent;
      for (let step = 0; step < 4000 && isAtStation(you); step++) {
        stepOffice(state, 0.05, random);
      }
      run(state, 2, random);
      expect(isAtStation(you)).toBe(false);
      callYouBack(state, random);
      expect(you.status).toBe("working");
      expect(you.running || isAtStation(you)).toBe(true);
      run(state, 10, random);
      expect(isAtStation(you)).toBe(true);
    });

    it("leaves when you're turned off", () => {
      const random = seededRandom(24);
      const state = office(random);
      syncYou(state, undefined, random);
      expect(youAgent(state)).toBeUndefined();
    });
  });

  describe("shows", () => {
    function showInput(kind: PerformanceKindId, random: () => number): ShowInput {
      const plan = planPerformance(random, kind);
      return {
        kind, title: plan.title, lines: plan.lines, closer: plan.closer, length: 30, food: plan.food,
        performers: PERFORMANCES[kind].roles.map((role, index) => ({ id: `show-${role}`, seed: `show-${role}`, title: plan.titles[index], role })),
      };
    }

    function settledOffice(random: () => number): OfficeState {
      const state = createOffice(buildOfficeLayout(14, 10, "office"));
      syncOffice(state, [input("busy", "working"), input("idle", "idle"), input("sleepy", "asleep"), input("idle2", "idle")], random, "seated");
      run(state, 5, random);
      return state;
    }

    it("walks the performers to the stage, gathers the idle and sleeping guys, and leaves the busy one typing", () => {
      const random = seededRandom(11);
      const state = settledOffice(random);
      expect(startShow(state, showInput("band", random), random)).toBe(true);
      expect(startShow(state, showInput("dj", random), random)).toBe(false);
      expect(showPerformers(state).length).toBeGreaterThanOrEqual(3);
      expect(officeCounts(state)).toEqual({ working: 1, idle: 2, asleep: 1 });
      run(state, 20, random);
      expect(state.show?.phase).toBe("playing");
      for (const performer of showPerformers(state)) {
        expect(performer.mode).toBe("perform");
        expect(performer.x).toBe(performer.performer?.spot.x);
        expect(performer.y).toBe(performer.performer?.spot.y);
      }
      run(state, 10, random);
      for (const id of ["idle", "sleepy", "idle2"]) {
        expect(agent(state, id).mode).toBe("watch");
      }
      expect(agent(state, "busy").mode).toBe("type");
      // Nobody stands on stage.
      const spots = new Set(state.show?.spots.map((spot) => `${spot.x},${spot.y}`));
      for (const id of ["idle", "sleepy", "idle2"]) {
        expect(spots.has(`${agent(state, id).x},${agent(state, id).y}`)).toBe(false);
      }
    });

    it("runs through its lines, takes a bow, and sends everyone back", () => {
      const random = seededRandom(12);
      const state = settledOffice(random);
      startShow(state, showInput("comedian", random), random);
      run(state, 60, random);
      expect(state.show).toBeUndefined();
      run(state, 30, random);
      expect(showPerformers(state)).toHaveLength(0);
      expect(agent(state, "sleepy").mode).toBe("sleep");
      expect(agent(state, "idle").mode).not.toBe("watch");
    });

    it("hands out food at a lunch, and the crowd eats", () => {
      const random = seededRandom(13);
      const state = settledOffice(random);
      startShow(state, showInput("lunch", random), random);
      run(state, 25, random);
      const guy = agent(state, "idle");
      expect(guy.mode).toBe("watch");
      expect(guy.snack).toBeDefined();
      expect(state.show?.food).toContain(guy.snack);
    });

    it("sends a guy who gets busy mid-show back to his desk", () => {
      const random = seededRandom(14);
      const state = settledOffice(random);
      startShow(state, showInput("guitarist", random), random);
      run(state, 25, random);
      expect(agent(state, "idle").mode).toBe("watch");
      syncOffice(state, [input("busy", "working"), input("idle", "working"), input("sleepy", "asleep"), input("idle2", "idle")], random);
      run(state, 15, random);
      expect(agent(state, "idle").mode).toBe("type");
    });

    it("ends early when asked, and the performers walk out", () => {
      const random = seededRandom(15);
      const state = settledOffice(random);
      startShow(state, showInput("magician", random), random);
      run(state, 20, random);
      endShow(state, random);
      expect(state.show).toBeUndefined();
      expect(showPerformers(state).every((performer) => performer.leaving)).toBe(true);
      run(state, 30, random);
      expect(showPerformers(state)).toHaveLength(0);
    });

    it("cheers and eats in their own poses", () => {
      const random = seededRandom(16);
      const state = settledOffice(random);
      startShow(state, showInput("dj", random), random);
      run(state, 25, random);
      const guy = agent(state, "idle");
      guy.cheerUntil = state.time + 1;
      expect(agentPose(guy, state.time).pose).toBe("cheer");
      guy.cheerUntil = 0;
      guy.bubble = undefined;
      guy.snack = "pizza";
      expect(agentPose(guy, state.time).pose).toBe("eat");
    });

    it("keeps the show going through a relayout that leaves the stage open", () => {
      const random = seededRandom(17);
      const state = settledOffice(random);
      startShow(state, showInput("guitarist", random), random);
      run(state, 20, random);
      relayoutOffice(state, buildOfficeLayout(14, 10, "office"), random);
      expect(state.show).toBeDefined();
      relayoutOffice(state, buildOfficeLayout(8, 6, "office"), random);
      run(state, 30, random);
      expect(state.show === undefined || state.show.phase !== "arriving").toBe(true);
    });
  });
});
