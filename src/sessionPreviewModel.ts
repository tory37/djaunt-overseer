import { LinkCandidate } from "./linkCandidates";
import { LinkStatus } from "./linkStatus";
import { isLinkShown, LinkViewSettings } from "./linkView";
import { LiveSession } from "./liveParse";
import { clipText, TranscriptTurn } from "./sessionSummary";

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

export interface PreviewTurn {
  speaker: "user" | "claude";
  text: string;
}

const RECENT_TURN_LIMIT = 6;
const MAX_PREVIEW_TURN_CHARS = 600;

// Tool calls are noise in a reading view; only what the user and Claude said is shown.
export function recentConversation(turns: TranscriptTurn[], turnLimit = RECENT_TURN_LIMIT): PreviewTurn[] {
  return turns
    .filter((turn): turn is PreviewTurn => turn.speaker !== "tool")
    .slice(-turnLimit)
    .map((turn) => ({ speaker: turn.speaker, text: clipText(turn.text, MAX_PREVIEW_TURN_CHARS) }));
}

export function distinctLastPrompt(firstPrompt: string | undefined, lastPrompt: string | undefined): string | undefined {
  return lastPrompt === firstPrompt ? undefined : lastPrompt;
}

export type SidebarRunKind = "idle" | "busy" | "paused" | "elsewhere";

// A session with a terminal here is live; one shown in the preview is paused or running somewhere else.
export function sidebarRunKind(hasTerminalHere: boolean, liveSession: LiveSession | undefined): SidebarRunKind {
  if (hasTerminalHere) {
    return liveSession?.status === "busy" ? "busy" : "idle";
  }
  return previewRunState(liveSession).isElsewhere ? "elsewhere" : "paused";
}

// The preview follows the same link settings as the Session sidebar.
export function shownPreviewLinks(
  candidates: LinkCandidate[],
  statusOf: (link: LinkCandidate) => LinkStatus | undefined,
  settings: LinkViewSettings,
): LinkCandidate[] {
  return candidates.filter((candidate) => isLinkShown(candidate, statusOf(candidate), settings));
}
