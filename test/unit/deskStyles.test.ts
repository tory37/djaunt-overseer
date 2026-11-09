import { describe, expect, it } from "vitest";
import { DESK_STYLE_BY_RACE, DESK_STYLES, deskStyleFor } from "../../src/deskStyles";
import { RACE_IDS } from "../../src/pixelRaces";

describe("deskStyles", () => {
  it("gives every race a desk style, and uses every style", () => {
    for (const race of RACE_IDS) {
      expect(DESK_STYLES[DESK_STYLE_BY_RACE[race]]).toBeDefined();
    }
    expect(new Set(Object.values(DESK_STYLE_BY_RACE))).toEqual(new Set(Object.keys(DESK_STYLES)));
  });

  it("falls back to the plain desk for humans and unknown races", () => {
    expect(deskStyleFor(undefined).id).toBe("standard");
    expect(deskStyleFor("human").id).toBe("standard");
    expect(deskStyleFor("vampire").decor).toBe("candle");
  });
});
