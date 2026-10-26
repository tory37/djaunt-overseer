import { describe, expect, it } from "vitest";
import { parseAutoStatusOutput, buildAutoStatusDigest } from "../../src/sessionStatusAuto";
import {
  doneStatusOption,
  formatStatusList,
  readStatusContext,
  readStatusOptions,
  readStatusRequest,
  resolveStatusOption,
} from "../../src/sessionStatusSync";

const OPTIONS = [
  { id: "in-progress", name: "In Progress", asksReason: false, done: false },
  { id: "blocked", name: "Blocked", asksReason: true, done: false },
];

describe("readStatusOptions", () => {
  it("keeps valid entries and drops the rest", () => {
    expect(readStatusOptions([{ id: "a", name: "A", asksReason: true }, { id: "", name: "x" }, null, "z"])).toEqual([
      { id: "a", name: "A", asksReason: true, done: false },
    ]);
    expect(readStatusOptions({})).toEqual([]);
  });

  it("keeps done only when it is exactly true", () => {
    expect(readStatusOptions([{ id: "a", name: "A", done: true }, { id: "b", name: "B", done: "yes" }]).map((option) => option.done)).toEqual([
      true,
      false,
    ]);
  });
});

describe("doneStatusOption", () => {
  it("finds the first done option, or none", () => {
    const options = [...OPTIONS, { id: "x", name: "X", asksReason: false, done: true }, { id: "y", name: "Y", asksReason: false, done: true }];
    expect(doneStatusOption(options)?.id).toBe("x");
    expect(doneStatusOption(OPTIONS)).toBeUndefined();
  });
});

describe("readStatusContext", () => {
  it("keeps tickets with a key and a status", () => {
    expect(
      readStatusContext({ currentStatusId: "blocked", tickets: [{ key: "AB-1", status: "Done", summary: "x" }, { key: "nope", status: "Done" }, { key: "AB-2" }] }),
    ).toEqual({ currentStatusId: "blocked", tickets: [{ key: "AB-1", status: "Done", summary: "x" }] });
    expect(readStatusContext(undefined)).toEqual({ tickets: [] });
  });
});

describe("readStatusRequest", () => {
  it("needs a status and clips the reason", () => {
    expect(readStatusRequest({ statusId: "blocked", reason: "  waiting\n on  QA " })).toEqual({ statusId: "blocked", reason: "waiting on QA" });
    expect(readStatusRequest({ statusId: "" })).toBeUndefined();
    expect(readStatusRequest({})).toEqual(undefined);
  });
});

describe("resolveStatusOption", () => {
  it("matches the id or the name in any case", () => {
    expect(resolveStatusOption(OPTIONS, "in-progress")?.id).toBe("in-progress");
    expect(resolveStatusOption(OPTIONS, " BLOCKED ")?.id).toBe("blocked");
    expect(resolveStatusOption(OPTIONS, "in progress")?.id).toBe("in-progress");
    expect(resolveStatusOption(OPTIONS, "done")).toBeUndefined();
  });
});

describe("formatStatusList", () => {
  it("lists options, the current status, and tickets", () => {
    const text = formatStatusList(OPTIONS, { currentStatusId: "blocked", tickets: [{ key: "AB-1", status: "Peer Review", summary: "Fix login" }] });
    expect(text).toContain("Session status: blocked (Blocked)");
    expect(text).toContain("blocked  (Blocked, give a reason)");
    expect(text).toContain("AB-1  Peer Review  (Fix login)");
  });
  it("says when nothing is configured", () => {
    expect(formatStatusList([], { tickets: [] })).toContain("No statuses");
  });
});

describe("auto status", () => {
  it("lists options and tickets in the digest", () => {
    const digest = buildAutoStatusDigest({ title: "T", options: OPTIONS, tickets: [{ key: "AB-1", status: "Done" }] });
    expect(digest).toContain("- blocked: Blocked");
    expect(digest).toContain("- AB-1: Done");
  });
  it("parses the model's answer", () => {
    const stdout = JSON.stringify({ result: 'Sure: {"statusId":"in-progress","reason":"AB-2 in progress"}' });
    expect(parseAutoStatusOutput(stdout, OPTIONS)).toEqual({ statusId: "in-progress", reason: "AB-2 in progress" });
  });
  it("rejects an unknown status and a failed run", () => {
    expect(() => parseAutoStatusOutput(JSON.stringify({ result: '{"statusId":"done"}' }), OPTIONS)).toThrow(/unknown status/);
    expect(() => parseAutoStatusOutput(JSON.stringify({ is_error: true, result: "boom" }), OPTIONS)).toThrow(/failed/);
    expect(() => parseAutoStatusOutput(JSON.stringify({ result: "no json" }), OPTIONS)).toThrow(/no JSON/);
  });
});
