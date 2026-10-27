import { LinkCandidate } from "./linkCandidates";
import type { LinkStatus } from "./linkStatus";

export interface EnrichedCandidate extends LinkCandidate {
  status?: string;
  parentKey?: string;
}

export type StatusesById = ReadonlyMap<string, LinkStatus>;

// Fetched PR titles and ticket summaries win over what the transcript showed; the transcript fills the gaps.
export function enrichCandidates(
  candidates: LinkCandidate[],
  prStatuses: StatusesById,
  ticketStatuses: StatusesById,
): EnrichedCandidate[] {
  return candidates.map((candidate) => {
    const status = cachedStatusFor(candidate, prStatuses, ticketStatuses);
    if (status === undefined) {
      return { ...candidate };
    }
    const enrichedCandidate: EnrichedCandidate = { ...candidate, title: status.title ?? candidate.title, status: status.text };
    const branch = status.branch ?? candidate.branch;
    if (branch !== undefined) {
      enrichedCandidate.branch = branch;
    }
    if (status.parentKey !== undefined) {
      enrichedCandidate.parentKey = status.parentKey;
    }
    return enrichedCandidate;
  });
}

function cachedStatusFor(
  candidate: LinkCandidate,
  prStatuses: StatusesById,
  ticketStatuses: StatusesById,
): LinkStatus | undefined {
  if (candidate.kind === "pr") {
    return prStatuses.get(candidate.id);
  }
  if (candidate.kind === "ticket") {
    return ticketStatuses.get(candidate.id);
  }
  return undefined;
}
