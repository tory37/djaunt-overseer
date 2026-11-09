import { describe, expect, it } from "vitest";
import { bubbleAlpha, bubbleLimit, ChatLine, chatterStyle, layoutChatter, LOG_KEEP, pushChatLog, visibleChatLog } from "../../src/officeChatter";

const line = (id: string, since: number, priority: ChatLine["priority"] = "normal", until = since + 4): ChatLine => ({ id, text: id, since, until, priority });

describe("chatterStyle", () => {
  it("reads the setting and defaults to tidy", () => {
    expect(chatterStyle("log")).toBe("log");
    expect(chatterStyle("bubbles")).toBe("bubbles");
    expect(chatterStyle("loud")).toBe("tidy");
    expect(chatterStyle(undefined)).toBe("tidy");
  });
});

describe("bubbleLimit", () => {
  it("allows about one bubble per four tiles, at least two", () => {
    expect(bubbleLimit(4)).toBe(2);
    expect(bubbleLimit(12)).toBe(3);
    expect(bubbleLimit(24)).toBe(6);
  });
});

describe("layoutChatter", () => {
  const lines = [line("a", 0), line("b", 1), line("c", 2), line("d", 3)];

  it("bubbles every line in bubbles style", () => {
    const chat = layoutChatter(lines, "bubbles", new Set(), 2, 3);
    expect([...chat.full]).toEqual(["a", "b", "c", "d"]);
    expect(chat.pips.size).toBe(0);
  });

  it("caps bubbles in tidy, oldest first, the rest as pips", () => {
    const chat = layoutChatter(lines, "tidy", new Set(), 2, 2);
    expect([...chat.full].sort()).toEqual(["a", "b"]);
    expect([...chat.pips].sort()).toEqual(["c", "d"]);
  });

  it("keeps a shown bubble until its line ends", () => {
    const chat = layoutChatter([line("x", 0, "high"), ...lines], "tidy", new Set(["c", "d"]), 2, 3);
    expect([...chat.full].sort()).toEqual(["c", "d"]);
  });

  it("puts high priority lines ahead in tidy", () => {
    const chat = layoutChatter([...lines, line("v", 3, "high")], "tidy", new Set(), 2, 3);
    expect(chat.full.has("v")).toBe(true);
  });

  it("doesn't promote a line with too little time left to read", () => {
    const chat = layoutChatter([line("short", 0, "normal", 3.5)], "tidy", new Set(), 2, 3);
    expect(chat.pips.has("short")).toBe(true);
  });

  it("always bubbles must lines and the hovered guy, even past the cap", () => {
    const chat = layoutChatter([...lines, line("show", 3, "must")], "tidy", new Set(["a", "b"]), 2, 3, "d");
    expect(chat.full.has("show")).toBe(true);
    expect(chat.full.has("d")).toBe(true);
  });

  it("shows only pips in log and quiet, apart from must lines and the hovered guy", () => {
    for (const style of ["log", "quiet"] as const) {
      const chat = layoutChatter([...lines, line("show", 3, "must")], style, new Set(["a"]), 4, 3, "b");
      expect([...chat.full].sort()).toEqual(["b", "show"]);
      expect([...chat.pips].sort()).toEqual(["a", "c", "d"]);
    }
  });
});

describe("chat log", () => {
  it("keeps the newest lines and folds a repeat", () => {
    let log = pushChatLog([], { id: "a", text: "hi", at: 0 });
    log = pushChatLog(log, { id: "a", text: "hi", at: 1 });
    expect(log).toHaveLength(1);
    for (let index = 0; index < LOG_KEEP + 5; index++) {
      log = pushChatLog(log, { id: "b", text: `line ${index}`, at: index });
    }
    expect(log).toHaveLength(LOG_KEEP);
    expect(log[log.length - 1].text).toBe(`line ${LOG_KEEP + 4}`);
  });

  it("shows recent lines, fading the old ones out", () => {
    const log = [{ id: "a", text: "old", at: 0 }, { id: "b", text: "mid", at: 3 }, { id: "c", text: "new", at: 9.5 }];
    const visible = visibleChatLog(log, 10, 5);
    expect(visible.map((line) => line.entry.text)).toEqual(["mid", "new"]);
    expect(visible[1].alpha).toBe(1);
    expect(visibleChatLog(log, 11, 5)[0].alpha).toBeLessThan(1);
    expect(visibleChatLog(log, 10, 1).map((line) => line.entry.text)).toEqual(["new"]);
  });
});

describe("bubbleAlpha", () => {
  it("fades in and out", () => {
    expect(bubbleAlpha(0, 4, 0)).toBe(0);
    expect(bubbleAlpha(0, 4, 2)).toBe(1);
    expect(bubbleAlpha(0, 4, 3.85)).toBeCloseTo(0.5);
    expect(bubbleAlpha(-Infinity, Infinity, 5)).toBe(1);
  });
});
