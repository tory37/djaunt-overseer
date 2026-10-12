import { describe, expect, it } from "vitest";
import { LinkStatus } from "../../src/linkStatus";
import { MarkedLink } from "../../src/linkView";
import { orderResources } from "../../src/resourceOrder";

function link(overrides: Partial<MarkedLink> & Pick<MarkedLink, "kind" | "id">): MarkedLink {
  return {
    url: undefined,
    title: undefined,
    signals: {},
    snippets: [],
    firstSeen: undefined,
    lastSeen: undefined,
    role: "touched",
    stillRelevant: true,
    label: undefined,
    judged: true,
    mark: undefined,
    ...overrides,
  };
}

const EPIC = link({ kind: "ticket", id: "PROJ-1" });
const SUBTASK = link({ kind: "ticket", id: "PROJ-2" });
const BRANCH_PR = link({ kind: "pr", id: "acme/api/pull/7" });
const TITLE_PR = link({ kind: "pr", id: "acme/web/pull/8" });
const ORPHAN_PR = link({ kind: "pr", id: "acme/web/pull/9" });
const ARTIFACT = link({ kind: "artifact", id: "art" });
const LONE_TICKET = link({ kind: "ticket", id: "OTHER-5" });

const STATUSES: Record<string, LinkStatus> = {
  "PROJ-2": { text: "To Do", colorKey: "To Do", parentKey: "PROJ-1" },
  "acme/api/pull/7": { text: "open", colorKey: "open", branch: "feat/proj-2-login" },
  "acme/web/pull/8": { text: "open", colorKey: "open", title: "PROJ-1: wire the flag" },
};

function statusFor(resource: MarkedLink): LinkStatus | undefined {
  return STATUSES[resource.id];
}

function layout(links: MarkedLink[], hasSavedOrder = false): string[] {
  return orderResources(links, statusFor, hasSavedOrder).map(({ link: shown, depth }) => `${depth}:${shown.id}`);
}

describe("orderResources", () => {
  it("nests sub-tickets under the parent and PRs under the ticket in their branch or title", () => {
    expect(layout([ARTIFACT, ORPHAN_PR, LONE_TICKET, BRANCH_PR, TITLE_PR, SUBTASK, EPIC])).toEqual([
      "0:PROJ-1",
      "1:PROJ-2",
      "2:acme/api/pull/7",
      "1:acme/web/pull/8",
      "0:OTHER-5",
      "0:acme/web/pull/9",
      "0:art",
    ]);
  });

  it("uses the judge's parent only when Jira and the branch say nothing", () => {
    const placedArtifact = link({ kind: "artifact", id: "art", parentKey: "pr:acme/web/pull/9" });
    const misplacedSubtask = link({ kind: "ticket", id: "PROJ-2", parentKey: "ticket:OTHER-5" });
    expect(layout([placedArtifact, ORPHAN_PR, misplacedSubtask, EPIC, LONE_TICKET])).toEqual([
      "0:PROJ-1",
      "1:PROJ-2",
      "0:OTHER-5",
      "0:acme/web/pull/9",
      "1:art",
    ]);
  });

  it("keeps the input order among siblings when the user saved an order", () => {
    expect(layout([ORPHAN_PR, SUBTASK, ARTIFACT, EPIC], true)).toEqual(["0:acme/web/pull/9", "0:art", "0:PROJ-1", "1:PROJ-2"]);
  });

  it("puts pinned roots first and removed roots last", () => {
    const pinnedPr = link({ kind: "pr", id: "acme/web/pull/9", mark: "pinned" });
    const removedEpic = link({ kind: "ticket", id: "PROJ-1", mark: "removed" });
    expect(layout([removedEpic, LONE_TICKET, pinnedPr])).toEqual(["0:acme/web/pull/9", "0:OTHER-5", "0:PROJ-1"]);
  });

  it("breaks a parent cycle instead of dropping the links", () => {
    const first = link({ kind: "ticket", id: "A-1", parentKey: "ticket:B-1" });
    const second = link({ kind: "ticket", id: "B-1", parentKey: "ticket:A-1" });
    expect(layout([first, second])).toEqual(["0:A-1", "1:B-1"]);
  });
});
