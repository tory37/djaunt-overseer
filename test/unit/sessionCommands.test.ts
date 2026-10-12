import { describe, expect, it } from "vitest";
import { DEFAULT_SESSION_COMMANDS, fillPrompt, parseSessionCommands, promptParameters } from "../../src/sessionCommands";

describe("parseSessionCommands", () => {
  it("uses the defaults when the setting isn't a list, and keeps an empty list empty", () => {
    expect(parseSessionCommands(undefined)).toEqual(DEFAULT_SESSION_COMMANDS);
    expect(parseSessionCommands("Triage")).toEqual(DEFAULT_SESSION_COMMANDS);
    expect(parseSessionCommands([])).toEqual([]);
  });

  it("drops entries missing a name or a prompt and trims the rest", () => {
    expect(
      parseSessionCommands([null, { name: "  ", prompt: "x" }, { name: "Empty", prompt: " " }, { name: " Ship ", prompt: " Ship it. " }]),
    ).toEqual([{ name: "Ship", prompt: "Ship it." }]);
  });
});

describe("promptParameters", () => {
  it("lists each placeholder once, in order", () => {
    expect(promptParameters("Triage {ticket link}, then {repo} and {ticket link}")).toEqual(["ticket link", "repo"]);
  });

  it("finds none in a plain prompt", () => {
    expect(promptParameters("Pull the reviews.")).toEqual([]);
  });
});

describe("fillPrompt", () => {
  it("fills every use of a placeholder and flattens line breaks in the value", () => {
    expect(fillPrompt("Look at {ticket link} ({ticket link})", { "ticket link": "PROJ-1\nPROJ-2" })).toBe("Look at PROJ-1 PROJ-2 (PROJ-1 PROJ-2)");
  });

  it("leaves a prompt without placeholders alone", () => {
    expect(fillPrompt("Pull the reviews.", {})).toBe("Pull the reviews.");
  });
});
