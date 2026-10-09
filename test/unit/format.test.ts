import { describe, expect, it } from "vitest";
import { formatAge } from "../../src/format";

const NOW_MS = Date.UTC(2026, 9, 9, 12);

describe("formatAge", () => {
  it.each([
    [30_000, "just now"],
    [5 * 60_000, "5m ago"],
    [3 * 3_600_000, "3h ago"],
    [2 * 86_400_000, "2d ago"],
  ])("formats %ims elapsed as %s", (elapsedMs, expectedAge) => {
    expect(formatAge(NOW_MS - elapsedMs, NOW_MS)).toBe(expectedAge);
  });
});
