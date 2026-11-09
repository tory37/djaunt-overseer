import { describe, expect, it } from "vitest";
import {
  DAYTIME_SKY, discLit, earthIllumination, elevation, equationOfTime, lunarSunElevation, mix, moonPhase, sceneLight, skyAt, solarDeclination,
} from "../../src/officeDaylight";

describe("officeDaylight", () => {
  it("puts the sun high at a summer noon, lower in winter, and down at midnight", () => {
    const summer = skyAt(12, 172, 40, 0).sun.elevation;
    const winter = skyAt(12, 355, 40, 0).sun.elevation;
    expect(summer).toBeCloseTo(73.4, 0);
    expect(winter).toBeCloseTo(26.6, 0);
    expect(skyAt(0, 172, 40, 0).sun.elevation).toBeLessThan(-20);
  });

  it("rises around six and sets around six at the equinox", () => {
    expect(Math.abs(skyAt(6, 80, 40, 0).sun.elevation)).toBeLessThan(1.5);
    expect(Math.abs(skyAt(18, 80, 40, 0).sun.elevation)).toBeLessThan(1.5);
    expect(skyAt(9, 80, 40, 0).sun.hourAngle).toBeLessThan(0);
    expect(skyAt(15, 80, 40, 0).sun.hourAngle).toBeGreaterThan(0);
  });

  it("gives longer days in summer", () => {
    const daylightHours = (day: number) => Array.from({ length: 24 * 4 }, (_, step) => skyAt(step / 4, day, 40, 0).sun.elevation > 0).filter(Boolean).length / 4;
    expect(daylightHours(172)).toBeGreaterThan(14.5);
    expect(daylightHours(355)).toBeLessThan(9.5);
    expect(solarDeclination(172)).toBeGreaterThan(23);
  });

  it("knows the moon's real phase", () => {
    expect(moonPhase(Date.UTC(2000, 0, 6, 18, 14))).toBeCloseTo(0, 3);
    // Full moon, 2026-11-24 14:53 UTC.
    expect(moonPhase(Date.UTC(2026, 10, 24, 14, 53))).toBeCloseTo(0.5, 1);
    const full = skyAt(0, 330, 40, 0.5).moon;
    expect(full.illumination).toBeCloseTo(1, 5);
    expect(full.elevation).toBeGreaterThan(20);
    // A new moon rides with the sun.
    expect(skyAt(0, 330, 40, 0).moon.elevation).toBeLessThan(0);
  });

  it("tints outdoor scenes by the sun, the office a little, the server room and cave never", () => {
    const noon = skyAt(12, 172, 40, 0);
    const night = skyAt(0, 172, 40, 0);
    const dusk = skyAt(19.6, 172, 40, 0);
    expect(sceneLight("field", noon).darkness).toBe(0);
    expect(sceneLight("field", noon).ambient).toBe("#FFFFFF");
    expect(sceneLight("field", night).darkness).toBeCloseTo(0.8, 5);
    expect(sceneLight("field", night).stars).toBe(1);
    const duskLight = sceneLight("forest", dusk).darkness;
    expect(duskLight).toBeGreaterThan(0.1);
    expect(duskLight).toBeLessThan(0.8);
    expect(sceneLight("office", night).darkness).toBeLessThan(0.3);
    expect(sceneLight("serverRoom", night).darkness).toBe(0);
    expect(sceneLight("cave", night).darkness).toBe(0);
    expect(sceneLight("field", DAYTIME_SKY).darkness).toBe(0);
  });

  it("keeps the reef a little dim by day and deep blue at night, and the library mostly lamplit", () => {
    const noon = skyAt(12, 172, 40, 0.5);
    const midnight = skyAt(0, 172, 40, 0.5);
    expect(sceneLight("reef", noon).darkness).toBeGreaterThan(0.1);
    expect(sceneLight("reef", noon).stars).toBe(0);
    expect(sceneLight("reef", midnight).darkness).toBeGreaterThan(sceneLight("reef", noon).darkness + 0.4);
    expect(sceneLight("library", midnight).darkness).toBeLessThan(sceneLight("beach", midnight).darkness / 2);
    expect(sceneLight("snowfield", midnight).stars).toBeGreaterThan(0.5);
  });

  it("runs a month-long day on the moon, lit by the Earth at night", () => {
    expect(lunarSunElevation(0.5)).toBeCloseTo(90, 5);
    expect(lunarSunElevation(0)).toBeCloseTo(-90, 5);
    expect(earthIllumination(0)).toBe(1);
    expect(earthIllumination(0.5)).toBeCloseTo(0, 5);
    const at = (phase: number) => sceneLight("moon", skyAt(12, 172, 40, phase)).darkness;
    expect(at(0.5)).toBe(0);
    expect(at(0)).toBeGreaterThan(0.3);
    // Nights under a crescent Earth are darker than under a full one.
    expect(at(0.15)).toBeGreaterThan(at(0));
  });

  it("mixes colors and draws phases", () => {
    expect(mix("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    expect(mix("#112233", "#445566", 0)).toBe("#112233");
    expect(discLit(0.9, 0, 0.5, true)).toBe(true);
    expect(discLit(-0.9, 0, 0.5, true)).toBe(false);
    expect(discLit(-0.9, 0, 0.5, false)).toBe(true);
    expect(discLit(0, 0, 1, true)).toBe(true);
    expect(discLit(0, 0, 0, true)).toBe(false);
    expect(Math.abs(equationOfTime(310))).toBeGreaterThan(14);
    expect(elevation(90, 23.44, 0)).toBeCloseTo(23.44, 5);
  });
});
