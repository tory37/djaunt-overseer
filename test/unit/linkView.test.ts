import { existsSync } from "fs";
import { describe, expect, it } from "vitest";
import { ResolvedLink } from "../../src/linkJudge";
import {
  ConcurrencyLimiter,
  linkCountBadge,
  linkDisplayId,
  linkIconName,
  LinkViewSettings,
  linkUrl,
  MarkedLink,
  markLinks,
  ownedTicketKey,
  sessionsThatWentIdle,
  visibleLinks,
} from "../../src/linkView";
import { LinkStatusTone } from "../../src/linkStatus";
import { LiveStatus } from "../../src/liveParse";

function resolvedLink(overrides: Partial<MarkedLink> & Pick<MarkedLink, "kind" | "id" | "role">): MarkedLink {
  return {
    url: undefined,
    title: undefined,
    signals: {},
    snippets: [],
    firstSeen: undefined,
    lastSeen: undefined,
    stillRelevant: true,
    label: undefined,
    judged: true,
    mark: undefined,
    ...overrides,
  };
}

const OWNED_PR = resolvedLink({ kind: "pr", id: "acme/web-app/pull/2384", role: "owned", url: "https://github.com/acme/web-app/pull/2384" });
const TOUCHED_TICKET = resolvedLink({ kind: "ticket", id: "PROJ-5", role: "touched" });
const OWNED_TICKET = resolvedLink({ kind: "ticket", id: "PROJ-9", role: "owned" });
const NOISE_ARTIFACT = resolvedLink({ kind: "artifact", id: "abc", role: "irrelevant" });

function settings(overrides: Partial<LinkViewSettings> = {}): LinkViewSettings {
  return { enabledKinds: new Set(["pr", "ticket", "artifact"]), showIrrelevant: false, showRemoved: false, jiraBaseUrl: "", ...overrides };
}

describe("visibleLinks", () => {
  it("hides irrelevant links and disabled sources", () => {
    const links = [OWNED_PR, TOUCHED_TICKET, NOISE_ARTIFACT];

    expect(visibleLinks(links, settings()).map((link) => link.id)).toEqual(["acme/web-app/pull/2384", "PROJ-5"]);
    expect(visibleLinks(links, settings({ enabledKinds: new Set(["ticket"]) })).map((link) => link.id)).toEqual(["PROJ-5"]);
    expect(visibleLinks(links, settings({ showIrrelevant: true }))).toHaveLength(3);
  });

  it("shows pinned links first, even irrelevant ones, and hides removed links until asked", () => {
    const pinnedNoise = { ...NOISE_ARTIFACT, mark: "pinned" as const };
    const removedPr = { ...OWNED_PR, mark: "removed" as const };
    const links = [removedPr, TOUCHED_TICKET, pinnedNoise];

    expect(visibleLinks(links, settings()).map((link) => link.id)).toEqual(["abc", "PROJ-5"]);
    expect(visibleLinks(links, settings({ showRemoved: true })).map((link) => link.id)).toEqual([
      "abc",
      "PROJ-5",
      "acme/web-app/pull/2384",
    ]);
    expect(visibleLinks([pinnedNoise], settings({ enabledKinds: new Set(["pr"]) }))).toEqual([]);
  });
});

describe("markLinks", () => {
  it("matches marks by kind and id", () => {
    const markedLinks = markLinks([OWNED_PR, TOUCHED_TICKET], { "ticket:PROJ-5": "removed" });

    expect(markedLinks.map((link) => link.mark)).toEqual([undefined, "removed"]);
  });
});

describe("linkUrl", () => {
  it("prefers the transcript URL and builds ticket URLs from the base URL", () => {
    expect(linkUrl(OWNED_PR, "https://acme.atlassian.net")).toBe("https://github.com/acme/web-app/pull/2384");
    expect(linkUrl(TOUCHED_TICKET, "https://acme.atlassian.net/")).toBe("https://acme.atlassian.net/browse/PROJ-5");
    expect(linkUrl(TOUCHED_TICKET, "  ")).toBeUndefined();
  });
});

describe("link labels", () => {
  it("shortens PR ids to repo and number", () => {
    expect(linkDisplayId(OWNED_PR)).toBe("web-app#2384");
    expect(linkDisplayId(TOUCHED_TICKET)).toBe("PROJ-5");
  });

  it("counts only relevant links in the badge", () => {
    expect(linkCountBadge([NOISE_ARTIFACT])).toBe("");
    expect(linkCountBadge([OWNED_PR, NOISE_ARTIFACT])).toBe("1 link");
    expect(linkCountBadge([OWNED_PR, TOUCHED_TICKET])).toBe("2 links");
    expect(linkCountBadge([{ ...OWNED_PR, mark: "removed" }, { ...NOISE_ARTIFACT, mark: "pinned" }])).toBe("1 link");
  });

  it("picks the owned ticket, not a touched one", () => {
    expect(ownedTicketKey([OWNED_PR, TOUCHED_TICKET, OWNED_TICKET])).toBe("PROJ-9");
    expect(ownedTicketKey([TOUCHED_TICKET])).toBeUndefined();
  });

  it("prefers a pinned ticket and skips a removed one", () => {
    expect(ownedTicketKey([OWNED_TICKET, { ...TOUCHED_TICKET, mark: "pinned" }])).toBe("PROJ-5");
    expect(ownedTicketKey([{ ...OWNED_TICKET, mark: "removed" }])).toBeUndefined();
  });
});

describe("sessionsThatWentIdle", () => {
  it("reports busy sessions that went idle or ended", () => {
    const previous = new Map<string, LiveStatus>([["a", "busy"], ["b", "busy"], ["c", "idle"], ["d", "busy"]]);
    const current = new Map<string, LiveStatus>([["a", "idle"], ["b", "busy"], ["c", "busy"]]);

    expect(sessionsThatWentIdle(previous, current)).toEqual(["a", "d"]);
  });
});

describe("ConcurrencyLimiter", () => {
  it("never runs more than the limit at once, even when callers arrive as a slot frees", async () => {
    const limiter = new ConcurrencyLimiter(2);
    let activeCount = 0;
    let peakActiveCount = 0;
    const task = async (): Promise<void> => {
      activeCount++;
      peakActiveCount = Math.max(peakActiveCount, activeCount);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeCount--;
    };
    const firstWave = Array.from({ length: 5 }, () => limiter.run(task));
    await limiter.run(task);
    await Promise.all([...firstWave, limiter.run(task), limiter.run(task)]);

    expect(peakActiveCount).toBe(2);
  });
});

describe("linkIconName", () => {
  it("names the icon after the live status", () => {
    expect(linkIconName(OWNED_PR, { text: "merged", tone: "merged" })).toBe("pr-merged");
    expect(linkIconName(OWNED_PR, undefined)).toBe("pr");
  });

  it("uses one icon for artifacts whatever the status", () => {
    const artifact = resolvedLink({ kind: "artifact", id: "abc", role: "owned" });
    expect(linkIconName(artifact, undefined)).toBe("artifact");
  });

  it("dims irrelevant and inactive links", () => {
    const irrelevantTicket = resolvedLink({ kind: "ticket", id: "ABC-1", role: "irrelevant" });
    const inactivePr = { ...OWNED_PR, stillRelevant: false };
    expect(linkIconName(irrelevantTicket, { text: "Done", tone: "done" })).toBe("ticket-dim");
    expect(linkIconName(inactivePr, { text: "open", tone: "open" })).toBe("pr-dim");
    expect(linkIconName({ ...OWNED_PR, mark: "removed" }, { text: "open", tone: "open" })).toBe("pr-dim");
    expect(linkIconName({ ...inactivePr, mark: "pinned" }, { text: "open", tone: "open" })).toBe("pr-open");
  });

  it("has a light and dark file for every icon a status can produce", () => {
    const tonesByKind: Record<ResolvedLink["kind"], LinkStatusTone[]> = {
      pr: ["open", "draft", "merged", "closed"],
      ticket: ["todo", "active", "done"],
      artifact: [],
    };
    const iconNames = Object.entries(tonesByKind).flatMap(([kind, tones]) => {
      const link = resolvedLink({ kind: kind as ResolvedLink["kind"], id: "x", role: "owned" });
      const dimmedLink = { ...link, role: "irrelevant" as const };
      const statusIcons = tones.map((tone) => linkIconName(link, { text: tone, tone }));
      return [...statusIcons, linkIconName(link, undefined), linkIconName(dimmedLink, undefined)];
    });
    for (const iconName of iconNames) {
      expect(existsSync(`media/links/${iconName}-light.svg`), iconName).toBe(true);
      expect(existsSync(`media/links/${iconName}-dark.svg`), iconName).toBe(true);
    }
  });
});
