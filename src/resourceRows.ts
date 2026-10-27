import { projectKeyOf } from "./jira";
import { linkKey } from "./linkCandidates";
import { LinkStatus, statusGlyph } from "./linkStatus";
import { linkDisplayId, linkUrl, MarkedLink } from "./linkView";
import { LinkMark } from "./registry";
import { StatusConfig } from "./statusConfig";
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
  mark: LinkMark | undefined;
  depth: number;
}

const KIND_GLYPHS: Record<MarkedLink["kind"], string> = {
  pr: "git-pull-request",
  ticket: "ticket",
  artifact: "sparkles",
  commit: "git-commit",
};

// A status color only exists once the live status has loaded; until then the row draws the plain kind glyph.
export function resourceRow(
  link: MarkedLink,
  status: LinkStatus | undefined,
  statusColor: string | undefined,
  jiraBaseUrl: string,
  depth = 0,
): ResourceRow {
  const hasStatus = status !== undefined && (link.kind === "pr" || link.kind === "ticket");
  const glyphName =
    status !== undefined && (link.kind === "pr" || link.kind === "ticket") ? statusGlyph(link.kind, status) : KIND_GLYPHS[link.kind];
  return {
    key: linkKey(link),
    kind: link.kind,
    displayId: linkDisplayId(link),
    label: link.title ?? status?.title,
    url: linkUrl(link, jiraBaseUrl),
    glyph: statusGlyphMarkup(glyphName),
    statusText: status?.text,
    statusColor: hasStatus ? statusColor : undefined,
    mark: link.mark,
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

export function linkStatusColor(statusConfig: StatusConfig, link: MarkedLink, status: LinkStatus | undefined): string | undefined {
  if (status === undefined) {
    return undefined;
  }
  return link.kind === "pr"
    ? statusConfig.prColor(status.colorKey)
    : statusConfig.jiraColor(projectKeyOf(link.id) ?? "", status.colorKey);
}
