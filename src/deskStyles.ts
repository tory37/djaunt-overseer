// Pure: the Office desk each race gets. The crew brings in a desk in the style of the guy it's for: crates nailed
// together for orcs, a candlelit black desk for vampires, a glowing console for aliens. Standard keeps the scene's own
// desk colors.

import type { RaceId } from "./pixelRaces";

export type DeskStyleId =
  | "standard" | "crate" | "workbench" | "living" | "gothic" | "saucer" | "tech" | "coral" | "stone" | "hoard" | "cozy" | "nest";

// What sits on or in the desk beyond its colors, drawn by the Office view.
export type DeskDecor =
  | "mug" | "planks" | "hammer" | "leaves" | "candle" | "glowStrip" | "led" | "shell" | "rune" | "coins" | "yarn" | "egg";

export interface DeskStyle {
  id: DeskStyleId;
  // Missing colors use the scene's desk colors.
  top?: string;
  front?: string;
  // Grain, trim, and plank lines.
  edge?: string;
  // The decor's main color: the candle flame, the strip's glow, the coins.
  accent?: string;
  decor: DeskDecor;
}

export const DESK_STYLES: Record<DeskStyleId, DeskStyle> = {
  standard: { id: "standard", decor: "mug" },
  crate: { id: "crate", top: "#A9814F", front: "#8A6439", edge: "#5E4122", accent: "#B8B8B8", decor: "planks" },
  workbench: { id: "workbench", top: "#7A5232", front: "#5A3A22", edge: "#3A2614", accent: "#9AA3AA", decor: "hammer" },
  living: { id: "living", top: "#8A6A3A", front: "#6B4E2A", edge: "#4A3418", accent: "#5FBF4A", decor: "leaves" },
  gothic: { id: "gothic", top: "#2A2230", front: "#1C1622", edge: "#5A2A3A", accent: "#FFB347", decor: "candle" },
  saucer: { id: "saucer", top: "#C9D1D9", front: "#9AA6B2", edge: "#6E7A86", accent: "#7CF2E0", decor: "glowStrip" },
  tech: { id: "tech", top: "#2A2E36", front: "#1C1F25", edge: "#3A404A", accent: "#4FE3F7", decor: "led" },
  coral: { id: "coral", top: "#F2D8C0", front: "#E09A8A", edge: "#C06A6A", accent: "#F28FB8", decor: "shell" },
  stone: { id: "stone", top: "#9A9488", front: "#7A746A", edge: "#5A564E", accent: "#7CF2E0", decor: "rune" },
  hoard: { id: "hoard", top: "#6A3A2A", front: "#4A2418", edge: "#2E140C", accent: "#F2C94C", decor: "coins" },
  cozy: { id: "cozy", top: "#C89A6A", front: "#A8784A", edge: "#7A5230", accent: "#E2504B", decor: "yarn" },
  nest: { id: "nest", top: "#A88A5A", front: "#8A6A3A", edge: "#5A4220", accent: "#E8E0D0", decor: "egg" },
};

export const DESK_STYLE_BY_RACE: Record<RaceId, DeskStyleId> = {
  human: "standard",
  orc: "crate",
  goblin: "crate",
  troll: "crate",
  ogre: "crate",
  dwarf: "workbench",
  gnome: "workbench",
  elf: "living",
  dryad: "living",
  fae: "living",
  satyr: "living",
  centaur: "living",
  mushroom: "living",
  wolffolk: "living",
  darkElf: "gothic",
  demon: "gothic",
  vampire: "gothic",
  skeleton: "gothic",
  zombie: "gothic",
  ghost: "gothic",
  greyAlien: "saucer",
  greenAlien: "saucer",
  squidfolk: "saucer",
  robot: "tech",
  undine: "coral",
  merfolk: "coral",
  naga: "coral",
  slime: "coral",
  golem: "stone",
  cyclops: "stone",
  minotaur: "stone",
  lizardfolk: "stone",
  jackalfolk: "stone",
  dragonkin: "hoard",
  catfolk: "cozy",
  harpy: "nest",
};

export function deskStyleFor(race: RaceId | undefined): DeskStyle {
  return DESK_STYLES[DESK_STYLE_BY_RACE[race ?? "human"] ?? "standard"];
}
