import { linkKey } from "./linkJudge";
import { LinkStatus } from "./linkStatus";
import { MarkedLink } from "./linkView";

export interface OrderedResource {
  link: MarkedLink;
  depth: number;
}

const TICKET_KEY_PATTERN = /\b[A-Z][A-Z0-9]+-\d+\b/g;
const MARK_RANK: Record<string, number> = { pinned: 0, none: 1, removed: 2 };
const PARENT_TICKET_RANK = 0;
const KIND_RANK: Record<MarkedLink["kind"], number> = { ticket: 1, pr: 2, artifact: 3 };

// Builds the tree: parent ticket → sub-tickets → PRs for each ticket, then leftovers, then artifacts.
// Jira parent data and ticket keys in a PR's branch or title win over the judge's guess.
// With a saved user order, siblings keep the input order instead of the computed one.
export function orderResources(
  links: MarkedLink[],
  statusFor: (link: MarkedLink) => LinkStatus | undefined,
  hasSavedOrder: boolean,
): OrderedResource[] {
  const linksByKey = new Map(links.map((link) => [linkKey(link), link]));
  const parentKeys = new Map<string, string>();
  for (const link of links) {
    const parentKey = factParentKey(link, statusFor(link), linksByKey) ?? judgedParentKey(link, linksByKey);
    if (parentKey !== undefined) {
      parentKeys.set(linkKey(link), parentKey);
    }
  }
  breakCycles(links, parentKeys);

  const childrenByParent = new Map<string | undefined, MarkedLink[]>();
  for (const link of links) {
    const parentKey = parentKeys.get(linkKey(link));
    childrenByParent.set(parentKey, [...(childrenByParent.get(parentKey) ?? []), link]);
  }
  const inputIndex = new Map(links.map((link, index) => [linkKey(link), index]));
  const siblingRank = (link: MarkedLink): number => {
    if (hasSavedOrder) {
      return 0;
    }
    const hasChildren = childrenByParent.has(linkKey(link));
    return link.kind === "ticket" && hasChildren ? PARENT_TICKET_RANK : KIND_RANK[link.kind];
  };
  const compareSiblings = (left: MarkedLink, right: MarkedLink): number =>
    MARK_RANK[left.mark ?? "none"] - MARK_RANK[right.mark ?? "none"] ||
    siblingRank(left) - siblingRank(right) ||
    (inputIndex.get(linkKey(left)) ?? 0) - (inputIndex.get(linkKey(right)) ?? 0);

  const ordered: OrderedResource[] = [];
  const appendSubtree = (parentKey: string | undefined, depth: number): void => {
    const siblings = [...(childrenByParent.get(parentKey) ?? [])].sort(compareSiblings);
    for (const link of siblings) {
      ordered.push({ link, depth });
      appendSubtree(linkKey(link), depth + 1);
    }
  };
  appendSubtree(undefined, 0);
  return ordered;
}

function factParentKey(
  link: MarkedLink,
  status: LinkStatus | undefined,
  linksByKey: Map<string, MarkedLink>,
): string | undefined {
  if (link.kind === "ticket" && status?.parentKey !== undefined) {
    return shownKey(`ticket:${status.parentKey}`, link, linksByKey);
  }
  if (link.kind === "pr") {
    const ticketKeys = [...ticketKeysIn(status?.branch), ...ticketKeysIn(status?.title ?? link.label)];
    return ticketKeys.map((ticketKey) => shownKey(`ticket:${ticketKey}`, link, linksByKey)).find((key) => key !== undefined);
  }
  return undefined;
}

function judgedParentKey(link: MarkedLink, linksByKey: Map<string, MarkedLink>): string | undefined {
  return link.parentKey === undefined ? undefined : shownKey(link.parentKey, link, linksByKey);
}

function shownKey(candidateKey: string, link: MarkedLink, linksByKey: Map<string, MarkedLink>): string | undefined {
  return candidateKey !== linkKey(link) && linksByKey.has(candidateKey) ? candidateKey : undefined;
}

function ticketKeysIn(text: string | undefined): string[] {
  return text === undefined ? [] : [...text.toUpperCase().matchAll(TICKET_KEY_PATTERN)].map((match) => match[0]);
}

// A link whose parent chain leads back to itself goes to the top level instead.
function breakCycles(links: MarkedLink[], parentKeys: Map<string, string>): void {
  for (const link of links) {
    const startKey = linkKey(link);
    const visitedKeys = new Set<string>([startKey]);
    let currentKey = parentKeys.get(startKey);
    while (currentKey !== undefined) {
      if (visitedKeys.has(currentKey)) {
        parentKeys.delete(startKey);
        break;
      }
      visitedKeys.add(currentKey);
      currentKey = parentKeys.get(currentKey);
    }
  }
}
