import { describe, expect, it } from "vitest";
import {
  FRAME_HEIGHT,
  FRAME_WIDTH,
  hashSeed,
  pixelGuyFrame,
  pixelGuyLook,
  portraitSvg,
  POSE_FRAMES,
  Pose,
  shadeHex,
} from "../../src/pixelGuy";

const POSES = Object.keys(POSE_FRAMES) as Pose[];

describe("pixelGuyLook", () => {
  it("gives the same seed the same guy", () => {
    expect(pixelGuyLook("session-a")).toEqual(pixelGuyLook("session-a"));
  });

  it("varies across seeds", () => {
    const looks = new Set(Array.from({ length: 40 }, (_, index) => JSON.stringify(pixelGuyLook(`session-${index}`))));
    expect(looks.size).toBeGreaterThan(35);
  });

  it("hashes to an unsigned 32-bit number", () => {
    const hash = hashSeed("abc");
    expect(Number.isInteger(hash)).toBe(true);
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThan(2 ** 32);
  });
});

describe("pixelGuyFrame", () => {
  it("draws every pose and facing at the frame size with something in it", () => {
    for (let seed = 0; seed < 12; seed++) {
      const look = pixelGuyLook(`guy-${seed}`);
      for (const pose of POSES) {
        for (const facing of ["down", "up", "left", "right"] as const) {
          for (let frame = 0; frame < POSE_FRAMES[pose]; frame++) {
            const grid = pixelGuyFrame(look, pose, facing, frame);
            expect(grid).toHaveLength(FRAME_HEIGHT);
            grid.forEach((row) => expect(row).toHaveLength(FRAME_WIDTH));
            expect(grid.flat().filter((color) => color !== null).length).toBeGreaterThan(40);
          }
        }
      }
    }
  });

  it("mirrors the right-facing frame for left", () => {
    const look = pixelGuyLook("mirror");
    const right = pixelGuyFrame(look, "walk", "right", 1);
    const left = pixelGuyFrame(look, "walk", "left", 1);
    expect(left).toEqual(right.map((row) => [...row].reverse()));
  });

  it("wraps frame numbers past the pose's frame count", () => {
    const look = pixelGuyLook("wrap");
    expect(pixelGuyFrame(look, "walk", "down", 5)).toEqual(pixelGuyFrame(look, "walk", "down", 1));
    expect(pixelGuyFrame(look, "walk", "down", -1)).toEqual(pixelGuyFrame(look, "walk", "down", 3));
  });

  it("drops the head onto the arms to sleep, and breathes", () => {
    const look = pixelGuyLook("sleepy");
    const firstFilledRow = (pose: "sit" | "sleep", frame: number) =>
      pixelGuyFrame(look, pose, "up", frame).findIndex((row) => row.some((color) => color !== null));
    expect(firstFilledRow("sleep", 0)).toBeGreaterThan(firstFilledRow("sit", 0));
    expect(firstFilledRow("sleep", 1)).toBe(firstFilledRow("sleep", 0) + 1);
  });

  it("moves the legs while walking", () => {
    const look = pixelGuyLook("legs");
    expect(pixelGuyFrame(look, "walk", "down", 1)).not.toEqual(pixelGuyFrame(look, "walk", "down", 0));
  });
});

describe("portraitSvg", () => {
  it("is a 16x16 svg in the guy's shirt color", () => {
    const look = pixelGuyLook("portrait");
    const svg = portraitSvg(look, undefined, false);
    expect(svg).toMatch(/^<svg [^>]*width="16" height="16"/);
    expect(svg).toContain(look.shirt);
    expect(svg).not.toContain("<circle");
    expect(svg).not.toContain("opacity");
  });

  it("adds the badge, a pulse when asked, and dims", () => {
    const svg = portraitSvg(pixelGuyLook("badge"), { color: "#123456", pulse: true }, true);
    expect(svg).toContain('fill="#123456"');
    expect(svg).toContain("<animate");
    expect(svg).toContain('opacity="0.45"');
    expect(portraitSvg(pixelGuyLook("badge"), { color: "#123456", pulse: false }, false)).not.toContain("<animate");
  });
});

describe("shadeHex", () => {
  it("darkens, lightens, and clamps", () => {
    expect(shadeHex("#808080", 0.5)).toBe("#404040");
    expect(shadeHex("#F0F0F0", 2)).toBe("#FFFFFF");
    expect(shadeHex("not a color", 0.5)).toBe("not a color");
  });
});
