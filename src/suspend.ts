import * as vscode from "vscode";
import { PinnedSession, pinnedSessionTitle } from "./grouping";
import { LiveSessionMonitor } from "./liveSessions";
import { findSessionTerminal, suspendTerminal } from "./terminals";

// Terminal rows are plain shells, so only Claude rows with a terminal in this window can be suspended.
export function runningClaudeSessions(pinnedSessions: PinnedSession[]): PinnedSession[] {
  return pinnedSessions.filter((pinned) => pinned.terminal === undefined && findSessionTerminal(pinned.sessionId) !== undefined);
}

export function busySessions(pinnedSessions: PinnedSession[], liveMonitor: LiveSessionMonitor): PinnedSession[] {
  return pinnedSessions.filter((pinned) => liveMonitor.get(pinned.sessionId)?.status === "busy");
}

// Returns false when the user backs out. With no busy session there is nothing to ask.
export async function confirmStopBusySessions(
  busyPinnedSessions: PinnedSession[],
  proceedChoice: string,
  detail: string,
): Promise<boolean> {
  if (busyPinnedSessions.length === 0) {
    return true;
  }
  const busyTitles = busyPinnedSessions.map(pinnedSessionTitle).join(", ");
  const choice = await vscode.window.showWarningMessage(`Claude is mid-task in: ${busyTitles}.`, { modal: true, detail }, proceedChoice);
  return choice === proceedChoice;
}

export async function suspendSessions(runningSessions: PinnedSession[]): Promise<void> {
  await Promise.all(
    runningSessions.map((pinned) => {
      const terminal = findSessionTerminal(pinned.sessionId);
      return terminal ? suspendTerminal(terminal) : Promise.resolve();
    }),
  );
}
