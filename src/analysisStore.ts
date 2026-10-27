import * as fs from "fs";
import * as path from "path";
import { AGENT_TICKETS_SCHEMA_VERSION, declaredTicketsFile, readDeclaredTickets } from "./agentTickets";
import { AGENT_TRACKER_SCHEMA_VERSION, readSessionWhere, whereFile } from "./agentTracker";
import { AGENT_WORK_SCHEMA_VERSION, declaredWorkFile, readSessionWork } from "./agentWork";
import { LegacySessionData } from "./analysisSeed";
import { ANALYSIS_SCHEMA_VERSION, readSessionAnalysis, SessionAnalysis } from "./analysisState";
import { loadVersionedCache, saveVersionedCache } from "./linkCache";
import type { LinkMarks } from "./registry";

const OVERSEER_DIR_NAME = "overseer";
const ANALYSIS_DIR_NAME = "analysis";

export function analysisDir(claudeHome: string): string {
  return path.join(claudeHome, OVERSEER_DIR_NAME, ANALYSIS_DIR_NAME);
}

export function analysisFile(claudeHome: string, sessionId: string): string {
  return path.join(analysisDir(claudeHome), `${sessionId}.json`);
}

// Undefined means no file yet or one from an older schema, which calls for a fresh seed. A corrupt file reads as empty state instead.
export async function loadAnalysis(file: string): Promise<SessionAnalysis | undefined> {
  const fileText = await fs.promises.readFile(file, "utf8").catch(() => undefined);
  if (fileText === undefined) {
    return undefined;
  }
  const savedFile = parseJson(fileText);
  const savedFields = typeof savedFile === "object" && savedFile !== null ? (savedFile as Record<string, unknown>) : {};
  const savedVersion = savedFields.version;
  if (typeof savedVersion === "number" && savedVersion < ANALYSIS_SCHEMA_VERSION) {
    return undefined;
  }
  return readSessionAnalysis(savedVersion === ANALYSIS_SCHEMA_VERSION ? savedFields.entries : undefined);
}

export function saveAnalysis(file: string, analysis: SessionAnalysis): Promise<void> {
  return saveVersionedCache(file, analysis, ANALYSIS_SCHEMA_VERSION);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// Reads the files the old overseer CLI wrote; it never changes them.
export async function loadLegacySessionData(claudeHome: string, sessionId: string, linkMarks: LinkMarks): Promise<LegacySessionData> {
  const [ticketEntries, workEntries, whereEntries] = await Promise.all([
    loadVersionedCache<unknown>(declaredTicketsFile(claudeHome, sessionId), AGENT_TICKETS_SCHEMA_VERSION),
    loadVersionedCache<unknown>(declaredWorkFile(claudeHome, sessionId), AGENT_WORK_SCHEMA_VERSION),
    loadVersionedCache<unknown>(whereFile(claudeHome, sessionId), AGENT_TRACKER_SCHEMA_VERSION),
  ]);
  return {
    declaredTickets: readDeclaredTickets(ticketEntries),
    work: readSessionWork(workEntries),
    where: readSessionWhere(whereEntries),
    linkMarks,
  };
}
