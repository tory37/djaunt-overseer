import { describe, expect, it } from "vitest";
import { LiveStatus } from "../../src/liveParse";
import { liveTransitions } from "../../src/liveTransitions";

function statuses(entries: Record<string, LiveStatus>): Map<string, LiveStatus> {
  return new Map(Object.entries(entries));
}

describe("liveTransitions", () => {
  it("reports a busy session that went idle", () => {
    expect(liveTransitions(statuses({ a: "busy" }), statuses({ a: "idle" }))).toEqual({ becameIdle: ["a"], leftIdle: [] });
  });

  it("reports an idle session that went busy again", () => {
    expect(liveTransitions(statuses({ a: "idle" }), statuses({ a: "busy" }))).toEqual({ becameIdle: [], leftIdle: ["a"] });
  });

  it("reports an idle session that ended", () => {
    expect(liveTransitions(statuses({ a: "idle" }), statuses({}))).toEqual({ becameIdle: [], leftIdle: ["a"] });
  });

  it("ignores a session seen for the first time", () => {
    expect(liveTransitions(statuses({}), statuses({ a: "idle", b: "busy" }))).toEqual({ becameIdle: [], leftIdle: [] });
  });

  it("ignores unchanged sessions and background sessions that go idle", () => {
    const transitions = liveTransitions(statuses({ a: "idle", b: "busy", c: "background" }), statuses({ a: "idle", b: "busy", c: "idle" }));
    expect(transitions).toEqual({ becameIdle: [], leftIdle: [] });
  });
});
