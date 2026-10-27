import { DeclaredTicket } from "./agentTickets";
import { SessionWhere } from "./agentTracker";
import { normalizePullRequestUrl, SessionWork } from "./agentWork";
import { clipLine, emptyAnalysis, KnownItem, MAX_ARTIFACT_TITLE_CHARS, MAX_SEED_NOTE_CHARS, SessionAnalysis, ticketItemKey, trimToWholeWords } from "./analysisState";
import { artifactUrlParts } from "./linkCandidates";
import type { LinkMarks } from "./registry";

export interface LegacySessionData {
  declaredTickets: DeclaredTicket[];
  work: SessionWork;
  where: SessionWhere | undefined;
  linkMarks: LinkMarks;
}

const COMMIT_ITEM_PREFIX = "commit:";
const PR_URL_PARTS_PATTERN = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)$/;

// Uses the scanner's PR id, so a seeded PR and a scanned one share an item key.
export function pullRequestItemKey(url: string): string | undefined {
  const match = PR_URL_PARTS_PATTERN.exec(normalizePullRequestUrl(url) ?? "");
  return match === null ? undefined : `pr:${match[1]}/${match[2]}/pull/${match[3]}`.toLowerCase();
}

export function artifactItemKey(url: string): string | undefined {
  const artifactParts = artifactUrlParts(url);
  return artifactParts === undefined ? undefined : `artifact:${artifactParts.id}`;
}

// Old declarations become facts the model reads, never workstreams, so the old one-per-ticket shape cannot anchor the grouping.
export function seedAnalysis(legacyData: LegacySessionData): SessionAnalysis {
  const analysis = emptyAnalysis();
  const knownItems: KnownItem[] = [
    ...legacyData.declaredTickets.map((ticket) => knownItem(ticketItemKey(ticket.key), ticket.note, ticket.parentKey)),
    ...legacyData.work.commits.map((commit) => knownItem(`${COMMIT_ITEM_PREFIX}${commit.hash.toLowerCase()}`, commit.note)),
    ...legacyData.work.pullRequests.flatMap((pullRequest) => {
      const itemKey = pullRequestItemKey(pullRequest.url);
      return itemKey === undefined ? [] : [knownItem(itemKey, pullRequest.note, pullRequest.parentKey)];
    }),
    ...legacyData.work.artifacts.flatMap((artifact) => {
      const itemKey = artifactItemKey(artifact.url);
      return itemKey === undefined ? [] : [knownItem(itemKey, artifact.note, artifact.parentKey)];
    }),
  ];
  const linkMarkEntries = Object.entries(legacyData.linkMarks);
  analysis.seedFacts = {
    knownItems: knownItems.filter((item, index) => knownItems.findIndex((otherItem) => otherItem.itemKey === item.itemKey) === index),
    keptItemKeys: linkMarkEntries.filter(([, mark]) => mark === "pinned").map(([itemKey]) => itemKey),
    removedItemKeys: linkMarkEntries.filter(([, mark]) => mark === "removed").map(([itemKey]) => itemKey),
  };
  for (const artifact of legacyData.work.artifacts) {
    const itemKey = artifactItemKey(artifact.url);
    if (itemKey !== undefined && artifact.note !== undefined) {
      analysis.artifactTitles[itemKey] = trimToWholeWords(artifact.note, MAX_ARTIFACT_TITLE_CHARS);
    }
  }
  if (legacyData.where !== undefined) {
    analysis.where = legacyData.where.lines;
    analysis.sessionDone = legacyData.where.doneAt !== undefined;
  }
  return analysis;
}

function knownItem(itemKey: string, note: string | undefined, parentKey?: string): KnownItem {
  const item: KnownItem = { itemKey };
  if (note !== undefined && note.trim() !== "") {
    item.note = clipLine(note, MAX_SEED_NOTE_CHARS);
  }
  if (parentKey !== undefined) {
    item.parentKey = pullRequestItemKey(parentKey) ?? parentKey;
  }
  return item;
}
