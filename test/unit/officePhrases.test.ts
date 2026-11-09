import { describe, expect, it } from "vitest";
import { OFFICE_SCENES } from "../../src/officeLayout";
import {
  BACK_LINES, BREAK_LINES, CHAT_EXCHANGES, CHAT_LINES, CHATTER_SYMBOLS, chatPhrase, CREW_BUILD_LINES, CREW_DONE_LINES, CREW_HELP_LINES,
  CREW_NEVER_MIND_LINES, CREW_REMOVE_LINES, CREW_START_LINES, exchangeAnswer, MUSE_LINES, pickExchange, pickPhrase, RUSH_LINES, SCENE_CHAT,
  SLEEP_LINES, THANKS_LINES, TYPING_LINES, WAIT_LINES, WAKE_IDLE_LINES, WAKE_TO_WORK_LINES,
} from "../../src/officePhrases";
import { seededRandom } from "../../src/pixelGuy";

const POOLS = {
  CHAT_LINES, TYPING_LINES, BREAK_LINES, BACK_LINES, RUSH_LINES, SLEEP_LINES, WAKE_TO_WORK_LINES, WAKE_IDLE_LINES, CREW_START_LINES,
  CREW_BUILD_LINES, CREW_DONE_LINES, CREW_REMOVE_LINES, CREW_HELP_LINES, CREW_NEVER_MIND_LINES, WAIT_LINES, THANKS_LINES,
  ...Object.fromEntries(Object.entries(MUSE_LINES).map(([mode, lines]) => [`MUSE_LINES.${mode}`, lines])),
  ...Object.fromEntries(Object.entries(SCENE_CHAT).map(([scene, lines]) => [`SCENE_CHAT.${scene}`, lines])),
};

describe("officePhrases", () => {
  it("has a pool of short, non-empty lines for every moment", () => {
    for (const [name, lines] of Object.entries(POOLS)) {
      expect(lines.length, name).toBeGreaterThan(4);
      for (const line of lines) {
        expect(line.trim().length, name).toBeGreaterThan(0);
        expect(line.length, `${name}: ${line}`).toBeLessThanOrEqual(32);
      }
    }
  });

  it("has scene chat for every scene", () => {
    for (const scene of OFFICE_SCENES) {
      expect(SCENE_CHAT[scene.id].length).toBeGreaterThanOrEqual(10);
    }
  });

  it("answers each exchange's opening line, and nothing else", () => {
    for (const [line, answer] of CHAT_EXCHANGES) {
      expect(exchangeAnswer(line)).toBe(answer);
    }
    expect(exchangeAnswer("lol")).toBeUndefined();
    expect(exchangeAnswer(pickExchange(seededRandom(4)))).toBeDefined();
  });

  it("mixes quick noises, small talk, and scene chat", () => {
    const random = seededRandom(9);
    const lines = Array.from({ length: 400 }, () => chatPhrase("moon", random));
    expect(lines.some((line) => line.split(" ").every((part) => CHATTER_SYMBOLS.includes(part)))).toBe(true);
    expect(lines.some((line) => CHAT_LINES.includes(line))).toBe(true);
    expect(lines.some((line) => SCENE_CHAT.moon.includes(line))).toBe(true);
    expect(Array.from({ length: 200 }, () => chatPhrase(undefined, random)).some((line) => SCENE_CHAT.moon.includes(line) && !CHAT_LINES.includes(line))).toBe(false);
  });

  it("picks within the list at the edges", () => {
    expect(pickPhrase(["a", "b"], () => 0)).toBe("a");
    expect(pickPhrase(["a", "b"], () => 0.9999)).toBe("b");
    expect(pickPhrase(["a", "b"], () => 1)).toBe("b");
  });
});
