import type { LiveStatus } from "./liveParse";

export interface LiveTransitions {
  becameIdle: string[];
  leftIdle: string[];
}

// A session seen for the first time has no transition, so a window that just opened doesn't treat every idle session as finished.
export function liveTransitions(previousStatuses: Map<string, LiveStatus>, currentStatuses: Map<string, LiveStatus>): LiveTransitions {
  const becameIdle: string[] = [];
  const leftIdle: string[] = [];
  for (const [sessionId, currentStatus] of currentStatuses) {
    const previousStatus = previousStatuses.get(sessionId);
    if (previousStatus === "busy" && currentStatus === "idle") {
      becameIdle.push(sessionId);
    } else if (previousStatus === "idle" && currentStatus !== "idle") {
      leftIdle.push(sessionId);
    }
  }
  for (const [sessionId, previousStatus] of previousStatuses) {
    if (previousStatus === "idle" && !currentStatuses.has(sessionId)) {
      leftIdle.push(sessionId);
    }
  }
  return { becameIdle, leftIdle };
}
