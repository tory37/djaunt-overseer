import { describe, expect, it } from "vitest";
import {
  ConcurrencyLimiter,
  linkDisplayId,
  isDimmedLink,
  LinkViewSettings,
  linkUrl,
  MarkedLink,
  markLinks,
  ownedTicketKey,
  sessionPanelLinks,
  withDeclarations,
  visibleLinks,
  withParentGroups,
} from "../../src/linkView";
import { LinkStatus } from "../../src/linkStatus";
import { orderResources } from "../../src/resourceOrder";
import { acceptedOrder, resourceRow } from "../../src/resourceRows";
import { statusGlyphMarkup } from "../../src/statusIcons";

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

  it("sorts by the saved order within each mark and puts unsaved links first", () => {
    const pinnedTicket = { ...OWNED_TICKET, mark: "pinned" as const };
    const links = [OWNED_PR, TOUCHED_TICKET, pinnedTicket];
    const savedOrder = ["ticket:PROJ-5", "ticket:PROJ-9"];

    expect(visibleLinks(links, settings(), savedOrder).map((link) => link.id)).toEqual([
      "PROJ-9",
      "acme/web-app/pull/2384",
      "PROJ-5",
    ]);
    expect(visibleLinks(links, settings(), [...savedOrder, "pr:acme/web-app/pull/2384"]).map((link) => link.id)).toEqual([
      "PROJ-9",
      "PROJ-5",
      "acme/web-app/pull/2384",
    ]);
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

  it("picks the owned ticket, not a touched one", () => {
    expect(ownedTicketKey([OWNED_PR, TOUCHED_TICKET, OWNED_TICKET])).toBe("PROJ-9");
    expect(ownedTicketKey([TOUCHED_TICKET])).toBeUndefined();
  });

  it("prefers a pinned ticket and skips a removed one", () => {
    expect(ownedTicketKey([OWNED_TICKET, { ...TOUCHED_TICKET, mark: "pinned" }])).toBe("PROJ-5");
    expect(ownedTicketKey([{ ...OWNED_TICKET, mark: "removed" }])).toBeUndefined();
  });

  it("prefers a declared ticket over the judge's pick but not over a pin", () => {
    const declaredTicket = { ...TOUCHED_TICKET, isAgentDeclared: true };
    expect(ownedTicketKey([OWNED_TICKET, declaredTicket])).toBe("PROJ-5");
    expect(ownedTicketKey([{ ...OWNED_TICKET, mark: "pinned" }, declaredTicket])).toBe("PROJ-9");
    expect(ownedTicketKey([OWNED_TICKET, { ...declaredTicket, mark: "removed" }])).toBe("PROJ-9");
  });
});

describe("withDeclarations", () => {
  it("marks a scanned ticket as declared and owned", () => {
    const [declaredLink] = withDeclarations([TOUCHED_TICKET], [{ key: "PROJ-5", note: "fixing it", addedAt: 1 }]);
    expect(declaredLink).toMatchObject({ id: "PROJ-5", role: "owned", isAgentDeclared: true, agentNote: "fixing it", judged: true });
  });

  it("adds declared tickets the scan never saw, first", () => {
    const links = withDeclarations([OWNED_PR], [{ key: "PROJ-77", addedAt: 1 }]);
    expect(links.map((link) => link.id)).toEqual(["PROJ-77", OWNED_PR.id]);
    expect(links[0]).toMatchObject({ kind: "ticket", role: "owned", isAgentDeclared: true, judged: false });
  });

  it("leaves links alone when nothing is declared", () => {
    expect(withDeclarations([OWNED_PR, TOUCHED_TICKET], [], [])).toEqual([OWNED_PR, TOUCHED_TICKET]);
  });

  it("matches a declared PR to the scanned one, whatever the URL's case", () => {
    const scannedPr = resolvedLink({ kind: "pr", id: "acme/web/pull/12", url: "https://github.com/acme/web/pull/12", role: "touched" });
    const links = withDeclarations([scannedPr], [], [{ url: "https://github.com/Acme/Web/pull/12", note: "the fix", addedAt: 1 }]);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ id: "acme/web/pull/12", role: "owned", isAgentDeclared: true, agentNote: "the fix" });
  });

  it("passes the declared parent through as a link key", () => {
    const links = withDeclarations(
      [TOUCHED_TICKET],
      [{ key: "PROJ-5", parentKey: "PROJ-1", addedAt: 1 }],
      [{ url: "https://github.com/acme/web/pull/40", parentKey: "PROJ-5", addedAt: 1 }],
      [{ url: "https://claude.ai/artifact/abc-1", parentKey: "https://github.com/Acme/Web/pull/40", addedAt: 1 }],
    );
    const parentsById = Object.fromEntries(links.map((link) => [link.id, link.declaredParentKey]));
    expect(parentsById).toEqual({ "PROJ-5": "ticket:PROJ-1", "acme/web/pull/40": "ticket:PROJ-5", "abc-1": "pr:acme/web/pull/40" });
  });

  it("adds declared artifacts as owned links that land in Working on", () => {
    const scannedArtifact = resolvedLink({ kind: "artifact", id: "seen", url: "https://claude.ai/artifact/seen", role: "irrelevant" });
    const links = withDeclarations(
      [scannedArtifact],
      [],
      [],
      [
        { url: "https://claude.ai/code/artifact/seen", note: "report", addedAt: 1 },
        { url: "https://claude.ai/artifact/new-1", addedAt: 1 },
      ],
    );
    expect(links.map((link) => link.id)).toEqual(["new-1", "seen"]);
    expect(links[0]).toMatchObject({ kind: "artifact", url: "https://claude.ai/artifact/new-1", isAgentDeclared: true, judged: false });
    expect(links[1]).toMatchObject({ role: "owned", isAgentDeclared: true, agentNote: "report" });
    expect(sessionPanelLinks(markLinks(links, {}), {}).workingOn).toHaveLength(2);
  });

  it("adds a declared PR the scan never saw, with its URL", () => {
    const [declaredPr] = withDeclarations([], [], [{ url: "https://github.com/acme/web/pull/40", addedAt: 1 }]);
    expect(declaredPr).toMatchObject({ kind: "pr", id: "acme/web/pull/40", url: "https://github.com/acme/web/pull/40", isAgentDeclared: true });
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

describe("isDimmedLink", () => {
  it("dims removed, irrelevant, and inactive links, unless pinned", () => {
    const irrelevantTicket = resolvedLink({ kind: "ticket", id: "ABC-1", role: "irrelevant" });
    const inactivePr = { ...OWNED_PR, stillRelevant: false };
    expect(isDimmedLink(OWNED_PR)).toBe(false);
    expect(isDimmedLink(irrelevantTicket)).toBe(true);
    expect(isDimmedLink(inactivePr)).toBe(true);
    expect(isDimmedLink({ ...OWNED_PR, mark: "removed" })).toBe(true);
    expect(isDimmedLink({ ...inactivePr, mark: "pinned" })).toBe(false);
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

describe("sessionPanelLinks", () => {
  it("puts declared and pinned links of every kind under Working on and the rest under Also seen", () => {
    const declaredTicket = { ...OWNED_TICKET, isAgentDeclared: true };
    const pinnedTicket = { ...TOUCHED_TICKET, mark: "pinned" as const };
    const declaredPr = { ...OWNED_PR, id: "acme/web/pull/3", isAgentDeclared: true };
    const seenTicket = resolvedLink({ kind: "ticket", id: "PROJ-30", role: "touched" });
    const { workingOn, alsoSeen } = sessionPanelLinks([OWNED_PR, declaredTicket, pinnedTicket, declaredPr, seenTicket], {});
    expect(workingOn.map((link) => link.id)).toEqual(["PROJ-9", "PROJ-5", "acme/web/pull/3"]);
    expect(alsoSeen.map((link) => link.id)).toEqual([OWNED_PR.id, "PROJ-30"]);
  });

  it("sends a removed link to Also seen, even a declared one", () => {
    const removedDeclared = { ...OWNED_TICKET, isAgentDeclared: true, mark: "removed" as const };
    expect(sessionPanelLinks([removedDeclared], {})).toEqual({ workingOn: [], alsoSeen: [removedDeclared] });
  });

  it("shows a ticket pinned by key that no scan has seen", () => {
    const { workingOn } = sessionPanelLinks([TOUCHED_TICKET], { "ticket:PROJ-88": "pinned", "ticket:PROJ-5": "removed", "pr:x": "pinned" });
    expect(workingOn).toHaveLength(1);
    expect(workingOn[0]).toMatchObject({ kind: "ticket", id: "PROJ-88", mark: "pinned" });
  });
});

describe("withParentGroups", () => {
  const firstChild = resolvedLink({ kind: "ticket", id: "PROJ-2", role: "owned", isAgentDeclared: true, declaredParentKey: "ticket:EPIC-1" });
  const secondChild = resolvedLink({ kind: "ticket", id: "PROJ-3", role: "owned", isAgentDeclared: true });
  const jiraStatuses: Record<string, LinkStatus> = { "PROJ-3": { text: "To Do", colorKey: "To Do", parentKey: "EPIC-1" } };
  const statusFor = (link: MarkedLink): LinkStatus | undefined => jiraStatuses[link.id];

  it("adds a shared parent that is not shown as a group row, and the tickets nest under it", () => {
    const { workingOn, alsoSeen } = withParentGroups({ workingOn: [firstChild, secondChild], alsoSeen: [] }, statusFor, {});
    expect(workingOn[0]).toMatchObject({ kind: "ticket", id: "EPIC-1", role: "touched", isParentGroup: true });
    expect(workingOn[0].isAgentDeclared).toBeUndefined();
    expect(alsoSeen).toEqual([]);
    const ordered = orderResources(workingOn, statusFor, false).map(({ link, depth }) => [link.id, depth]);
    expect(ordered).toEqual([
      ["EPIC-1", 0],
      ["PROJ-2", 1],
      ["PROJ-3", 1],
    ]);
  });

  it("moves a parent seen in the transcript up from Also seen", () => {
    const seenEpic = resolvedLink({ kind: "ticket", id: "EPIC-1", role: "touched", label: "Epic" });
    const { workingOn, alsoSeen } = withParentGroups({ workingOn: [firstChild, secondChild], alsoSeen: [seenEpic, OWNED_PR] }, statusFor, {});
    expect(workingOn[0]).toMatchObject({ id: "EPIC-1", label: "Epic", isParentGroup: true });
    expect(alsoSeen).toEqual([OWNED_PR]);
  });

  it("needs two tickets, an unshown parent, and a parent the user kept", () => {
    const sections = { workingOn: [firstChild, secondChild], alsoSeen: [] };
    expect(withParentGroups({ workingOn: [firstChild], alsoSeen: [] }, statusFor, {}).workingOn).toEqual([firstChild]);
    expect(withParentGroups(sections, statusFor, { "ticket:EPIC-1": "removed" })).toBe(sections);
    const shownEpic = resolvedLink({ kind: "ticket", id: "EPIC-1", role: "owned", isAgentDeclared: true });
    const withShownEpic = { workingOn: [shownEpic, firstChild, secondChild], alsoSeen: [] };
    expect(withParentGroups(withShownEpic, statusFor, {})).toBe(withShownEpic);
  });

  it("ignores the parents of PRs and artifacts", () => {
    const prs = [1, 2].map((number) =>
      resolvedLink({ kind: "pr", id: `acme/web/pull/${number}`, role: "owned", isAgentDeclared: true, declaredParentKey: "ticket:EPIC-1" }),
    );
    expect(withParentGroups({ workingOn: prs, alsoSeen: [] }, statusFor, {}).workingOn).toEqual(prs);
  });
});
