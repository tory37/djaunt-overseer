import { describe, expect, it } from "vitest";
import { badgeColor, badgeStyle } from "../../src/portraitBadge";

const none = { colorCustomizations: undefined, themeName: undefined, themeColors: undefined, isLightTheme: false };

describe("badgeColor", () => {
  it("falls back to VS Code's defaults by theme kind", () => {
    expect(badgeColor("working", none)).toBe("#0DBC79");
    expect(badgeColor("working", { ...none, isLightTheme: true })).toBe("#00BC00");
  });

  it("uses the active Overseer theme's value", () => {
    expect(badgeColor("elsewhere", { ...none, themeColors: { "overseer.sessionElsewhere": "#F6C040" } })).toBe("#F6C040");
  });

  it("prefers the user's per-theme customization, then their plain one", () => {
    const sources = {
      ...none,
      themeName: "Overseer Ember",
      themeColors: { "overseer.sessionRunning": "#47D9A4" },
      colorCustomizations: { "overseer.sessionRunning": "#111111", "[Overseer Ember]": { "overseer.sessionRunning": "#222222" } },
    };
    expect(badgeColor("running", sources)).toBe("#222222");
    expect(badgeColor("running", { ...sources, themeName: "Other" })).toBe("#111111");
  });

  it("skips values that aren't hex colors", () => {
    expect(badgeColor("suspended", { ...none, colorCustomizations: { "overseer.sessionSuspended": "red" } })).toBe("#C5C5C5");
  });
});

describe("badgeStyle", () => {
  it("pulses while working or compacting and dims when suspended", () => {
    expect(badgeStyle("working")).toEqual({ pulse: true, dimmed: false });
    expect(badgeStyle("compacting").pulse).toBe(true);
    expect(badgeStyle("running")).toEqual({ pulse: false, dimmed: false });
    expect(badgeStyle("suspended")).toEqual({ pulse: false, dimmed: true });
  });
});
