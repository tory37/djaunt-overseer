import * as path from "path";
import type { PopulateSummary } from "./populateMerge";
import type { ResourceRow } from "./resourceRows";
import type { SidebarRunKind } from "./sessionPreviewModel";

const OPEN_STATE_PREFIX = "open · ";
const MAX_NAMED_TICKETS = 2;
const NOTHING_NEW_TEXT = "Nothing new. Working on is up to date.";

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

export function linkRowTitle(row: Pick<ResourceRow, "displayId" | "label" | "statusText" | "agentNote" | "mark">): string {
  return [
    row.displayId,
    row.label,
    row.statusText,
    row.agentNote === undefined ? undefined : `Agent: ${row.agentNote}`,
    row.mark === "pinned" ? "Pinned by you" : undefined,
  ]
    .filter((part) => part !== undefined && part !== "")
    .join(" — ");
}

// Up to two added tickets show by key; more show as a count, like the other kinds.
export function recheckSummaryText({ added, notesUpdated }: PopulateSummary): string {
  const ticketPart = added.tickets.length <= MAX_NAMED_TICKETS ? added.tickets : [countOf(added.tickets.length, "ticket")];
  const addedParts = [
    ...ticketPart,
    countOf(added.pullRequests.length, "PR"),
    countOf(added.commits.length, "commit"),
    countOf(added.artifacts.length, "artifact"),
  ].filter((part) => part !== "");
  const sentences = [
    addedParts.length > 0 ? `Added ${addedParts.join(", ")}.` : "",
    notesUpdated > 0 ? `Updated ${countOf(notesUpdated, "note")}.` : "",
  ].filter((sentence) => sentence !== "");
  return sentences.length > 0 ? sentences.join(" ") : NOTHING_NEW_TEXT;
}

function countOf(count: number, noun: string): string {
  if (count === 0) {
    return "";
  }
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
