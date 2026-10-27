import { LinkCandidate, LinkKind } from "./linkCandidates";
import { LinkMark } from "./registry";

export interface LinkViewSettings {
  enabledKinds: Set<LinkKind>;
  jiraBaseUrl: string;
}

export interface MarkedLink extends LinkCandidate {
  mark: LinkMark | undefined;
}

const SHORT_COMMIT_HASH_LENGTH = 7;
const LINK_KINDS: ReadonlySet<string> = new Set<LinkKind>(["pr", "ticket", "artifact", "commit"]);

export function linkUrl(link: LinkCandidate, jiraBaseUrl: string): string | undefined {
  if (link.url !== undefined) {
    return link.url;
  }
  const trimmedBaseUrl = jiraBaseUrl.trim().replace(/\/+$/, "");
  if (link.kind === "ticket" && trimmedBaseUrl !== "") {
    return `${trimmedBaseUrl}/browse/${link.id}`;
  }
  return undefined;
}

export function linkDisplayId(link: LinkCandidate): string {
  if (link.kind === "commit") {
    return link.id.slice(0, SHORT_COMMIT_HASH_LENGTH);
  }
  if (link.kind !== "pr") {
    return link.id;
  }
  const [owner, repo, , number] = link.id.split("/");
  return owner !== undefined && repo !== undefined && number !== undefined ? `${repo}#${number}` : link.id;
}

// An item the analyzer placed that no scan knows any more still gets a row from its key alone.
export function linkForItemKey(itemKey: string): LinkCandidate | undefined {
  const separatorIndex = itemKey.indexOf(":");
  const kind = itemKey.slice(0, separatorIndex);
  const id = itemKey.slice(separatorIndex + 1);
  if (separatorIndex <= 0 || id === "" || !LINK_KINDS.has(kind)) {
    return undefined;
  }
  const url = kind === "pr" ? `https://github.com/${id}` : undefined;
  return { kind: kind as LinkKind, id, url, title: undefined, signals: {}, snippets: [], firstSeen: undefined, lastSeen: undefined };
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
