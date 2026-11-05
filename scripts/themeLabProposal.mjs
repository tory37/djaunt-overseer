// The Theme Lab's proposal layers. "Current" in the lab is exactly what scripts/themes.mjs ships.
// Each layer builds on the ones before it, in PROPOSAL_LAYERS order. Add or edit a layer, then run `npm run theme-lab`.
// Nothing here reaches themes/ until it moves into scripts/themes.mjs.
//
// A layer has up to three steps, each optional:
//   palette(variantName, basePalette) => basePalette   Edits a THEMES entry before the shipped generator runs.
//   colors(variantName, palette, colors) => colors     Overrides workbench color keys after the build.
//   tokens(variantName, palette, { tokenColors, semanticTokenColors }) => same shape

// Ordered. Each lab mode applies every layer up to and including its own.
// A layer that adds an overseer id the extension doesn't contribute shows up in the mock tagged "needs code".
export const PROPOSAL_LAYERS = [
  { id: "next", label: "Next" },
];
