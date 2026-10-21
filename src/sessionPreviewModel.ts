import { LiveSession } from "./liveParse";

export interface PreviewRunState {
  stateLabel: string;
  resumeLabel: string;
  isElsewhere: boolean;
}

// The preview only shows sessions without a terminal here, so a live session is running somewhere else.
export function previewRunState(liveSession: LiveSession | undefined): PreviewRunState {
  if (liveSession === undefined) {
    return { stateLabel: "Paused", resumeLabel: "Resume", isElsewhere: false };
  }
  if (liveSession.kind === "background" && liveSession.agentId !== undefined) {
    return { stateLabel: "Running as a background agent", resumeLabel: "Attach or fork", isElsewhere: true };
  }
  const where = liveSession.pid === undefined ? "another terminal" : `another terminal (pid ${liveSession.pid})`;
  return { stateLabel: `Running in ${where}`, resumeLabel: "Fork here", isElsewhere: true };
}

export function previewTabTitle(sessionTitle: string, maxLength = 40): string {
  const shortTitle = sessionTitle.length > maxLength ? `${sessionTitle.slice(0, maxLength - 1)}…` : sessionTitle;
  return `Preview: ${shortTitle}`;
}
