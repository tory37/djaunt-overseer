// Writes the link icons in media/links. Glyphs are Lucide v1.52.0 (ISC, https://lucide.dev).
// Tree items can't tint file icons, so each icon is written once per theme with its color baked in.
// Icons for a live status are drawn at runtime by src/statusIcons.ts in the user's chosen color.
import { mkdirSync, writeFileSync } from "fs";

const GLYPHS = {
  "git-pull-request":
    '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" x2="6" y1="9" y2="21"/>',
  "git-pull-request-draft":
    '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M18 6V5"/><path d="M18 11v-1"/><line x1="6" x2="6" y1="9" y2="21"/>',
  "git-merge": '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
  "git-pull-request-closed":
    '<path d="m15.5 3.5 5 5"/><path d="m15.5 8.5 5-5"/><path d="M18 11.62V15"/><path d="M6 9v12"/><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/>',
  ticket:
    '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/>',
  "ticket-check":
    '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="m9 12 2 2 4-4"/>',
  sparkles:
    '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>',
};

const COLORS = {
  neutral: { dark: "#C5C5C5", light: "#424242" },
  cyan: { dark: "#7FD8F0", light: "#1A7F9C" },
  dim: { dark: "#6B6B6B", light: "#A0A0A0" },
};

const ICONS = {
  pr: ["git-pull-request", "neutral"],
  ticket: ["ticket", "neutral"],
  artifact: ["sparkles", "cyan"],
  "pr-dim": ["git-pull-request", "dim"],
  "ticket-dim": ["ticket", "dim"],
  "artifact-dim": ["sparkles", "dim"],
};

const outputDir = new URL("../media/links/", import.meta.url);
mkdirSync(outputDir, { recursive: true });
for (const [iconName, [glyphName, colorName]] of Object.entries(ICONS)) {
  for (const theme of ["dark", "light"]) {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" ` +
      `stroke="${COLORS[colorName][theme]}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">` +
      `${GLYPHS[glyphName]}</svg>\n`;
    writeFileSync(new URL(`${iconName}-${theme}.svg`, outputDir), svg);
  }
}
