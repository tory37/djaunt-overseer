import { describe, expect, it } from "vitest";
import { ResolvedLink } from "../../src/linkJudge";
import {
  ConcurrencyLimiter,
  linkCountBadge,
  linkDisplayId,
  LinkViewSettings,
  linkUrl,
  ownedTicketKey,
  sessionsThatWentIdle,
  visibleLinks,
} from "../../src/linkView";
import { LiveStatus } from "../../src/liveParse";

function resolvedLink(overrides: Partial<ResolvedLink> & Pick<ResolvedLink, "kind" | "id" | "role">): ResolvedLink {
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
    ...overrides,
  };
}

const OWNED_PR = resolvedLink({ kind: "pr", id: "acme/web-app/pull/2384", role: "owned", url: "https://github.com/acme/web-app/pull/2384" });
const TOUCHED_TICKET = resolvedLink({ kind: "ticket", id: "PROJ-5", role: "touched" });
const OWNED_TICKET = resolvedLink({ kind: "ticket", id: "PROJ-9", role: "owned" });
const NOISE_ARTIFACT = resolvedLink({ kind: "artifact", id: "abc", role: "irrelevant" });

function settings(overrides: Partial<LinkViewSettings> = {}): LinkViewSettings {
  return { enabledKinds: new Set(["pr", "ticket", "artifact"]), showIrrelevant: false, jiraBaseUrl: "", ...overrides };
}

describe("visibleLinks", () => {
  it("hides irrelevant links and disabled sources", () => {
    const links = [OWNED_PR, TOUCHED_TICKET, NOISE_ARTIFACT];

    expect(visibleLinks(links, settings()).map((link) => link.id)).toEqual(["acme/web-app/pull/2384", "PROJ-5"]);
    expect(visibleLinks(links, settings({ enabledKinds: new Set(["ticket"]) })).map((link) => link.id)).toEqual(["PROJ-5"]);
    expect(visibleLinks(links, settings({ showIrrelevant: true }))).toHaveLength(3);
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
  });

  it("picks the owned ticket, not a touched one", () => {
    expect(ownedTicketKey([OWNED_PR, TOUCHED_TICKET, OWNED_TICKET])).toBe("PROJ-9");
    expect(ownedTicketKey([TOUCHED_TICKET])).toBeUndefined();
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
