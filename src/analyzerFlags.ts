import * as path from "path";
import type { SessionAnalysis } from "./analysisState";
import type { AnalyzerMode } from "./analyzerDigest";
import type { AnalyzerGateDecision, AnalyzerGateSettings } from "./analyzerGates";
import type { AnalyzerModels } from "./analyzerPass";
import type { AnalyzerUsageRecord } from "./analyzerUsage";
import type { LiveStatus } from "./liveParse";
import type { HoverSummary } from "./sessionSummary";

const OVERSEER_DIR_NAME = "overseer";
const FLAGS_FILE_NAME = "analyzer-flags.jsonl";
export const MAX_RECENT_DECISIONS = 20;
export const MAX_RECENT_USAGE_ROWS = 5;

export type AnalyzerDecisionTrigger = "auto" | AnalyzerMode;

// "run" and "skip" are gate decisions; the rest are pass outcomes.
export type AnalyzerVerdict = "run" | "skip" | "updated" | "skipped" | "failed";

export interface AnalyzerDecision {
  at: string;
  trigger: AnalyzerDecisionTrigger;
  verdict: AnalyzerVerdict;
  reason: string;
}

export interface AnalyzerGateSnapshot extends AnalyzerGateDecision {
  newBytes?: number;
  newUserPromptCount?: number;
  hasNewCandidate?: boolean;
}

export interface ShownStatus {
  name: string;
  reason?: string;
  isDerived: boolean;
}

export interface AnalyzerFlagInput {
  at: number;
  sessionId: string;
  title: string;
  note?: string;
  liveStatus?: LiveStatus;
  summary?: HoverSummary;
  status?: ShownStatus;
  analysis?: SessionAnalysis;
  transcriptBytes?: number;
  gate?: AnalyzerGateSnapshot;
  settings: AnalyzerGateSettings;
  models: AnalyzerModels;
  recentDecisions: AnalyzerDecision[];
  recentUsage?: AnalyzerUsageRecord[];
}

// One click's snapshot of what the Session sidebar showed and why the analyzer did or didn't run.
export interface AnalyzerFlagRecord {
  at: string;
  sessionId: string;
  title: string;
  note?: string;
  liveStatus: LiveStatus | "none";
  shown: {
    summary?: { text: string; source: HoverSummary["source"]; writtenAt: string; isStale: boolean };
    status?: ShownStatus;
    where: string[];
    workstreams: { id: string; title: string; done: boolean; itemKeys: string[]; ticketKeys: string[] }[];
  };
  analysis?: { lastPassAt?: string; lastModel?: string; watermarkBytes: number; transcriptBytes?: number };
  gate?: AnalyzerGateSnapshot;
  settings: AnalyzerGateSettings & AnalyzerModels;
  recentDecisions: AnalyzerDecision[];
  recentUsage?: AnalyzerUsageRecord[];
}

export function withDecision(decisions: AnalyzerDecision[], decision: AnalyzerDecision): AnalyzerDecision[] {
  return [...decisions, decision].slice(-MAX_RECENT_DECISIONS);
}

// The usage file may be read from the middle, so a cut first line or a hand-edited line is skipped.
export function recentUsageOf(usageJsonLinesText: string, sessionId: string): AnalyzerUsageRecord[] {
  const sessionRecords: AnalyzerUsageRecord[] = [];
  for (const line of usageJsonLinesText.split("\n")) {
    const record = parseJsonObject(line);
    if (record !== undefined && record.sessionId === sessionId) {
      sessionRecords.push(record as unknown as AnalyzerUsageRecord);
    }
  }
  return sessionRecords.slice(-MAX_RECENT_USAGE_ROWS);
}

export function analyzerFlagRecordOf(input: AnalyzerFlagInput): AnalyzerFlagRecord {
  const { analysis, summary } = input;
  const note = input.note?.trim();
  const record: AnalyzerFlagRecord = {
    at: new Date(input.at).toISOString(),
    sessionId: input.sessionId,
    title: input.title,
    ...(note ? { note } : {}),
    liveStatus: input.liveStatus ?? "none",
    shown: {
      ...(summary === undefined
        ? {}
        : { summary: { text: summary.text, source: summary.source, writtenAt: new Date(summary.writtenAtMs).toISOString(), isStale: summary.isStale } }),
      ...(input.status === undefined ? {} : { status: input.status }),
      where: analysis?.where ?? [],
      workstreams: (analysis?.workstreams ?? []).map(({ id, title, done, itemKeys, ticketKeys }) => ({ id, title, done, itemKeys, ticketKeys })),
    },
    settings: { ...input.settings, ...input.models },
    recentDecisions: input.recentDecisions,
  };
  if (analysis !== undefined) {
    record.analysis = {
      ...(analysis.lastPassAt === undefined ? {} : { lastPassAt: new Date(analysis.lastPassAt).toISOString() }),
      ...(analysis.lastModel === undefined ? {} : { lastModel: analysis.lastModel }),
      watermarkBytes: analysis.watermarkBytes,
      ...(input.transcriptBytes === undefined ? {} : { transcriptBytes: input.transcriptBytes }),
    };
  }
  if (input.gate !== undefined) {
    record.gate = input.gate;
  }
  if (input.recentUsage !== undefined) {
    record.recentUsage = input.recentUsage;
  }
  return record;
}

export function flagJsonLine(record: AnalyzerFlagRecord): string {
  return `${JSON.stringify(record)}\n`;
}

export function analyzerFlagsFile(claudeHome: string): string {
  return path.join(claudeHome, OVERSEER_DIR_NAME, FLAGS_FILE_NAME);
}

function parseJsonObject(line: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
