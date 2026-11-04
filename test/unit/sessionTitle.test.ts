import { describe, expect, it } from "vitest";
import { hiddenLabelTicketKeys, shownSessionTitle, SessionTitleSources } from "../../src/sessionTitle";

const ALL_SOURCES: SessionTitleSources = {
  label: "PROJ-2567",
  isLocked: false,
  analyzerTitle: "Login timeout bug",
  indexedTitle: "fix the login timeout",
};

describe("shownSessionTitle", () => {
  it("prefers a locked label over everything", () => {
    expect(shownSessionTitle({ ...ALL_SOURCES, isLocked: true })).toEqual({ text: "PROJ-2567", source: "locked" });
  });

  it("prefers the analyzer title over an unlocked label", () => {
    expect(shownSessionTitle(ALL_SOURCES)).toEqual({ text: "Login timeout bug", source: "analyzer" });
  });

  it("falls back to the label, then the indexed title", () => {
    expect(shownSessionTitle({ ...ALL_SOURCES, analyzerTitle: undefined })).toEqual({ text: "PROJ-2567", source: "label" });
    expect(shownSessionTitle({ ...ALL_SOURCES, analyzerTitle: undefined, label: undefined })).toEqual({
      text: "fix the login timeout",
      source: "index",
    });
  });

  it("ignores a lock with no label", () => {
    expect(shownSessionTitle({ ...ALL_SOURCES, label: undefined, isLocked: true })).toEqual({ text: "Login timeout bug", source: "analyzer" });
  });

  it("returns undefined when nothing names the session", () => {
    expect(shownSessionTitle({ label: undefined, isLocked: false, analyzerTitle: undefined, indexedTitle: undefined })).toBeUndefined();
  });
});

describe("hiddenLabelTicketKeys", () => {
  it("lists the label's ticket keys that the shown title leaves out", () => {
    expect(hiddenLabelTicketKeys("PROJ-2567 and OPS-12 login", "Login timeout bug")).toEqual(["PROJ-2567", "OPS-12"]);
  });

  it("lists nothing when the title already shows the key", () => {
    expect(hiddenLabelTicketKeys("PROJ-2567", "PROJ-2567")).toEqual([]);
    expect(hiddenLabelTicketKeys("PROJ-2567 OPS-12", "OPS-12 login")).toEqual(["PROJ-2567"]);
  });

  it("lists nothing for a missing label or one with no key", () => {
    expect(hiddenLabelTicketKeys(undefined, "Login timeout bug")).toEqual([]);
    expect(hiddenLabelTicketKeys("my login work", "Login timeout bug")).toEqual([]);
  });
});
