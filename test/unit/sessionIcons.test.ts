import { describe, expect, it } from "vitest";
import { customSessionColor, isCodiconName, sessionIconName, withSessionColor } from "../../src/sessionIcons";

describe("sessionIconName", () => {
  it("uses a valid configured name, including the spin modifier", () => {
    expect(sessionIconName("running", "play-circle")).toBe("play-circle");
    expect(sessionIconName("working", " sync~spin ")).toBe("sync~spin");
  });

  it("falls back to the state's default for a blank or malformed name", () => {
    expect(sessionIconName("suspended", undefined)).toBe("debug-pause");
    expect(sessionIconName("suspended", "")).toBe("debug-pause");
    expect(sessionIconName("elsewhere", "$(window)")).toBe("window");
    expect(sessionIconName("duplicate", "Warning")).toBe("warning");
  });

  it("checks codicon names", () => {
    expect(isCodiconName("debug-pause")).toBe(true);
    expect(isCodiconName("debug-pause~pulse")).toBe(false);
    expect(isCodiconName("-pause")).toBe(false);
  });
});

describe("withSessionColor", () => {
  it("sets and removes one Overseer color and keeps the user's other customizations", () => {
    const existing = { "editor.background": "#000000", "overseer.sessionWorking": "#111111" };

    const updated = withSessionColor(existing, "overseer.sessionRunning", "#22AA44");
    expect(updated).toEqual({ ...existing, "overseer.sessionRunning": "#22AA44" });
    expect(existing).not.toHaveProperty("overseer.sessionRunning");

    expect(withSessionColor(updated, "overseer.sessionWorking", undefined)).toEqual({
      "editor.background": "#000000",
      "overseer.sessionRunning": "#22AA44",
    });
  });

  it("ignores a color that is not a six-digit hex", () => {
    expect(withSessionColor(undefined, "overseer.sessionWorking", "green")).toEqual({});
  });

  it("reads a custom color only when it is a string", () => {
    expect(customSessionColor({ "overseer.sessionWorking": "#123456" }, "overseer.sessionWorking")).toBe("#123456");
    expect(customSessionColor({ "overseer.sessionWorking": 3 }, "overseer.sessionWorking")).toBeUndefined();
    expect(customSessionColor(undefined, "overseer.sessionWorking")).toBeUndefined();
  });
});
