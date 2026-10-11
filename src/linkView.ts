import { LinkKind } from "./linkCandidates";
import { ResolvedLink } from "./linkJudge";
import { LinkStatus } from "./linkStatus";
import { LiveStatus } from "./liveParse";

export interface LinkViewSettings {
  enabledKinds: Set<LinkKind>;
  showIrrelevant: boolean;
  jiraBaseUrl: string;
}

export function visibleLinks(resolvedLinks: ResolvedLink[], settings: LinkViewSettings): ResolvedLink[] {
  return resolvedLinks.filter(
    (link) => settings.enabledKinds.has(link.kind) && (settings.showIrrelevant || link.role !== "irrelevant"),
  );
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
export function linkIconName(link: ResolvedLink, status: LinkStatus | undefined): string {
  const isDimmed = link.role === "irrelevant" || !link.stillRelevant;
  if (isDimmed) {
    return `${link.kind}-dim`;
  }
  if (link.kind === "artifact" || status === undefined) {
    return link.kind;
  }
  return `${link.kind}-${status.tone}`;
}

export function linkCountBadge(links: ResolvedLink[]): string {
  const relevantCount = links.filter((link) => link.role !== "irrelevant").length;
  if (relevantCount === 0) {
    return "";
  }
  return relevantCount === 1 ? "1 link" : `${relevantCount} links`;
}

export function ownedTicketKey(links: ResolvedLink[]): string | undefined {
  return links.find((link) => link.kind === "ticket" && link.role === "owned")?.id;
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
