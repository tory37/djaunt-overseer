import * as path from "path";
import type { ResourceRow } from "./resourceRows";
import type { SidebarRunKind } from "./sessionPreviewModel";

const OPEN_STATE_PREFIX = "open · ";

export function metaLine(cwd: string | undefined, branch: string | undefined, otherRepos: string[]): string {
  const repoName = cwd === undefined ? undefined : path.basename(cwd);
  const otherReposLabel = otherRepos.length > 0 ? `+${otherRepos.join(", ")}` : undefined;
  return [repoName, branch, otherReposLabel].filter((part) => part !== undefined && part !== "").join(" · ");
}

export function metaTitle(cwd: string | undefined, branch: string | undefined): string {
  return [cwd, branch].filter((part) => part !== undefined && part !== "").join(" · ");
}

export interface StateSentenceInput {
  runKind: SidebarRunKind;
  lastActive: string | undefined;
  isBackgroundAgent: boolean;
}

export function stateSentence({ runKind, lastActive, isBackgroundAgent }: StateSentenceInput): string {
  switch (runKind) {
    case "idle":
      return "Idle in this window";
    case "busy":
      return "Working in this window";
    case "paused":
      return lastActive === undefined ? "Paused" : `Paused · last active ${lastActive}`;
    case "elsewhere":
      return isBackgroundAgent
        ? "Running as a background agent · attach or fork to work on it here"
        : "Running in another terminal · fork to work on it here";
  }
}

// The row is one line, so an open PR shows only its review state.
export function shortLinkStatus(statusText: string | undefined): string | undefined {
  return statusText?.startsWith(OPEN_STATE_PREFIX) ? statusText.slice(OPEN_STATE_PREFIX.length) : statusText;
}

export function linkRowTitle(row: Pick<ResourceRow, "displayId" | "label" | "statusText" | "mark">): string {
  return [
    row.displayId,
    row.label,
    row.statusText,
    row.mark === "pinned" ? "Pinned by you" : undefined,
  ]
    .filter((part) => part !== undefined && part !== "")
    .join(" — ");
}

export interface SummaryPrompt {
  kind: "stale" | "empty";
  text: string;
  canRunHaiku: boolean;
}

// Haiku costs tokens, so a stale or missing summary only offers a run.
export function summaryPrompt(summary: { isStale: boolean } | undefined, hasTranscript: boolean): SummaryPrompt | undefined {
  if (summary === undefined) {
    return { kind: "empty", text: "No summary yet.", canRunHaiku: hasTranscript };
  }
  if (summary.isStale) {
    return { kind: "stale", text: "Potentially out of date.", canRunHaiku: hasTranscript };
  }
  return undefined;
}
