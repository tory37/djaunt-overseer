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

  it("falls back to the active terminal when the preview closes", () => {
    const previewFocus = { sessionId: "b", source: "preview" as const };
    expect(nextSessionFocus(previewFocus, { kind: "previewClosed", terminalSessionId: "a" })).toEqual(TERMINAL_FOCUS);
    expect(nextSessionFocus(previewFocus, { kind: "previewClosed", terminalSessionId: undefined })).toBeUndefined();
  });

  it("ignores a closed preview it wasn't following", () => {
    expect(nextSessionFocus(TERMINAL_FOCUS, { kind: "previewClosed", terminalSessionId: undefined })).toBe(TERMINAL_FOCUS);
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
