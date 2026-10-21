import { describe, expect, it } from "vitest";
import { isSameSessionFocus, nextSessionFocus } from "../../src/sessionFocusState";

const TERMINAL_FOCUS = { sessionId: "a", source: "terminal" as const };

describe("nextSessionFocus", () => {
  it("follows a Claude terminal", () => {
    expect(nextSessionFocus(undefined, { kind: "terminal", sessionId: "a" })).toEqual(TERMINAL_FOCUS);
  });

  it("clears focus on a plain terminal", () => {
    expect(nextSessionFocus(TERMINAL_FOCUS, { kind: "terminal", sessionId: undefined })).toBeUndefined();
  });

  it("follows the preview tab", () => {
    expect(nextSessionFocus(TERMINAL_FOCUS, { kind: "preview", sessionId: "b" })).toEqual({ sessionId: "b", source: "preview" });
  });

  it("keeps the last session when another tab gets focus", () => {
    expect(nextSessionFocus(TERMINAL_FOCUS, { kind: "otherTab" })).toBe(TERMINAL_FOCUS);
  });
});

describe("isSameSessionFocus", () => {
  it("compares session and source", () => {
    expect(isSameSessionFocus(TERMINAL_FOCUS, { sessionId: "a", source: "terminal" })).toBe(true);
    expect(isSameSessionFocus(TERMINAL_FOCUS, { sessionId: "a", source: "preview" })).toBe(false);
    expect(isSameSessionFocus(undefined, undefined)).toBe(true);
  });
});
