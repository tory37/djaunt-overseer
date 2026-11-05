// The Theme Lab's proposal layers. "Current" in the lab is exactly what scripts/themes.mjs ships.
// Each layer builds on the ones before it, in PROPOSAL_LAYERS order. Add or edit a layer, then run `npm run theme-lab`.
// Nothing here reaches themes/ until it moves into scripts/themes.mjs.
//
// A layer has up to three steps, each optional:
//   palette(variantName, basePalette) => basePalette   Edits a THEMES entry before the shipped generator runs.
//   colors(variantName, palette, colors) => colors     Overrides workbench color keys after the build.
//   tokens(variantName, palette, { tokenColors, semanticTokenColors }) => same shape
import { mix } from "./themes.mjs";

const LIGHT_ACCENT_TEXT_DARKEN = 0.3;

// Lab-only ids the extension does not contribute yet, so the mock can preview them.
function labOnlyColors(variantName, palette, colors) {
  const isDark = palette.kind === "dark";
  const accentText = isDark ? palette.accent : mix(palette.accent, "#000000", LIGHT_ACCENT_TEXT_DARKEN);
  return {
    ...colors,
    "overseer.sessionBusy": accentText,
    "overseer.sessionIdle": palette.muted,
    "overseer.sessionNeedsInput": palette.yellow,
    "overseer.groupIcon1": palette.accent,
    "overseer.groupIcon2": palette.secondary,
    "overseer.groupIcon3": palette.tag,
  };
}

// Ordered. Each lab mode applies every layer up to and including its own.
export const PROPOSAL_LAYERS = [
  { id: "next", label: "Next", colors: labOnlyColors },
];
