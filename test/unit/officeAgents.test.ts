import { describe, expect, it } from "vitest";
import { officeAgents, OfficeAgentSources } from "../../src/officeAgents";
import { settingsToMove } from "../../src/officeSettingsMigration";

const sources = (change: Partial<OfficeAgentSources> = {}): OfficeAgentSources => ({
  pinned: [{ sessionId: "a" }, { sessionId: "b" }, { sessionId: "c" }, { sessionId: "t", terminal: {} }, { sessionId: "a" }] as unknown as OfficeAgentSources["pinned"],
  liveStatus: (id) => ({ a: "busy", b: "idle" } as Record<string, "busy" | "idle">)[id],
  showSleepers: true,
  seed: (id) => (id === "b" ? "lucky" : id),
  look: (id) => (id === "c" ? { shirt: "#123456" } : undefined),
  title: (id) => `Session ${id}`,
  focusedId: "b",
  ...change,
});

describe("officeAgents", () => {
  it("gives each Claude session one guy with its status, seed, look, and the crown", () => {
    expect(officeAgents(sources())).toEqual([
      { id: "a", seed: "a", status: "busy", title: "Session a" },
      { id: "b", seed: "lucky", status: "idle", title: "Session b", highlighted: true },
      { id: "c", seed: "c", status: "asleep", title: "Session c", look: { shirt: "#123456" } },
    ]);
  });

  it("leaves suspended sessions out with sleepers off", () => {
    expect(officeAgents(sources({ showSleepers: false })).map((agent) => agent.id)).toEqual(["a", "b"]);
  });
});

describe("settingsToMove", () => {
  it("moves only settings you set that the Office doesn't have yet", () => {
    const values: Record<string, { old: unknown; current: unknown }> = {
      scene: { old: "moon", current: undefined },
      chatter: { old: "log", current: "tidy" },
      yourLook: { old: { race: "orc" }, current: undefined },
      you: { old: false, current: undefined },
    };
    expect(settingsToMove((name) => values[name] ?? { old: undefined, current: undefined })).toEqual([
      { key: "officeSim.scene", value: "moon" },
      { key: "officeSim.you", value: false },
      { key: "officeSim.yourLook", value: { race: "orc" } },
    ]);
  });
});
