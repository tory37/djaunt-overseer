import { describe, expect, it } from "vitest";
import { moveBeside, sortBySavedOrder } from "../../src/reorder";

describe("moveBeside", () => {
  it("puts an item dragged down after the target", () => {
    expect(moveBeside(["a", "b", "c", "d"], ["a"], "c")).toEqual(["b", "c", "a", "d"]);
  });

  it("puts an item dragged up before the target", () => {
    expect(moveBeside(["a", "b", "c", "d"], ["d"], "b")).toEqual(["a", "d", "b", "c"]);
  });

  it("can move an item to the very end and the very start", () => {
    expect(moveBeside(["a", "b", "c"], ["a"], "c")).toEqual(["b", "c", "a"]);
    expect(moveBeside(["a", "b", "c"], ["c"], "a")).toEqual(["c", "a", "b"]);
  });

  it("puts items from outside the list before the target", () => {
    expect(moveBeside(["a", "b"], ["x"], "b")).toEqual(["a", "x", "b"]);
  });

  it("keeps a multi-selection together in its order", () => {
    expect(moveBeside(["a", "b", "c", "d"], ["a", "b"], "d")).toEqual(["c", "d", "a", "b"]);
  });

  it("appends when there is no target and ignores a drop onto itself", () => {
    expect(moveBeside(["a", "b", "c"], ["a"], undefined)).toEqual(["b", "c", "a"]);
    expect(moveBeside(["a", "b", "c"], ["b"], "b")).toEqual(["a", "b", "c"]);
  });
});

describe("sortBySavedOrder", () => {
  it("ranks unsaved ids first and keeps their incoming order", () => {
    const sorted = sortBySavedOrder(["new1", "c", "new2", "a"], ["a", "b", "c"], (id) => id);

    expect(sorted).toEqual(["new1", "new2", "a", "c"]);
  });
});
