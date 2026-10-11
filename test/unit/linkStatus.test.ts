import { describe, expect, it } from "vitest";
import { parsePrStatus, parseTicketStatus, prStatusArgs, ticketStatusArgs } from "../../src/linkStatus";

describe("parsePrStatus", () => {
  it("reads gh pr view state, draft, and review decision", () => {
    expect(parsePrStatus('{"isDraft":false,"reviewDecision":"REVIEW_REQUIRED","state":"OPEN"}')).toEqual({
      text: "open · review required",
      tone: "open",
    });
    expect(parsePrStatus('{"isDraft":false,"reviewDecision":"","state":"OPEN"}')).toEqual({ text: "open", tone: "open" });
    expect(parsePrStatus('{"isDraft":true,"reviewDecision":"APPROVED","state":"OPEN"}')).toEqual({ text: "draft", tone: "draft" });
    expect(parsePrStatus('{"state":"MERGED"}')).toEqual({ text: "merged", tone: "merged" });
    expect(parsePrStatus('{"state":"CLOSED"}')).toEqual({ text: "closed", tone: "closed" });
  });

  it("returns undefined for unknown shapes instead of throwing", () => {
    expect(parsePrStatus("not json")).toBeUndefined();
    expect(parsePrStatus("[]")).toBeUndefined();
    expect(parsePrStatus('{"state":"WEIRD"}')).toBeUndefined();
  });
});

describe("parseTicketStatus", () => {
  it("reads the Jira status name and category", () => {
    const ticketJson = JSON.stringify({
      key: "PROJ-1",
      fields: { status: { name: "In Review", statusCategory: { key: "indeterminate" } } },
    });
    expect(parseTicketStatus(ticketJson)).toEqual({ text: "In Review", tone: "active" });
    expect(parseTicketStatus(JSON.stringify({ fields: { status: { name: "Done", statusCategory: { key: "done" } } } }))).toEqual({
      text: "Done",
      tone: "done",
    });
    expect(parseTicketStatus(JSON.stringify({ fields: { status: { name: "Backlog", statusCategory: { key: "new" } } } }))).toEqual({
      text: "Backlog",
      tone: "todo",
    });
  });

  it("returns undefined without a status name", () => {
    expect(parseTicketStatus(JSON.stringify({ fields: {} }))).toBeUndefined();
    expect(parseTicketStatus("{")).toBeUndefined();
  });
});

describe("status commands", () => {
  it("asks gh and acli for only what the parsers read", () => {
    expect(prStatusArgs("https://github.com/acme/api/pull/77")).toEqual([
      "pr",
      "view",
      "https://github.com/acme/api/pull/77",
      "--json",
      "state,isDraft,reviewDecision",
    ]);
    expect(ticketStatusArgs("PROJ-1")).toEqual(["jira", "workitem", "view", "PROJ-1", "--json"]);
  });
});
