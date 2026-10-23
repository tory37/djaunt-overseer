import { DeclaredTicket, withDeclaredTicket } from "./agentTickets";
import { isSameCommit, SessionWork, withDeclaredArtifact, withDeclaredCommit, withDeclaredPullRequest } from "./agentWork";
import { PopulatedItem, PopulateResult } from "./populateDigest";

export interface PopulateSummary {
  added: { tickets: string[]; pullRequests: string[]; commits: string[]; artifacts: string[] };
  notesUpdated: number;
}

export const EMPTY_POPULATE_SUMMARY: PopulateSummary = {
  added: { tickets: [], pullRequests: [], commits: [], artifacts: [] },
  notesUpdated: 0,
};

export interface PopulateMergeInput {
  savedTickets: DeclaredTicket[];
  savedWork: SessionWork;
  populateResult: PopulateResult;
  removedTicketKeys: string[];
  isRecheck: boolean;
  now: number;
}

export interface PopulateMerge {
  tickets: DeclaredTicket[];
  work: SessionWork;
  summary: PopulateSummary;
}

interface DeclaredEntry {
  note?: string;
  parentKey?: string;
}

interface KindMerge<Container> {
  container: Container;
  addedIds: string[];
  updatedCount: number;
}

// Never removes anything. Only a recheck refreshes existing entries; a first populate keeps the agent's own notes.
export function mergePopulateResult(input: PopulateMergeInput): PopulateMerge {
  const { savedTickets, savedWork, populateResult, removedTicketKeys, isRecheck, now } = input;
  const ticketMerge = mergeKind(
    savedTickets,
    (tickets) => tickets,
    (ticket) => ticket.key,
    populateResult.tickets.filter((ticket) => !removedTicketKeys.includes(ticket.id)),
    isRecheck,
    (tickets, item) => withDeclaredTicket(tickets, item.id, item.note, now, item.parentKey),
  );
  const populatedWork: SessionWork = { ...savedWork, populatedAt: now };
  const commitMerge = mergeKind(
    populatedWork,
    (work) => work.commits,
    (commit) => commit.hash,
    populateResult.commits,
    isRecheck,
    (work, item) => withDeclaredCommit(work, item.id, item.note, now),
    isSameCommit,
  );
  const pullRequestMerge = mergeKind(
    commitMerge.container,
    (work) => work.pullRequests,
    (pullRequest) => pullRequest.url,
    populateResult.pullRequests,
    isRecheck,
    (work, item) => withDeclaredPullRequest(work, item.id, item.note, now, item.parentKey),
  );
  const artifactMerge = mergeKind(
    pullRequestMerge.container,
    (work) => work.artifacts,
    (artifact) => artifact.url,
    populateResult.artifacts,
    isRecheck,
    (work, item) => withDeclaredArtifact(work, item.id, item.note, now, item.parentKey),
  );
  return {
    tickets: ticketMerge.container,
    work: artifactMerge.container,
    summary: {
      added: {
        tickets: ticketMerge.addedIds,
        pullRequests: pullRequestMerge.addedIds,
        commits: commitMerge.addedIds,
        artifacts: artifactMerge.addedIds,
      },
      notesUpdated: ticketMerge.updatedCount + commitMerge.updatedCount + pullRequestMerge.updatedCount + artifactMerge.updatedCount,
    },
  };
}

function mergeKind<Container, Entry extends DeclaredEntry>(
  savedContainer: Container,
  entriesOf: (container: Container) => Entry[],
  idOf: (entry: Entry) => string,
  items: PopulatedItem[],
  isRecheck: boolean,
  withItem: (container: Container, item: PopulatedItem) => Container,
  isSameId: (entryId: string, itemId: string) => boolean = (entryId, itemId) => entryId === itemId,
): KindMerge<Container> {
  let container = savedContainer;
  const addedIds: string[] = [];
  let updatedCount = 0;
  for (const item of items) {
    const existingEntry = entriesOf(container).find((entry) => isSameId(idOf(entry), item.id));
    if (existingEntry === undefined) {
      container = withItem(container, item);
      addedIds.push(item.id);
      continue;
    }
    if (!isRecheck) {
      continue;
    }
    container = withItem(container, item);
    const refreshedEntry = entriesOf(container).find((entry) => isSameId(idOf(entry), item.id));
    const isChanged = refreshedEntry?.note !== existingEntry.note || refreshedEntry?.parentKey !== existingEntry.parentKey;
    if (isChanged) {
      updatedCount++;
    }
  }
  return { container, addedIds, updatedCount };
}
