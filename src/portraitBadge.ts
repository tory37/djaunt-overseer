// Pure: the color of the state badge on a session row's portrait. The portrait is an SVG image, so it can't use a theme
// color id the way a codicon can. The badge takes the first hex color it finds: the user's per-theme customization, the
// user's plain customization, the active Overseer theme's own value, then VS Code's default for the color the id falls
// back to.

import { SessionIconState, sessionIconSpec } from "./sessionIcons";

export interface BadgeColorSources {
  // workbench.colorCustomizations.
  colorCustomizations: Record<string, unknown> | undefined;
  // workbench.colorTheme.
  themeName: string | undefined;
  // The active theme's colors, when it is one of ours.
  themeColors: Record<string, unknown> | undefined;
  isLightTheme: boolean;
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

// VS Code's built-in values for the colors contributes.colors points the session ids at.
const DEFAULT_BADGE_COLORS: Record<SessionIconState, { dark: string; light: string }> = {
  working: { dark: "#0DBC79", light: "#00BC00" },
  compacting: { dark: "#2472C8", light: "#0451A5" },
  running: { dark: "#0DBC79", light: "#00BC00" },
  elsewhere: { dark: "#E5E510", light: "#949800" },
  suspended: { dark: "#C5C5C5", light: "#424242" },
  duplicate: { dark: "#CCA700", light: "#BF8803" },
};

export function badgeColor(state: SessionIconState, sources: BadgeColorSources): string {
  const colorId = sessionIconSpec(state).colorId;
  const themeBlock = sources.themeName === undefined ? undefined : sources.colorCustomizations?.[`[${sources.themeName}]`];
  const candidates = [
    isRecord(themeBlock) ? themeBlock[colorId] : undefined,
    sources.colorCustomizations?.[colorId],
    sources.themeColors?.[colorId],
  ];
  const found = candidates.find((candidate): candidate is string => typeof candidate === "string" && HEX_COLOR.test(candidate));
  return found ?? DEFAULT_BADGE_COLORS[state][sources.isLightTheme ? "light" : "dark"];
}

// Working and compacting pulse; a suspended session's guy is dimmed.
export function badgeStyle(state: SessionIconState): { pulse: boolean; dimmed: boolean } {
  return { pulse: state === "working" || state === "compacting", dimmed: state === "suspended" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
