import { describe, expect, it } from "vitest";
import {
  DEFAULT_PR_COLORS,
  parsePrStatus,
  PR_STATUS_KEYS,
  prStatusArgs,
  statusGlyph,
  ticketStatus,
} from "../../src/linkStatus";

describe("parsePrStatus", () => {
  it("reads gh pr view state, draft, and review decision", () => {
    expect(parsePrStatus('{"isDraft":false,"reviewDecision":"REVIEW_REQUIRED","state":"OPEN"}')).toEqual({
      text: "open · review required",
      colorKey: "review required",
    });
    expect(parsePrStatus('{"isDraft":false,"reviewDecision":"","state":"OPEN"}')).toEqual({ text: "open", colorKey: "open" });
    expect(parsePrStatus('{"isDraft":true,"reviewDecision":"APPROVED","state":"OPEN"}')).toEqual({ text: "draft", colorKey: "draft" });
    expect(parsePrStatus('{"state":"MERGED"}')).toEqual({ text: "merged", colorKey: "merged" });
    expect(parsePrStatus('{"state":"CLOSED"}')).toEqual({ text: "closed", colorKey: "closed" });
  });

  it("returns undefined for unknown shapes instead of throwing", () => {
    expect(parsePrStatus("not json")).toBeUndefined();
    expect(parsePrStatus("[]")).toBeUndefined();
    expect(parsePrStatus('{"state":"WEIRD"}')).toBeUndefined();
  });
});

describe("ticketStatus and statusGlyph", () => {
  it("keys a ticket's color by its status name", () => {
    expect(ticketStatus("Peer Review")).toEqual({ text: "Peer Review", colorKey: "Peer Review" });
  });

  it("keeps a shape per state so color is not the only cue", () => {
    expect(statusGlyph("ticket", ticketStatus("Deployed to Prod"))).toBe("ticket-check");
    expect(statusGlyph("ticket", ticketStatus("In Progress"))).toBe("ticket");
    expect(statusGlyph("pr", { text: "merged", colorKey: "merged" })).toBe("git-merge");
    expect(statusGlyph("pr", { text: "draft", colorKey: "draft" })).toBe("git-pull-request-draft");
    expect(statusGlyph("pr", { text: "closed", colorKey: "closed" })).toBe("git-pull-request-closed");
    expect(statusGlyph("pr", { text: "open · approved", colorKey: "approved" })).toBe("git-pull-request");
  });
});

describe("status commands", () => {
  it("asks gh for only what the parser reads", () => {
    expect(prStatusArgs("https://github.com/acme/api/pull/77")).toEqual([
      "pr",
      "view",
      "https://github.com/acme/api/pull/77",
      "--json",
      "state,isDraft,reviewDecision",
    ]);
  });
});

describe("DEFAULT_PR_COLORS", () => {
  it("has a color for every PR status", () => {
    for (const statusKey of PR_STATUS_KEYS) {
      expect(DEFAULT_PR_COLORS[statusKey]).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});
