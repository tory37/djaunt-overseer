import { describe, expect, it } from "vitest";
import { UNOWN_GLYPHS, UNOWN_WORDS } from "../../src/coreLegends";
import { CREATURES_SCRIPT } from "../../src/flyingCreatures";

// A canvas context that accepts every call, so the creature script can run without a browser.
function fakeContext(): unknown {
  const transform = { transformPoint: (point: { x: number; y: number }) => point };
  return new Proxy({}, {
    get: (_target, key) => (key === "getTransform" ? () => transform : key === "fillStyle" ? "#808080" : () => undefined),
    set: () => true,
  });
}

describe("coreLegends", () => {
  it("spells Unown words only with Unown glyphs", () => {
    for (const word of UNOWN_WORDS) {
      for (const letter of word) expect(letter === " " || UNOWN_GLYPHS.includes(letter)).toBe(true);
    }
  });

  it("flies every creature through both layers without throwing", () => {
    const run = new Function("context", "palette", "width", "height", "rgbOf", "shade", "easeInOut", "clamp01", "window", "DOMPoint", `
      ${CREATURES_SCRIPT}
      const seen = new Set();
      for (const [round, creature] of creatures.entries()) {
        launch(creature, round * 100);
        for (let seconds = round * 100; seconds < round * 100 + 16; seconds += 0.25) {
          drawCreatures(seconds, "behind");
          drawCreatures(seconds, "front");
          if (pass) seen.add(pass.creature.draw.name);
        }
      }
      return seen.size;
    `);
    const palette = { primary: "#888", accent: "#888", dim: "#888", fire: ["#fc4", "#e85", "#e64"], dragon: "#97e", scales: "#5c7", ice: ["#eff", "#8cf", "#49e"] };
    const seen = run(fakeContext(), palette, 320, 260, () => [128, 128, 128], () => "rgb(0,0,0)", (t: number) => t,
      (t: number) => Math.max(0, Math.min(1, t)), { devicePixelRatio: 1 }, class { constructor(public x: number, public y: number) {} });
    expect(seen).toBe(12);
  });
});
