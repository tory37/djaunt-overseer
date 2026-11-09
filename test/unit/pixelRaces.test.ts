import { describe, expect, it } from "vitest";
import { DEFAULT_YOUR_LOOK, FRAME_HEIGHT, FRAME_WIDTH, pixelGuyFrame, pixelGuyLook, POSE_FRAMES, Pose, portraitSvg, raceOfSeed, yourLook } from "../../src/pixelGuy";
import { pickedRace, RACE_IDS, RACES, raceSpec, seedWithoutRace, seedWithRace } from "../../src/pixelRaces";

const POSES = Object.keys(POSE_FRAMES) as Pose[];
const FACINGS = ["down", "up", "left", "right"] as const;

describe("races", () => {
  it("has a spec for every id, human first", () => {
    expect(RACES.map((race) => race.id)).toEqual([...RACE_IDS]);
    expect(RACES[0].id).toBe("human");
    expect(new Set(RACES.map((race) => race.label)).size).toBe(RACES.length);
  });

  it("picks every race about as often as any other, humans included", () => {
    const counts = new Map<string, number>();
    const total = RACE_IDS.length * 300;
    for (let index = 0; index < total; index++) {
      const race = raceOfSeed(`session-${index}`);
      counts.set(race, (counts.get(race) ?? 0) + 1);
    }
    expect(counts.size).toBe(RACE_IDS.length);
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(200);
      expect(count).toBeLessThan(400);
    }
  });

  it("keeps a seed's clothes whatever its race", () => {
    const human = pixelGuyLook("session-x", false);
    for (const race of RACE_IDS) {
      const look = pixelGuyLook(seedWithRace("session-x", race));
      expect(look.shirt).toBe(human.shirt);
      expect(look.pants).toBe(human.pants);
      expect(look.race ?? "human").toBe(race);
    }
  });

  it("makes everyone human with races off, unless a race was picked", () => {
    for (let index = 0; index < 50; index++) {
      expect(pixelGuyLook(`guy-${index}`, false).race).toBeUndefined();
    }
    expect(pixelGuyLook(seedWithRace("guy-1", "orc"), false).race).toBe("orc");
  });

  it("carries a picked race in the seed and swaps it", () => {
    const seed = seedWithRace(seedWithRace("abc", "elf"), "naga");
    expect(seed).toBe("abc#race=naga");
    expect(pickedRace(seed)).toBe("naga");
    expect(seedWithoutRace(seed)).toBe("abc");
    expect(pickedRace("abc#race=nope")).toBeUndefined();
    expect(pickedRace("abc")).toBeUndefined();
  });

  it("draws every race in every pose and facing at the frame size", () => {
    for (const race of RACE_IDS) {
      const look = pixelGuyLook(seedWithRace(`draw-${race}`, race));
      for (const pose of POSES) {
        for (const facing of FACINGS) {
          for (let frame = 0; frame < POSE_FRAMES[pose]; frame++) {
            const grid = pixelGuyFrame(look, pose, facing, frame);
            expect(grid).toHaveLength(FRAME_HEIGHT);
            grid.forEach((row) => expect(row).toHaveLength(FRAME_WIDTH));
            expect(grid.flat().filter((color) => color !== null).length).toBeGreaterThan(40);
          }
        }
      }
      expect(portraitSvg(look, undefined, false)).toMatch(/^<svg [^>]*width="16" height="16"/);
    }
  });

  it("draws what sets each race apart", () => {
    const front = (race: (typeof RACE_IDS)[number]) => {
      const look = pixelGuyLook(seedWithRace("marks", race));
      return { look, colors: pixelGuyFrame(look, "stand", "down", 0).flat() };
    };
    const orc = front("orc");
    expect(orc.colors).toContain(orc.look.marks?.[0]);
    const minotaur = front("minotaur");
    expect(minotaur.colors).toContain(minotaur.look.marks?.[0]);
    // A centaur and a naga have no shoes.
    expect(front("centaur").colors).not.toContain(front("centaur").look.shoes);
    expect(front("naga").colors).not.toContain(front("naga").look.shoes);
  });

  it("drops accessories the race can't wear", () => {
    const look = { ...pixelGuyLook(seedWithRace("hat", "minotaur")), accessory: "cap" as const, accessoryColor: "#123456" };
    expect(pixelGuyFrame(look, "stand", "down", 0).flat()).not.toContain("#123456");
    expect(raceSpec("minotaur").blocks).toContain("cap");
  });

  it("draws a visiting boss's tie from the front only", () => {
    const look = { ...pixelGuyLook("boss"), tie: "#C0392B" };
    expect(pixelGuyFrame(look, "stand", "down", 0).flat()).toContain("#C0392B");
    expect(pixelGuyFrame(look, "stand", "up", 0).flat()).not.toContain("#C0392B");
  });

  it("gives your guy a race from the setting, keeping the fields you set", () => {
    expect(yourLook({ race: "nope" })).toEqual(DEFAULT_YOUR_LOOK);
    const orc = yourLook({ race: "orc" });
    expect(orc.race).toBe("orc");
    expect(orc.skin).toBe(raceSpec("orc").skins?.[0]);
    expect(orc.hairStyle).toBe(raceSpec("orc").hairStyles?.[0]);
    expect(yourLook({ race: "orc", skin: "#112233" }).skin).toBe("#112233");
    expect(yourLook({ race: "elf" }).hairStyle).toBe("long");
  });
});
