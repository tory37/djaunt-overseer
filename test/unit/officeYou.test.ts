import { describe, expect, it } from "vitest";
import { AFTERMATH_SECONDS, defenseProgress, roomReaction, ROOM_REACTIONS, yourEventSeconds, yourIdleReaction, yourReaction } from "../../src/officeYou";
import { DEFENSE_BEATS, DEFENSE_SCRIPTS, EVENT_SECONDS, HACK_PHRASES } from "../../src/sceneEventSchedule";

describe("yourReaction", () => {
  it("types at his desk with nothing going on", () => {
    expect(yourReaction(undefined, 3)).toMatchObject({ pose: "type", facing: "up", seated: true, screen: "code", bubble: undefined, shake: 0 });
  });

  it("leans back and gets up for a sip now and then", () => {
    expect(yourIdleReaction(18)).toMatchObject({ pose: "sit", seated: true });
    expect(yourIdleReaction(22)).toMatchObject({ pose: "drink", facing: "down", seated: false });
    expect(yourIdleReaction(22, 4).pose).not.toBe("drink");
  });

  it("jumps up at an ERROR, then sighs and goes back to work", () => {
    expect(yourReaction({ kind: "error", variant: 0, age: 0.1 }, 1)).toMatchObject({ screen: "error", shake: 1 });
    expect(yourReaction({ kind: "error", variant: 0, age: 0.8 }, 1)).toMatchObject({ pose: "stand", facing: "down", seated: false, bubble: "!!" });
    expect(yourReaction({ kind: "error", variant: 0, age: 2 }, 1)).toMatchObject({ pose: "stretch", bubble: "WHAT?!" });
    expect(yourReaction({ kind: "error", variant: 0, age: EVENT_SECONDS.error + 0.5 }, 1)).toMatchObject({ pose: "sit", bubble: "*sigh*" });
    expect(yourReaction({ kind: "error", variant: 0, age: yourEventSeconds("error") }, 1).screen).toBe("code");
  });

  it("hacks at full speed on falling code, then cheers the HACK's lines", () => {
    const [line, answer] = HACK_PHRASES[2];
    const typing = yourReaction({ kind: "hack", variant: 2, age: 2 }, 1);
    expect(typing).toMatchObject({ pose: "type", screen: "matrix", bubble: "I'm in." });
    expect(yourReaction({ kind: "hack", variant: 2, age: 3 }, 1)).toMatchObject({ seated: false, screen: "granted", bubble: line });
    expect(yourReaction({ kind: "hack", variant: 2, age: 4.5 }, 1).bubble).toBe(answer);
  });

  it("follows the DEFENSE script beat by beat, with the progress bar", () => {
    const lines = DEFENSE_SCRIPTS[1];
    const at = (age: number) => yourReaction({ kind: "defense", variant: 1, age }, 1);
    expect(at(0.5)).toMatchObject({ screen: "alert", seated: false, bubble: lines[0], progress: 0 });
    expect(at(DEFENSE_BEATS[1] + 0.5)).toMatchObject({ pose: "type", screen: "progress", bubble: lines[1] });
    expect(at(DEFENSE_BEATS[2] + 1)).toMatchObject({ screen: "progress", bubble: lines[2], shake: 1 });
    expect(at(DEFENSE_BEATS[3] + 0.2)).toMatchObject({ screen: "shield", bubble: lines[3], progress: 100 });
    expect(at(DEFENSE_BEATS[3] + 1.5).bubble).toBe(lines[4]);
    expect(at(EVENT_SECONDS.defense + AFTERMATH_SECONDS / 2)).toMatchObject({ pose: "sit", screen: "shield" });
  });

  it("climbs the progress bar and never goes past 99 before the end", () => {
    let last = 0;
    for (let beatAge = 0; beatAge <= 2; beatAge += 0.1) {
      const progress = defenseProgress(1, beatAge, DEFENSE_BEATS[1] + beatAge);
      expect(progress).toBeGreaterThanOrEqual(last);
      last = progress;
    }
    for (let beatAge = 0; beatAge <= 1.6; beatAge += 0.1) {
      expect(defenseProgress(2, beatAge, DEFENSE_BEATS[2] + beatAge)).toBeLessThanOrEqual(99);
    }
  });
});

describe("roomReaction", () => {
  it("says one of the kind's lines, or nothing", () => {
    expect(roomReaction("hack", () => 0.1)).toBeUndefined();
    expect(ROOM_REACTIONS.error).toContain(roomReaction("error", () => 0.5));
    expect(ROOM_REACTIONS.defense).toContain(roomReaction("defense", () => 0.9999));
  });
});
