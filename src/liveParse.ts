export type LiveStatus = "busy" | "idle" | "background";

export interface LiveSession {
  sessionId: string;
  agentId: string | undefined;
  pid: number | undefined;
  kind: string;
  status: LiveStatus;
  name: string | undefined;
  cwd: string | undefined;
  processCount: number;
}

const FINISHED_BACKGROUND_STATES = new Set(["failed", "stopped", "completed", "done", "cancelled", "killed", "exited"]);

interface AgentsJsonEntry {
  id?: unknown;
  sessionId?: unknown;
  pid?: unknown;
  kind?: unknown;
  status?: unknown;
  state?: unknown;
  name?: unknown;
  cwd?: unknown;
}

// Parses `claude agents --json`; unknown shapes degrade to an empty map instead of throwing.
export function parseAgentsJson(agentsJson: string): Map<string, LiveSession> {
  const liveSessions = new Map<string, LiveSession>();
  let entries: unknown;
  try {
    entries = JSON.parse(agentsJson);
  } catch {
    return liveSessions;
  }
  if (!Array.isArray(entries)) {
    return liveSessions;
  }
  for (const entry of entries as AgentsJsonEntry[]) {
    if (typeof entry?.sessionId !== "string") {
      continue;
    }
    const kind = typeof entry.kind === "string" ? entry.kind : "unknown";
    const backgroundState = typeof entry.state === "string" ? entry.state : undefined;
    if (backgroundState !== undefined && FINISHED_BACKGROUND_STATES.has(backgroundState)) {
      continue;
    }
    const status: LiveStatus = entry.status === "busy" ? "busy" : kind === "background" ? "background" : "idle";
    const alreadyLive = liveSessions.get(entry.sessionId);
    if (alreadyLive !== undefined) {
      alreadyLive.processCount++;
      if (status === "busy") {
        alreadyLive.status = "busy";
      }
      continue;
    }
    liveSessions.set(entry.sessionId, {
      sessionId: entry.sessionId,
      agentId: typeof entry.id === "string" ? entry.id : undefined,
      pid: typeof entry.pid === "number" ? entry.pid : undefined,
      kind,
      status,
      name: typeof entry.name === "string" ? entry.name : undefined,
      cwd: typeof entry.cwd === "string" ? entry.cwd : undefined,
      processCount: 1,
    });
  }
  return liveSessions;
}
