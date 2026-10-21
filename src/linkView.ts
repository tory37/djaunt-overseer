import { DeclaredTicket } from "./agentTickets";
import { LinkKind } from "./linkCandidates";
import { linkKey, ResolvedLink } from "./linkJudge";
import { LinkMark, LinkMarks } from "./registry";
import { sortBySavedOrder } from "./reorder";

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
// The user's saved order sorts links within each mark, so a dragged link never jumps above a pinned one.
export function visibleLinks(markedLinks: MarkedLink[], settings: LinkViewSettings, savedOrder: string[] = []): MarkedLink[] {
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
  const markRank = (link: MarkedLink): number => MARK_SORT_RANK[link.mark ?? "none"];
  const orderedLinks = sortBySavedOrder(shownLinks, savedOrder, linkKey);
  return orderedLinks.sort((left, right) => markRank(left) - markRank(right));
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

export function isDimmedLink(link: MarkedLink): boolean {
  return link.mark === "removed" || (link.mark !== "pinned" && (link.role === "irrelevant" || !link.stillRelevant));
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

// A pinned ticket beats the agent's declaration, which beats the judge's pick; a removed one never names the group.
export function ownedTicketKey(links: MarkedLink[]): string | undefined {
  const tickets = links.filter((link) => link.kind === "ticket" && link.mark !== "removed");
  const pinnedTicket = tickets.find((link) => link.mark === "pinned");
  const declaredTicket = tickets.find((link) => link.isAgentDeclared === true);
  return (pinnedTicket ?? declaredTicket ?? tickets.find((link) => link.role === "owned"))?.id;
}

// The agent knows what it works on, so a declared ticket is owned even when the transcript never mentions it.
export function withDeclaredTickets(resolvedLinks: ResolvedLink[], declaredTickets: DeclaredTicket[]): ResolvedLink[] {
  const declaredByKey = new Map(declaredTickets.map((ticket) => [ticket.key, ticket]));
  const linksWithDeclarations = resolvedLinks.map((link) => {
    const declaredTicket = link.kind === "ticket" ? declaredByKey.get(link.id) : undefined;
    if (declaredTicket === undefined) {
      return link;
    }
    declaredByKey.delete(link.id);
    return { ...link, ...declaredTicketFields(declaredTicket) };
  });
  const unscannedLinks = [...declaredByKey.values()].map((declaredTicket) => ({
    ...unscannedTicketLink(declaredTicket.key),
    ...declaredTicketFields(declaredTicket),
  }));
  return [...unscannedLinks, ...linksWithDeclarations];
}

export interface SessionPanelTickets {
  workingOn: MarkedLink[];
  alsoSeen: MarkedLink[];
}

// Working on: what the agent declared or the user pinned, even a ticket pinned by key that no scan has seen.
export function sessionPanelTickets(links: MarkedLink[], linkMarks: LinkMarks): SessionPanelTickets {
  const tickets = links.filter((link) => link.kind === "ticket" && link.mark !== "removed");
  const shownTicketKeys = new Set(tickets.map((link) => linkKey(link)));
  const pinnedByKeyOnly = Object.entries(linkMarks)
    .filter(([key, mark]) => mark === "pinned" && key.startsWith("ticket:") && !shownTicketKeys.has(key))
    .map(([key]): MarkedLink => ({ ...unscannedTicketLink(key.slice("ticket:".length)), mark: "pinned" }));
  const isWorkingOn = (link: MarkedLink): boolean => link.mark === "pinned" || link.isAgentDeclared === true;
  return {
    workingOn: [...pinnedByKeyOnly, ...tickets.filter(isWorkingOn)],
    alsoSeen: tickets.filter((link) => !isWorkingOn(link)),
  };
}

function unscannedTicketLink(ticketKey: string): ResolvedLink {
  return {
    kind: "ticket",
    id: ticketKey,
    url: undefined,
    title: undefined,
    signals: {},
    snippets: [],
    firstSeen: undefined,
    lastSeen: undefined,
    role: "owned",
    stillRelevant: true,
    label: undefined,
    judged: false,
  };
}

function declaredTicketFields(declaredTicket: DeclaredTicket): Pick<ResolvedLink, "role" | "stillRelevant" | "isAgentDeclared" | "agentNote"> {
  return { role: "owned", stillRelevant: true, isAgentDeclared: true, agentNote: declaredTicket.note };
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
