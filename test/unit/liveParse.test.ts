import { describe, expect, it } from "vitest";
import { parseAgentsJson } from "../../src/liveParse";

describe("parseAgentsJson", () => {
  it("keeps interactive and running background sessions, drops finished ones", () => {
    const agentsJson = JSON.stringify([
      { pid: 101, cwd: "/repo", kind: "interactive", sessionId: "busy-one", name: "a", status: "busy" },
      { pid: 102, cwd: "/repo", kind: "interactive", sessionId: "idle-one", name: "b", status: "idle" },
      { id: "bg1", cwd: "/repo", kind: "background", sessionId: "bg-running", name: "c", state: "running" },
      { id: "bg2", cwd: "/repo", kind: "background", sessionId: "bg-failed", name: "d", state: "failed" },
      { id: "bg3", cwd: "/repo", kind: "background", sessionId: "bg-stopped", name: "e", state: "stopped" },
    ]);

    const liveSessions = parseAgentsJson(agentsJson);

    expect([...liveSessions.keys()]).toEqual(["busy-one", "idle-one", "bg-running"]);
    expect(liveSessions.get("busy-one")?.status).toBe("busy");
    expect(liveSessions.get("idle-one")).toMatchObject({ status: "idle", pid: 102 });
    expect(liveSessions.get("bg-running")).toMatchObject({ status: "background", pid: undefined });
  });

  it("counts duplicate processes of one session and reports busy if any copy is busy", () => {
    const agentsJson = JSON.stringify([
      { pid: 201, kind: "interactive", sessionId: "twice", status: "idle" },
      { pid: 202, kind: "interactive", sessionId: "twice", status: "busy" },
    ]);

    const liveSession = parseAgentsJson(agentsJson).get("twice");

    expect(liveSession).toMatchObject({ pid: 201, status: "busy", processCount: 2 });
  });

  it.each([["not json"], ["{}"], ["[null, 3, {\"pid\": 1}]"]])("returns an empty map for %s", (agentsJson) => {
    expect(parseAgentsJson(agentsJson).size).toBe(0);
  });
});
