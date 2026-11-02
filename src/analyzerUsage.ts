import * as path from "path";
import { AnalyzerMode } from "./analyzerDigest";
import { RunUsage } from "./analyzerOps";
import { AnalyzerCall } from "./analyzerPass";

const OVERSEER_DIR_NAME = "overseer";
const USAGE_FILE_NAME = "analyzer-usage.jsonl";
const BYTES_PER_KB = 1024;

export type AnalyzerUsageOutcome = "updated" | "failed";

// One analyzer call, flattened so a jq or Node one-liner can filter and sum the file.
export interface AnalyzerUsageRecord extends RunUsage {
  at: string;
  sessionId: string;
  requestedMode: AnalyzerMode;
  digestMode: AnalyzerMode;
  model: string;
  passOutcome: AnalyzerUsageOutcome;
  digestBytes: number;
}

export interface AnalyzerUsageInput {
  at: number;
  sessionId: string;
  requestedMode: AnalyzerMode;
  passOutcome: AnalyzerUsageOutcome;
  calls: AnalyzerCall[];
}

export function usageRecordsOf(input: AnalyzerUsageInput): AnalyzerUsageRecord[] {
  const at = new Date(input.at).toISOString();
  return input.calls.map((call) => ({
    at,
    sessionId: input.sessionId,
    requestedMode: input.requestedMode,
    digestMode: call.digestMode,
    model: call.model,
    passOutcome: input.passOutcome,
    digestBytes: call.digestBytes,
    ...call.usage,
  }));
}

export function usageJsonLines(records: AnalyzerUsageRecord[]): string {
  return records.map((record) => `${JSON.stringify(record)}\n`).join("");
}

export function usageLogLine(record: AnalyzerUsageRecord): string {
  const parts = [record.model, record.digestMode, `${(record.digestBytes / BYTES_PER_KB).toFixed(1)} KB`];
  // The CLI caches the prompt, so most input arrives as cache writes, not inputTokens.
  const inputCounts = [record.inputTokens, record.cacheReadTokens, record.cacheWriteTokens].filter((count) => count !== undefined);
  if (inputCounts.length > 0) {
    const totalInputTokens = inputCounts.reduce((total, count) => total + count, 0);
    parts.push(`in ${totalInputTokens.toLocaleString("en-US")}`);
  }
  if (record.outputTokens !== undefined) {
    parts.push(`out ${record.outputTokens.toLocaleString("en-US")}`);
  }
  parts.push(record.costUsd === undefined ? "cost unknown" : `$${record.costUsd.toFixed(4)}`);
  return parts.join(" ");
}

export function analyzerUsageFile(claudeHome: string): string {
  return path.join(claudeHome, OVERSEER_DIR_NAME, USAGE_FILE_NAME);
}
