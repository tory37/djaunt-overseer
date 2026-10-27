import { describe, expect, it } from "vitest";
import { ConcurrencyLimiter, isLinkShown, linkDisplayId, linkForItemKey, linkUrl, LinkViewSettings, MarkedLink } from "../../src/linkView";
import { acceptedOrder, resourceRow } from "../../src/resourceRows";
import { statusGlyphMarkup } from "../../src/statusIcons";

function markedLink(overrides: Partial<MarkedLink> & Pick<MarkedLink, "kind" | "id">): MarkedLink {
  return {
    url: undefined,
    title: undefined,
    signals: {},
    snippets: [],
    firstSeen: undefined,
    lastSeen: undefined,
    mark: undefined,
    ...overrides,
  };
}

const OWNED_PR = markedLink({ kind: "pr", id: "acme/web-app/pull/2384", url: "https://github.com/acme/web-app/pull/2384" });
const TOUCHED_TICKET = markedLink({ kind: "ticket", id: "PROJ-5" });
const OWNED_TICKET = markedLink({ kind: "ticket", id: "PROJ-9" });
const NOISE_ARTIFACT = markedLink({ kind: "artifact", id: "abc" });

describe("isLinkShown", () => {
  const COMMIT = markedLink({ kind: "commit", id: "0123456789abcdef" });
  const settings = (overrides: Partial<LinkViewSettings> = {}): LinkViewSettings => ({
    enabledKinds: new Set(["pr", "ticket", "artifact"]),
    jiraBaseUrl: "",
    showsOnlyOpenPrs: true,
    ...overrides,
  });
  const prStatus = (text: string) => ({ text, colorKey: text });

  it("hides kinds that are off, commits by default", () => {
    expect(isLinkShown(COMMIT, undefined, settings())).toBe(false);
    expect(isLinkShown(COMMIT, undefined, settings({ enabledKinds: new Set(["commit"]) }))).toBe(true);
    expect(isLinkShown(OWNED_PR, prStatus("open"), settings({ enabledKinds: new Set(["ticket"]) }))).toBe(false);
  });

  it("hides merged and closed PRs only when open-only is on", () => {
    expect(isLinkShown(OWNED_PR, prStatus("merged"), settings())).toBe(false);
    expect(isLinkShown(OWNED_PR, prStatus("closed"), settings())).toBe(false);
    expect(isLinkShown(OWNED_PR, prStatus("merged"), settings({ showsOnlyOpenPrs: false }))).toBe(true);
  });

  it("shows open PRs, PRs with no known status, and tickets whose status reads closed", () => {
    for (const text of ["draft", "open", "review required", "approved", "changes requested"]) {
      expect(isLinkShown(OWNED_PR, prStatus(text), settings())).toBe(true);
    }
    expect(isLinkShown(OWNED_PR, undefined, settings())).toBe(true);
    expect(isLinkShown(OWNED_TICKET, prStatus("closed"), settings())).toBe(true);
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
});

describe("linkForItemKey", () => {
  it("rebuilds a row link from an item key and rejects unknown kinds", () => {
    expect(linkForItemKey("pr:acme/web/pull/3")).toMatchObject({ kind: "pr", id: "acme/web/pull/3", url: "https://github.com/acme/web/pull/3" });
    expect(linkForItemKey("ticket:PROJ-1")).toMatchObject({ kind: "ticket", id: "PROJ-1", url: undefined });
    expect(linkForItemKey("note:x")).toBeUndefined();
    expect(linkForItemKey("ticket:")).toBeUndefined();
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

describe("resourceRow", () => {
  it("draws the status glyph in the status color once a status loads", () => {
    const mergedRow = resourceRow(OWNED_PR, { text: "merged", colorKey: "merged" }, "#a371f7", "");
    expect(mergedRow).toMatchObject({
      key: "pr:acme/web-app/pull/2384",
      displayId: "web-app#2384",
      statusText: "merged",
      statusColor: "#a371f7",
    });
    expect(mergedRow.glyph).toBe(statusGlyphMarkup("git-merge"));
  });

  it("draws the plain kind glyph with no color before a status loads, and always for artifacts", () => {
    expect(resourceRow(OWNED_PR, undefined, undefined, "")).toMatchObject({ statusColor: undefined });
    const artifactRow = resourceRow(NOISE_ARTIFACT, { text: "x", colorKey: "x" }, "#ffffff", "");
    expect(artifactRow.statusColor).toBeUndefined();
    expect(artifactRow.glyph).toBe(statusGlyphMarkup("sparkles"));
  });

  it("builds a ticket URL only when the Jira base URL is set", () => {
    expect(resourceRow(OWNED_TICKET, undefined, undefined, "").url).toBeUndefined();
    expect(resourceRow(OWNED_TICKET, undefined, undefined, "https://acme.atlassian.net/").url).toBe(
      "https://acme.atlassian.net/browse/PROJ-9",
    );
  });
});

describe("acceptedOrder", () => {
  it("accepts a reorder of exactly the shown keys and rejects a stale one", () => {
    expect(acceptedOrder(["a", "b", "c"], ["c", "a", "b"])).toEqual(["c", "a", "b"]);
    expect(acceptedOrder(["a", "b", "c"], ["c", "a"])).toBeUndefined();
    expect(acceptedOrder(["a", "b", "c"], ["c", "a", "a"])).toBeUndefined();
    expect(acceptedOrder(["a", "b"], ["a", "x"])).toBeUndefined();
  });
});
