import { describe, expect, it } from "vitest";
import { enrichCandidates } from "../../src/candidateEnrichment";
import { LinkCandidate } from "../../src/linkCandidates";
import { LinkStatus } from "../../src/linkStatus";

function candidate(kind: LinkCandidate["kind"], id: string, extra: Partial<LinkCandidate> = {}): LinkCandidate {
  return { kind, id, url: undefined, title: undefined, signals: {}, snippets: [], firstSeen: undefined, lastSeen: undefined, ...extra };
}

describe("enrichCandidates", () => {
  it("attaches PR title, branch, and state from the PR cache", () => {
    const prStatuses = new Map<string, LinkStatus>([
      ["acme/api/pull/77", { text: "merged", colorKey: "merged", title: "Fix tile", branch: "fix/tile" }],
    ]);
    const [pr] = enrichCandidates([candidate("pr", "acme/api/pull/77", { title: "old", repo: "acme/api" })], prStatuses, new Map());

    expect(pr).toMatchObject({ title: "Fix tile", branch: "fix/tile", status: "merged", repo: "acme/api" });
  });

  it("attaches ticket summary, status, and parent from the ticket cache", () => {
    const ticketStatuses = new Map<string, LinkStatus>([
      ["PROJ-2", { text: "Ready for QA", colorKey: "Ready for QA", title: "Tile bug", parentKey: "PROJ-1" }],
    ]);
    const [ticket] = enrichCandidates([candidate("ticket", "PROJ-2")], new Map(), ticketStatuses);

    expect(ticket).toMatchObject({ title: "Tile bug", status: "Ready for QA", parentKey: "PROJ-1" });
  });

  it("keeps transcript facts when nothing is cached, and never looks up commits or artifacts", () => {
    const prStatuses = new Map<string, LinkStatus>([["abc1234", { text: "open", colorKey: "open", title: "wrong" }]]);
    const commit = candidate("commit", "abc1234", { title: "subject", branch: "main" });
    const pr = candidate("pr", "acme/web/pull/1", { title: "from gh pr create" });

    const [enrichedCommit, enrichedPr] = enrichCandidates([commit, pr], prStatuses, new Map());

    expect(enrichedCommit).toEqual(commit);
    expect(enrichedCommit).not.toBe(commit);
    expect(enrichedPr).toEqual(pr);
  });
});
