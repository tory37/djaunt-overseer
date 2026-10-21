import { JudgedRole, linkKey } from "./linkJudge";
import { LinkStatus, statusGlyph } from "./linkStatus";
import { isDimmedLink, linkDisplayId, linkUrl, MarkedLink } from "./linkView";
import { LinkMark } from "./registry";
import { statusGlyphMarkup } from "./statusIcons";

export interface ResourceRow {
  key: string;
  kind: MarkedLink["kind"];
  displayId: string;
  label: string | undefined;
  url: string | undefined;
  glyph: string;
  statusText: string | undefined;
  statusColor: string | undefined;
  role: JudgedRole;
  mark: LinkMark | undefined;
  isDimmed: boolean;
  isAgentDeclared: boolean;
  agentNote: string | undefined;
  depth: number;
}

const KIND_GLYPHS: Record<MarkedLink["kind"], string> = {
  pr: "git-pull-request",
  ticket: "ticket",
  artifact: "sparkles",
};

// A status color only exists once the live status has loaded; until then the row draws the plain kind glyph.
export function resourceRow(
  link: MarkedLink,
  status: LinkStatus | undefined,
  statusColor: string | undefined,
  jiraBaseUrl: string,
  depth = 0,
): ResourceRow {
  const hasStatus = status !== undefined && link.kind !== "artifact";
  const glyphName =
    status !== undefined && link.kind !== "artifact" ? statusGlyph(link.kind, status) : KIND_GLYPHS[link.kind];
  return {
    key: linkKey(link),
    kind: link.kind,
    displayId: linkDisplayId(link),
    label: link.label ?? status?.title,
    url: linkUrl(link, jiraBaseUrl),
    glyph: statusGlyphMarkup(glyphName),
    statusText: status?.text,
    statusColor: hasStatus ? statusColor : undefined,
    role: link.role,
    mark: link.mark,
    isDimmed: isDimmedLink(link),
    isAgentDeclared: link.isAgentDeclared === true,
    agentNote: link.agentNote,
    depth,
  };
}

// The webview sends back a full order; anything but the same set of keys is a stale drag and is ignored.
export function acceptedOrder(shownKeys: string[], requestedKeys: string[]): string[] | undefined {
  const shownKeySet = new Set(shownKeys);
  const requestedKeySet = new Set(requestedKeys);
  const isSameSet =
    requestedKeys.length === shownKeys.length &&
    requestedKeySet.size === shownKeySet.size &&
    requestedKeys.every((key) => shownKeySet.has(key));
  return isSameSet ? requestedKeys : undefined;
}
