import { describe, expect, it } from "vitest";
import { GROUP_ICON_COLOR_IDS, groupIconColorId, UNGROUPED_ICON_COLOR_ID } from "../../src/groupIcons";

const USER_GROUP_REFS = ["user:a", "user:b", "user:c", "user:d", "user:e", "user:f", "user:g", "user:h"];

describe("groupIconColorId", () => {
  it("gives each user group the color for its place in the list", () => {
    expect(groupIconColorId("user:a", USER_GROUP_REFS)).toBe("overseer.groupIcon1");
    expect(groupIconColorId("user:c", USER_GROUP_REFS)).toBe("overseer.groupIcon3");
    expect(groupIconColorId("user:f", USER_GROUP_REFS)).toBe("overseer.groupIcon6");
  });

  it("starts over after the sixth group", () => {
    expect(groupIconColorId("user:g", USER_GROUP_REFS)).toBe("overseer.groupIcon1");
    expect(groupIconColorId("user:h", USER_GROUP_REFS)).toBe("overseer.groupIcon2");
  });

  it("gives Ungrouped and unknown refs the plain icon color", () => {
    expect(groupIconColorId("ungrouped", USER_GROUP_REFS)).toBe(UNGROUPED_ICON_COLOR_ID);
    expect(groupIconColorId("user:a", [])).toBe(UNGROUPED_ICON_COLOR_ID);
  });

  it("has six distinct ids", () => {
    expect(new Set(GROUP_ICON_COLOR_IDS).size).toBe(6);
  });
});
