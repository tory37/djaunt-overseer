import { describe, expect, it } from "vitest";
import { LiveSession } from "../../src/liveParse";
import { previewRunState, previewTabTitle } from "../../src/sessionPreviewModel";

function liveSession(overrides: Partial<LiveSession>): LiveSession {
  return {
    sessionId: "a",
    agentId: undefined,
    pid: 4821,
    kind: "interactive",
    status: "idle",
    name: undefined,
    cwd: undefined,
    processCount: 1,
    ...overrides,
  };
}

describe("previewRunState", () => {
  it("offers a resume for a paused session", () => {
    expect(previewRunState(undefined)).toEqual({ stateLabel: "Paused", resumeLabel: "Resume", isElsewhere: false });
  });

  it("offers a fork for a session live in another terminal", () => {
    expect(previewRunState(liveSession({}))).toEqual({
      stateLabel: "Running in another terminal (pid 4821)",
      resumeLabel: "Fork here",
      isElsewhere: true,
    });
  });

  it("offers attach for a background agent", () => {
    const runState = previewRunState(liveSession({ kind: "background", agentId: "agent-1" }));
    expect(runState.resumeLabel).toBe("Attach or fork");
  });
});

describe("previewTabTitle", () => {
  it("shortens long titles", () => {
    expect(previewTabTitle("abcdefghij", 5)).toBe("Preview: abcd…");
    expect(previewTabTitle("abc", 5)).toBe("Preview: abc");
  });
});
