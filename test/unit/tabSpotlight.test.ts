import { describe, expect, it } from "vitest";
import { withTabSpotlight } from "../../src/tabSpotlight";

const COLORS_BY_THEME = {
  "Overseer Hoard": {
    "tab.activeBackground": "#2E2512",
    "tab.unfocusedActiveBackground": "#0D0C0A",
    "tab.activeBorderTop": "#D4A017",
    "tab.unfocusedActiveBorderTop": "#00000000",
  },
  "Overseer Frost": {
    "tab.activeBackground": "#16305A",
    "tab.unfocusedActiveBackground": "#060B14",
    "tab.activeBorderTop": "#6BA4FF",
    "tab.unfocusedActiveBorderTop": "#00000000",
  },
};

describe("withTabSpotlight enabled", () => {
  it("adds a block per theme to empty customizations", () => {
    expect(withTabSpotlight(undefined, COLORS_BY_THEME, true)).toEqual({
      "[Overseer Hoard]": COLORS_BY_THEME["Overseer Hoard"],
      "[Overseer Frost]": COLORS_BY_THEME["Overseer Frost"],
    });
    expect(withTabSpotlight({}, COLORS_BY_THEME, true)).toEqual({
      "[Overseer Hoard]": COLORS_BY_THEME["Overseer Hoard"],
      "[Overseer Frost]": COLORS_BY_THEME["Overseer Frost"],
    });
  });

  it("changes nothing on a second run", () => {
    const firstRun = withTabSpotlight({}, COLORS_BY_THEME, true);
    expect(withTabSpotlight(firstRun, COLORS_BY_THEME, true)).toBeUndefined();
  });

  it("keeps a color the user already set and fills only the missing ones", () => {
    const customized = { "[Overseer Hoard]": { "tab.activeBackground": "#123456", "editor.background": "#000000" } };
    const result = withTabSpotlight(customized, COLORS_BY_THEME, true);
    expect(result?.["[Overseer Hoard]"]).toEqual({
      "tab.activeBackground": "#123456",
      "editor.background": "#000000",
      "tab.unfocusedActiveBackground": "#0D0C0A",
      "tab.activeBorderTop": "#D4A017",
      "tab.unfocusedActiveBorderTop": "#00000000",
    });
    expect(customized["[Overseer Hoard]"]).toEqual({ "tab.activeBackground": "#123456", "editor.background": "#000000" });
  });

  it("keeps unrelated keys and other theme blocks", () => {
    const customized = { "statusBar.background": "#111111", "[Default Dark+]": { "tab.activeBackground": "#222222" } };
    const result = withTabSpotlight(customized, COLORS_BY_THEME, true);
    expect(result?.["statusBar.background"]).toBe("#111111");
    expect(result?.["[Default Dark+]"]).toEqual({ "tab.activeBackground": "#222222" });
  });

  it("leaves a theme block that isn't an object alone", () => {
    const customized = { "[Overseer Hoard]": "broken" };
    expect(withTabSpotlight(customized, COLORS_BY_THEME, true)?.["[Overseer Hoard]"]).toBe("broken");
  });
});

describe("withTabSpotlight disabled", () => {
  it("removes only the spotlight colors, ignoring hex case, and drops blocks left empty", () => {
    const customized = {
      "statusBar.background": "#111111",
      "[Overseer Hoard]": {
        "tab.activeBackground": "#2e2512",
        "tab.unfocusedActiveBackground": "#0D0C0A",
        "tab.activeBorderTop": "#D4A017",
        "tab.unfocusedActiveBorderTop": "#00000000",
        "editor.background": "#000000",
      },
      "[Overseer Frost]": COLORS_BY_THEME["Overseer Frost"],
    };
    expect(withTabSpotlight(customized, COLORS_BY_THEME, false)).toEqual({
      "statusBar.background": "#111111",
      "[Overseer Hoard]": { "editor.background": "#000000" },
    });
  });

  it("keeps a spotlight color the user changed", () => {
    const customized = { "[Overseer Hoard]": { ...COLORS_BY_THEME["Overseer Hoard"], "tab.activeBorderTop": "#FF0000" } };
    expect(withTabSpotlight(customized, COLORS_BY_THEME, false)).toEqual({
      "[Overseer Hoard]": { "tab.activeBorderTop": "#FF0000" },
    });
  });

  it("changes nothing when no spotlight colors are present", () => {
    expect(withTabSpotlight({ "statusBar.background": "#111111" }, COLORS_BY_THEME, false)).toBeUndefined();
    expect(withTabSpotlight(undefined, COLORS_BY_THEME, false)).toBeUndefined();
  });
});

describe("withTabSpotlight non-object input", () => {
  it("leaves a setting that isn't an object alone", () => {
    for (const value of ["text", 42, ["[Overseer Hoard]"], true]) {
      expect(withTabSpotlight(value, COLORS_BY_THEME, true)).toBeUndefined();
      expect(withTabSpotlight(value, COLORS_BY_THEME, false)).toBeUndefined();
    }
  });

  it("treats null as unset", () => {
    expect(withTabSpotlight(null, COLORS_BY_THEME, true)).toHaveProperty("[Overseer Hoard]");
  });
});
