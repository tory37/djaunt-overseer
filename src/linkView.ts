import { LinkKind } from "./linkCandidates";
import { linkKey, ResolvedLink } from "./linkJudge";
import { LinkStatus } from "./linkStatus";
import { LiveStatus } from "./liveParse";
import { LinkMark, LinkMarks } from "./registry";

export interface LinkViewSettings {
  enabledKinds: Set<LinkKind>;
  showIrrelevant: boolean;
  showRemoved: boolean;
  jiraBaseUrl: string;
}

export interface MarkedLink extends ResolvedLink {
  mark: LinkMark | undefined;
}

const MARK_SORT_RANK: Record<LinkMark | "none", number> = { pinned: 0, none: 1, removed: 2 };

export function markLinks(resolvedLinks: ResolvedLink[], linkMarks: LinkMarks): MarkedLink[] {
  return resolvedLinks.map((link) => ({ ...link, mark: linkMarks[linkKey(link)] }));
}

// Pinned links show even when the judge called them irrelevant; removed links show only on request.
export function visibleLinks(markedLinks: MarkedLink[], settings: LinkViewSettings): MarkedLink[] {
  const shownLinks = markedLinks.filter((link) => {
    if (!settings.enabledKinds.has(link.kind)) {
      return false;
    }
    if (link.mark === "pinned") {
      return true;
    }
    if (link.mark === "removed") {
      return settings.showRemoved;
    }
    return settings.showIrrelevant || link.role !== "irrelevant";
  });
  return shownLinks.sort((left, right) => MARK_SORT_RANK[left.mark ?? "none"] - MARK_SORT_RANK[right.mark ?? "none"]);
}

export function linkUrl(link: ResolvedLink, jiraBaseUrl: string): string | undefined {
  if (link.url !== undefined) {
    return link.url;
  }
  const trimmedBaseUrl = jiraBaseUrl.trim().replace(/\/+$/, "");
  if (link.kind === "ticket" && trimmedBaseUrl !== "") {
    return `${trimmedBaseUrl}/browse/${link.id}`;
  }
  return undefined;
}

export function linkDisplayId(link: ResolvedLink): string {
  if (link.kind !== "pr") {
    return link.id;
  }
  const [owner, repo, , number] = link.id.split("/");
  return owner !== undefined && repo !== undefined && number !== undefined ? `${repo}#${number}` : link.id;
}

// Names a file in media/links, without the theme suffix.
export function linkIconName(link: MarkedLink, status: LinkStatus | undefined): string {
  const isDimmed = link.mark === "removed" || (link.mark !== "pinned" && (link.role === "irrelevant" || !link.stillRelevant));
  if (isDimmed) {
    return `${link.kind}-dim`;
  }
  if (link.kind === "artifact" || status === undefined) {
    return link.kind;
  }
  return `${link.kind}-${status.tone}`;
}

export function linkCountBadge(links: MarkedLink[]): string {
  const relevantCount = links.filter(isCountedLink).length;
  if (relevantCount === 0) {
    return "";
  }
  return relevantCount === 1 ? "1 link" : `${relevantCount} links`;
}

function isCountedLink(link: MarkedLink): boolean {
  if (link.mark !== undefined) {
    return link.mark === "pinned";
  }
  return link.role !== "irrelevant";
}

// A pinned ticket beats the judge's pick, and a removed one never names the group.
export function ownedTicketKey(links: MarkedLink[]): string | undefined {
  const tickets = links.filter((link) => link.kind === "ticket" && link.mark !== "removed");
  const pinnedTicket = tickets.find((link) => link.mark === "pinned");
  return (pinnedTicket ?? tickets.find((link) => link.role === "owned"))?.id;
}

export function sessionsThatWentIdle(
  previousStatuses: Map<string, LiveStatus>,
  currentStatuses: Map<string, LiveStatus>,
): string[] {
  const idleSessionIds: string[] = [];
  for (const [sessionId, previousStatus] of previousStatuses) {
    const currentStatus = currentStatuses.get(sessionId);
    if (previousStatus === "busy" && currentStatus !== "busy") {
      idleSessionIds.push(sessionId);
    }
  }
  return idleSessionIds;
}

export class ConcurrencyLimiter {
  private activeCount = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly maxActive: number) {}

  async run<Result>(task: () => Promise<Result>): Promise<Result> {
    if (this.activeCount >= this.maxActive) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.activeCount++;
    }
    try {
      return await task();
    } finally {
      this.releaseSlot();
    }
  }

  // Hands the slot straight to the next waiter, so a new caller can't slip in between.
  private releaseSlot(): void {
    const nextWaiter = this.waiting.shift();
    if (nextWaiter === undefined) {
      this.activeCount--;
    } else {
      nextWaiter();
    }
  }
}
