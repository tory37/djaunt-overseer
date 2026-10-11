import * as fs from "fs";
import * as path from "path";

// Lucide v1.52.0 glyphs (ISC, https://lucide.dev), the same ones scripts/link-icons.mjs bakes into media/links.
const STATUS_GLYPHS: Record<string, string> = {
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
};

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function statusIconSvg(glyphName: string, color: string): string {
  const glyph = STATUS_GLYPHS[glyphName] ?? STATUS_GLYPHS.ticket;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" ` +
    `stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${glyph}</svg>\n`
  );
}

export function statusGlyphMarkup(glyphName: string): string {
  return STATUS_GLYPHS[glyphName] ?? STATUS_GLYPHS.ticket;
}

// Tree items take a theme color or a file, not a hex color, so each glyph and color pair is written to disk once.
export class StatusIconWriter {
  private readonly writtenFiles = new Set<string>();

  constructor(private readonly iconDir: string) {}

  iconFile(glyphName: string, color: string): string | undefined {
    if (!HEX_COLOR_PATTERN.test(color)) {
      return undefined;
    }
    const iconFile = path.join(this.iconDir, `${glyphName}-${color.slice(1).toLowerCase()}.svg`);
    if (!this.writtenFiles.has(iconFile)) {
      fs.mkdirSync(this.iconDir, { recursive: true });
      fs.writeFileSync(iconFile, statusIconSvg(glyphName, color));
      this.writtenFiles.add(iconFile);
    }
    return iconFile;
  }
}
