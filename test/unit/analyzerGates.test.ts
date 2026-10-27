import { describe, expect, it } from "vitest";
import {
  AnalyzerGateInput,
  analyzerGateSettingsFrom,
  DEFAULT_ANALYZER_GATE_SETTINGS,
  hasCandidateSince,
  shouldAutoAnalyze,
} from "../../src/analyzerGates";
import { LinkCandidate } from "../../src/linkCandidates";

const NOW = 1_800_000_000_000;
const MINUTE_MS = 60_000;

function gateInput(overrides: Partial<AnalyzerGateInput> = {}): AnalyzerGateInput {
  return {
    settings: DEFAULT_ANALYZER_GATE_SETTINGS,
    stats: { newBytes: 20 * 1024, newUserPromptCount: 2 },
    hasNewCandidate: false,
    lastPassAt: NOW - 30 * MINUTE_MS,
    now: NOW,
    inFlight: false,
    ...overrides,
  };
}

function candidate(firstSeenOffsetBytes: number | undefined): LinkCandidate {
  return { kind: "pr", id: "amira/soda-api/pull/41", url: undefined, title: undefined, signals: {}, snippets: [], firstSeen: undefined, lastSeen: undefined, firstSeenOffsetBytes };
}

describe("shouldAutoAnalyze", () => {
  it("runs when every gate passes", () => {
    expect(shouldAutoAnalyze(gateInput())).toEqual({ run: true, reason: "2 new prompts and 20.0 KB new" });
  });

  it("skips when auto is off", () => {
    const decision = shouldAutoAnalyze(gateInput({ settings: { ...DEFAULT_ANALYZER_GATE_SETTINGS, isAutoEnabled: false } }));
    expect(decision).toEqual({ run: false, reason: "auto is off" });
  });

  it("skips while a pass is in flight", () => {
    expect(shouldAutoAnalyze(gateInput({ inFlight: true }))).toEqual({ run: false, reason: "a pass is already running" });
  });

  it("skips with fewer new prompts than the minimum", () => {
    const decision = shouldAutoAnalyze(gateInput({ stats: { newBytes: 50 * 1024, newUserPromptCount: 0 } }));
    expect(decision).toEqual({ run: false, reason: "0 new prompts, needs 1" });
  });

  it("runs with exactly the minimum of new prompts and bytes", () => {
    const decision = shouldAutoAnalyze(gateInput({ stats: { newBytes: 10 * 1024, newUserPromptCount: 1 } }));
    expect(decision.run).toBe(true);
  });

  it("skips with too few new bytes and no new candidate", () => {
    const decision = shouldAutoAnalyze(gateInput({ stats: { newBytes: 2048, newUserPromptCount: 3 } }));
    expect(decision).toEqual({ run: false, reason: "2.0 KB new and no new link, needs 10 KB or a new link" });
  });

  it("runs with too few new bytes when a candidate is new, since bytes and candidates are an OR", () => {
    const decision = shouldAutoAnalyze(gateInput({ stats: { newBytes: 2048, newUserPromptCount: 1 }, hasNewCandidate: true }));
    expect(decision).toEqual({ run: true, reason: "1 new prompts and a new link" });
  });

  it("skips inside the cooldown", () => {
    const decision = shouldAutoAnalyze(gateInput({ lastPassAt: NOW - 9 * MINUTE_MS }));
    expect(decision).toEqual({ run: false, reason: "cooldown, 60s left" });
  });

  it("runs once the cooldown has elapsed", () => {
    expect(shouldAutoAnalyze(gateInput({ lastPassAt: NOW - 10 * MINUTE_MS })).run).toBe(true);
  });

  it("runs with no earlier pass", () => {
    expect(shouldAutoAnalyze(gateInput({ lastPassAt: undefined })).run).toBe(true);
  });
});

describe("hasCandidateSince", () => {
  it("finds a candidate first seen after the watermark", () => {
    expect(hasCandidateSince([candidate(100), candidate(5000)], 4000)).toBe(true);
  });

  it("ignores candidates first seen at or before the watermark, or with no offset", () => {
    expect(hasCandidateSince([candidate(4000), candidate(undefined)], 4000)).toBe(false);
  });
});

describe("analyzerGateSettingsFrom", () => {
  it("reads each setting under its config key", () => {
    const configValues: Record<string, unknown> = { auto: false, idleSeconds: 5, minNewKb: 2, minNewPrompts: 3, cooldownMinutes: 0 };
    expect(analyzerGateSettingsFrom((configKey) => configValues[configKey])).toEqual({
      isAutoEnabled: false,
      idleSeconds: 5,
      minNewKb: 2,
      minNewPrompts: 3,
      cooldownMinutes: 0,
    });
  });

  it("falls back to the defaults for missing or malformed values", () => {
    const configValues: Record<string, unknown> = { auto: "yes", idleSeconds: -4, minNewKb: "10", minNewPrompts: Number.NaN };
    expect(analyzerGateSettingsFrom((configKey) => configValues[configKey])).toEqual(DEFAULT_ANALYZER_GATE_SETTINGS);
  });
});
