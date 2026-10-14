import { describe, expect, it } from "vitest";
import { assignWorkspace, dropWorkspace, idsInWorkspace, withDefaultWorkspace, workspaceContentsLabel } from "../../src/workspaces";

describe("workspaces", () => {
  it("adds Default only when it is not stored", () => {
    expect(withDefaultWorkspace([{ id: "w1", name: "Work" }]).map((workspace) => workspace.id)).toEqual(["default", "w1"]);
    expect(withDefaultWorkspace([{ id: "default", name: "Home" }])).toEqual([{ id: "default", name: "Home" }]);
  });

  it("treats a missing entry as Default and stores Default as no entry", () => {
    const membership = assignWorkspace({ a: "w1" }, ["a", "b"], "default");

    expect(membership).toEqual({});
    expect(idsInWorkspace(["a", "b"], assignWorkspace(membership, ["b"], "w1"), "default")).toEqual(["a"]);
  });

  it("drops only the deleted workspace's entries", () => {
    expect(dropWorkspace({ a: "w1", b: "w2" }, "w1")).toEqual({ b: "w2" });
  });

  it("labels what a workspace holds", () => {
    expect(workspaceContentsLabel(0, 0)).toBe("empty");
    expect(workspaceContentsLabel(1, 0)).toBe("1 session");
    expect(workspaceContentsLabel(3, 2)).toBe("3 sessions · 2 terminals");
  });
});
