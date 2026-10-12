import { describe, expect, it } from "vitest";
import {
  defaultBadge,
  DEFAULT_SESSION_STATUSES,
  parseSessionStatuses,
  statusColorId,
  statusIdFor,
  statusOfSession,
} from "../../src/sessionStatuses";

describe("parseSessionStatuses", () => {
  it("uses the defaults when the setting isn't a list, and keeps an empty list empty", () => {
    expect(parseSessionStatuses(undefined)).toEqual(DEFAULT_SESSION_STATUSES);
    expect(parseSessionStatuses("Todo")).toEqual(DEFAULT_SESSION_STATUSES);
    expect(parseSessionStatuses([])).toEqual([]);
  });

  it("drops nameless entries and falls back on bad fields", () => {
    expect(
      parseSessionStatuses([
        { name: "  " },
        null,
        { name: "Blocked on QA", color: "chartreuse", icon: "Not An Icon" },
        { id: "x", name: "Ship", color: "green", icon: "rocket", badge: "SHIP" },
      ]),
    ).toEqual([
      { id: "blocked-on-qa", name: "Blocked on QA", color: "gray", icon: "circle-filled", badge: "BO", asksReason: false },
      { id: "x", name: "Ship", color: "green", icon: "rocket", badge: "SH", asksReason: false },
    ]);
  });

  it("keeps an empty badge, and makes duplicate ids unique", () => {
    expect(
      parseSessionStatuses([
        { id: "todo", name: "Todo", badge: "" },
        { id: "todo", name: "Todo again" },
      ]).map((status) => [status.id, status.badge]),
    ).toEqual([
      ["todo", ""],
      ["todo-2", "TA"],
    ]);
  });
});

describe("asking for a reason", () => {
  it("ships Blocked as the one default that asks", () => {
    const asking = DEFAULT_SESSION_STATUSES.filter((status) => status.asksReason).map((status) => status.id);
    expect(asking).toEqual(["blocked"]);
  });

  it("keeps asksReason only when it is exactly true", () => {
    const parsed = parseSessionStatuses([
      { name: "A", asksReason: true },
      { name: "B", asksReason: "yes" },
      { name: "C" },
    ]);
    expect(parsed.map((status) => status.asksReason)).toEqual([true, false, false]);
  });
});

describe("status helpers", () => {
  it("slugs a name into a free id", () => {
    expect(statusIdFor("AI Review!", [])).toBe("ai-review");
    expect(statusIdFor("AI Review", ["ai-review", "ai-review-2"])).toBe("ai-review-3");
    expect(statusIdFor("???", [])).toBe("status");
  });

  it("makes badges from initials, or the start of a single word", () => {
    expect(defaultBadge("Ready to Ship")).toBe("RT");
    expect(defaultBadge("triage")).toBe("TR");
  });

  it("names the palette color id", () => {
    expect(statusColorId("purple")).toBe("overseer.statusPurple");
  });

  it("finds a session's status, and ignores one deleted from the setting", () => {
    const assignments = { a: "triage", b: "gone" };
    expect(statusOfSession("a", assignments, DEFAULT_SESSION_STATUSES)?.name).toBe("Triage");
    expect(statusOfSession("b", assignments, DEFAULT_SESSION_STATUSES)).toBeUndefined();
    expect(statusOfSession("c", assignments, DEFAULT_SESSION_STATUSES)).toBeUndefined();
  });
});
