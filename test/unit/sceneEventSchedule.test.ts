import { describe, expect, it } from "vitest";
import {
  DEFAULT_EVENT_MINUTES,
  DEFENSE_SCRIPTS,
  enabledSceneEvents,
  eventMinutes,
  firstSceneEventDelayMs,
  HACK_PHRASES,
  MAX_EVENT_MINUTES,
  MAX_GAP_FACTOR,
  MIN_EVENT_MINUTES,
  MIN_GAP_FACTOR,
  nextSceneEventDelayMs,
  pickSceneEvent,
  sceneEventMessage,
  validateEventMinutes,
} from "../../src/sceneEventSchedule";

const fixed = (value: number) => () => value;

describe("enabledSceneEvents", () => {
  it("keeps only the kinds the settings turn on", () => {
    expect(enabledSceneEvents(() => true)).toEqual(["error", "hack", "defense"]);
    expect(enabledSceneEvents((kind) => kind === "defense")).toEqual(["defense"]);
    expect(enabledSceneEvents(() => false)).toEqual([]);
  });
});

describe("pickSceneEvent", () => {
  it("skips when nothing is on", () => {
    expect(pickSceneEvent([], fixed(0.5))).toBeUndefined();
  });

  it("picks across the enabled kinds, including at the top of the random range", () => {
    expect(pickSceneEvent(["error", "hack", "defense"], fixed(0))).toBe("error");
    expect(pickSceneEvent(["error", "hack", "defense"], fixed(0.5))).toBe("hack");
    expect(pickSceneEvent(["error", "hack", "defense"], fixed(1))).toBe("defense");
    expect(pickSceneEvent(["hack"], fixed(0))).toBe("hack");
  });
});

describe("eventMinutes", () => {
  it("falls back to the default and clamps to the range", () => {
    expect(eventMinutes(undefined)).toBe(DEFAULT_EVENT_MINUTES);
    expect(eventMinutes("3")).toBe(DEFAULT_EVENT_MINUTES);
    expect(eventMinutes(Number.NaN)).toBe(DEFAULT_EVENT_MINUTES);
    expect(eventMinutes(0)).toBe(MIN_EVENT_MINUTES);
    expect(eventMinutes(500)).toBe(MAX_EVENT_MINUTES);
    expect(eventMinutes(7.5)).toBe(7.5);
  });
});

describe("validateEventMinutes", () => {
  it("accepts numbers in range and explains the rest", () => {
    expect(validateEventMinutes("0.5")).toBeUndefined();
    expect(validateEventMinutes(" 60 ")).toBeUndefined();
    expect(validateEventMinutes("")).toBeDefined();
    expect(validateEventMinutes("soon")).toBeDefined();
    expect(validateEventMinutes("0.25")).toBeDefined();
    expect(validateEventMinutes("61")).toBeDefined();
  });
});

describe("nextSceneEventDelayMs", () => {
  it("waits a random 0.6x to 1.6x of the average minutes", () => {
    expect(nextSceneEventDelayMs(5, fixed(0))).toBe(5 * MIN_GAP_FACTOR * 60_000);
    expect(nextSceneEventDelayMs(5, fixed(1))).toBe(5 * MAX_GAP_FACTOR * 60_000);
    expect(nextSceneEventDelayMs(0, fixed(0))).toBe(Math.round(MIN_EVENT_MINUTES * MIN_GAP_FACTOR * 60_000));
  });
});

describe("firstSceneEventDelayMs", () => {
  it("plays the first event after 2 minutes, or sooner when events are more frequent", () => {
    expect(firstSceneEventDelayMs(5)).toBe(2 * 60_000);
    expect(firstSceneEventDelayMs(0.5)).toBe(30_000);
  });
});

describe("sceneEventMessage", () => {
  it("carries the kind and a variant in range for that kind", () => {
    expect(sceneEventMessage("hack", fixed(0))).toEqual({ type: "sceneEvent", kind: "hack", variant: 0 });
    expect(sceneEventMessage("hack", fixed(1)).variant).toBe(HACK_PHRASES.length - 1);
    expect(sceneEventMessage("defense", fixed(1)).variant).toBe(DEFENSE_SCRIPTS.length - 1);
    expect(sceneEventMessage("error", fixed(1)).variant).toBe(0);
  });
});
