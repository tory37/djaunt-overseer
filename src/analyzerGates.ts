import type { LinkCandidate, TranscriptScanStats } from "./linkCandidates";

const BYTES_PER_KB = 1024;
const MS_PER_MINUTE = 60_000;

export interface AnalyzerGateSettings {
  isAutoEnabled: boolean;
  idleSeconds: number;
  minNewKb: number;
  minNewPrompts: number;
  cooldownMinutes: number;
}

export const DEFAULT_ANALYZER_GATE_SETTINGS: AnalyzerGateSettings = {
  isAutoEnabled: true,
  idleSeconds: 30,
  minNewKb: 10,
  minNewPrompts: 1,
  cooldownMinutes: 10,
};

// The keys under overseer.analyzer that hold each gate setting.
export const ANALYZER_GATE_CONFIG_KEYS: Record<keyof AnalyzerGateSettings, string> = {
  isAutoEnabled: "auto",
  idleSeconds: "idleSeconds",
  minNewKb: "minNewKb",
  minNewPrompts: "minNewPrompts",
  cooldownMinutes: "cooldownMinutes",
};

export interface AnalyzerGateDecision {
  run: boolean;
  reason: string;
}

export interface AnalyzerGateInput {
  settings: AnalyzerGateSettings;
  stats: Pick<TranscriptScanStats, "newBytes" | "newUserPromptCount">;
  hasNewCandidate: boolean;
  lastPassAt: number | undefined;
  now: number;
  inFlight: boolean;
}

// A hand-edited settings.json can hold anything, so each value falls back to its default unless it has the right type.
export function analyzerGateSettingsFrom(readSetting: (configKey: string) => unknown): AnalyzerGateSettings {
  const autoValue = readSetting(ANALYZER_GATE_CONFIG_KEYS.isAutoEnabled);
  const numberSetting = (settingName: Exclude<keyof AnalyzerGateSettings, "isAutoEnabled">): number => {
    const value = readSetting(ANALYZER_GATE_CONFIG_KEYS[settingName]);
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : DEFAULT_ANALYZER_GATE_SETTINGS[settingName];
  };
  return {
    isAutoEnabled: typeof autoValue === "boolean" ? autoValue : DEFAULT_ANALYZER_GATE_SETTINGS.isAutoEnabled,
    idleSeconds: numberSetting("idleSeconds"),
    minNewKb: numberSetting("minNewKb"),
    minNewPrompts: numberSetting("minNewPrompts"),
    cooldownMinutes: numberSetting("cooldownMinutes"),
  };
}

export function hasCandidateSince(candidates: LinkCandidate[], watermarkBytes: number): boolean {
  return candidates.some((candidate) => (candidate.firstSeenOffsetBytes ?? 0) > watermarkBytes);
}

export function shouldAutoAnalyze(input: AnalyzerGateInput): AnalyzerGateDecision {
  const { settings, stats, hasNewCandidate, lastPassAt, now, inFlight } = input;
  if (!settings.isAutoEnabled) {
    return { run: false, reason: "auto is off" };
  }
  if (inFlight) {
    return { run: false, reason: "a pass is already running" };
  }
  if (stats.newUserPromptCount < settings.minNewPrompts) {
    return { run: false, reason: `${stats.newUserPromptCount} new prompts, needs ${settings.minNewPrompts}` };
  }
  const newKb = stats.newBytes / BYTES_PER_KB;
  const hasEnoughNewBytes = newKb >= settings.minNewKb;
  if (!hasEnoughNewBytes && !hasNewCandidate) {
    return { run: false, reason: `${newKb.toFixed(1)} KB new and no new link, needs ${settings.minNewKb} KB or a new link` };
  }
  const cooldownMs = settings.cooldownMinutes * MS_PER_MINUTE;
  if (lastPassAt !== undefined && now - lastPassAt < cooldownMs) {
    const remainingSeconds = Math.ceil((cooldownMs - (now - lastPassAt)) / 1000);
    return { run: false, reason: `cooldown, ${remainingSeconds}s left` };
  }
  const contentReason = hasEnoughNewBytes ? `${newKb.toFixed(1)} KB new` : "a new link";
  return { run: true, reason: `${stats.newUserPromptCount} new prompts and ${contentReason}` };
}
