import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";

// Base palettes. Their surfaces paint the frame (title bar, activity bar, sidebar, panel, terminal) and every
// floating layer (quick input, menus, notifications, widgets). The editor body and tab bar get a tinted surface
// ladder (canvasSurfaces). `roles` picks each theme's second accent and its syntax and bracket hues.
export const THEMES = {
  hoard: {
    label: "Overseer Hoard", kind: "dark",
    deep: "#0A0907", editor: "#0D0C0A", side: "#13110E", header: "#1A1712", raised: "#1C1913", border: "#2A251C",
    hover: "#1E1A14", select: "#2E2512", inactiveSelect: "#211D16",
    fg: "#EDE6D6", muted: "#8E887A", faint: "#6E6858",
    accent: "#D4A017", accentHi: "#F0C24B", onAccent: "#0D0C0A",
    red: "#E0624A", orange: "#E08A55", yellow: "#F0C24B", green: "#5FBF7A", blue: "#6FA8E8", purple: "#9F8AE6", cyan: "#7FD8F0", pink: "#E07AA8",
    kw: "#F0C24B", fn: "#8DB7EC", str: "#9CCB86", num: "#E89A6A", type: "#B4A2EE", cnst: "#7FD8F0", prop: "#C8C0AE", cmt: "#6E6858", punc: "#8E887A",
    roles: { secondary: "cyan", param: "pink", tag: "red", attr: "orange", brackets: ["pink", "green", "orange", "purple"] },
  },
  ember: {
    label: "Overseer Ember", kind: "dark",
    deep: "#0B0705", editor: "#100A07", side: "#170E0A", header: "#1F130D", raised: "#241610", border: "#352115",
    hover: "#21140E", select: "#3A1A0C", inactiveSelect: "#271810",
    fg: "#EDE6D6", muted: "#948677", faint: "#6F6255",
    accent: "#FF6B2C", accentHi: "#FF9560", onAccent: "#100A07",
    red: "#F0505A", orange: "#FF9560", yellow: "#F2C14E", green: "#54D7A7", blue: "#7F9BF0", purple: "#B48AE8", cyan: "#7FD8F0", pink: "#E07AC0",
    kw: "#FF9560", fn: "#8FA8F2", str: "#7FDDB5", num: "#F2C14E", type: "#D98BCF", cnst: "#7FD8F0", prop: "#C8BCAE", cmt: "#6F6255", punc: "#948677",
    roles: { secondary: "cyan", param: "pink", tag: "red", attr: "yellow", brackets: ["yellow", "green", "purple", "pink"] },
  },
  frost: {
    label: "Overseer Frost", kind: "dark",
    deep: "#04080F", editor: "#060B14", side: "#0A121E", header: "#101B2A", raised: "#111E2E", border: "#1B2C44",
    hover: "#0F1A29", select: "#16305A", inactiveSelect: "#122236",
    fg: "#E3E8F0", muted: "#8590A3", faint: "#5F6B80",
    accent: "#6BA4FF", accentHi: "#A6C8FF", onAccent: "#060B14",
    red: "#F06A6A", orange: "#F0B46B", yellow: "#EED27A", green: "#6BD6B5", blue: "#6BA4FF", purple: "#B58CE8", cyan: "#7FD8F0", pink: "#E88CC4",
    kw: "#B58CE8", fn: "#6BA4FF", str: "#6BD6B5", num: "#F0B46B", type: "#E8A6C8", cnst: "#7FD8F0", prop: "#B9C3D3", cmt: "#5F6B80", punc: "#8590A3",
    roles: { secondary: "purple", param: "yellow", tag: "pink", attr: "orange", brackets: ["cyan", "orange", "green", "pink"] },
  },
  parchment: {
    label: "Overseer Parchment", kind: "light",
    deep: "#E2D9C5", editor: "#F3EDDF", side: "#EBE4D3", header: "#E3DBC8", raised: "#F8F3E7", border: "#D3C8AF",
    hover: "#E4DCC9", select: "#E8D49C", inactiveSelect: "#E1D8C3",
    fg: "#26211A", muted: "#655D4F", faint: "#857B68",
    accent: "#86610F", accentHi: "#A87A12", onAccent: "#F8F3E7",
    red: "#B5352A", orange: "#9A5017", yellow: "#785700", green: "#24723F", blue: "#2C66A8", purple: "#674FB6", cyan: "#18687D", pink: "#AD3670",
    kw: "#8A5E00", fn: "#2C66A8", str: "#3A7429", num: "#9A5017", type: "#674FB6", cnst: "#18687D", prop: "#554D40", cmt: "#857B68", punc: "#655D4F",
    roles: { secondary: "blue", param: "pink", tag: "red", attr: "orange", brackets: ["purple", "green", "orange", "pink"] },
  },
};

const THEMES_DIR = "themes";
export const MIN_TEXT_CONTRAST = 4.5;
export const STATUS_KEYS = ["red", "orange", "yellow", "green", "blue", "purple", "cyan", "pink"];
export const CHECKED_SYNTAX_KEYS = ["kw", "fn", "str", "num", "type", "cnst", "prop", "punc"];
export const SURFACE_KEYS = ["deep", "editor", "side", "header", "raised", "hover", "select", "inactiveSelect"];
const LINK_STATUS_PALETTE_KEYS = {
  "overseer.prDraft": "muted",
  "overseer.prOpen": "green",
  "overseer.prReviewRequired": "yellow",
  "overseer.prApproved": "cyan",
  "overseer.prChangesRequested": "orange",
  "overseer.prMerged": "purple",
  "overseer.prClosed": "red",
  "overseer.ticketBlocked": "red",
  "overseer.ticketDone": "green",
  "overseer.ticketRemoved": "muted",
  "overseer.ticketReady": "cyan",
  "overseer.ticketReview": "purple",
  "overseer.ticketQa": "blue",
  "overseer.ticketProgress": "orange",
  "overseer.ticketTodo": "muted",
  "overseer.ticketOther": "purple",
};

export const hexToRgb = (hex) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
export const rgbToHex = (rgb) => "#" + rgb.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("").toUpperCase();
export const mix = (from, to, weightOfTo) => {
  const toRgb = hexToRgb(to);
  return rgbToHex(hexToRgb(from).map((channel, index) => channel + (toRgb[index] - channel) * weightOfTo));
};

export const relativeLuminance = (hex) => {
  const [red, green, blue] = hexToRgb(hex).map((channel) => {
    const linear = channel / 255;
    return linear <= 0.03928 ? linear / 12.92 : Math.pow((linear + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

export const contrastRatio = (foreground, background) => {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
};

const ansiPalette = (theme) => {
  const isDark = theme.kind === "dark";
  const brightTarget = isDark ? "#FFFFFF" : "#000000";
  const base = {
    Black: isDark ? mix(theme.border, theme.faint, 0.8) : theme.prop,
    Red: theme.red,
    Green: theme.green,
    Yellow: theme.yellow,
    Blue: theme.blue,
    Magenta: theme.purple,
    Cyan: theme.cyan,
    White: isDark ? theme.prop : theme.muted,
  };
  const bright = Object.fromEntries(Object.entries(base).map(([name, hex]) => [name, mix(hex, brightTarget, 0.28)]));
  bright.Black = theme.faint;
  bright.White = isDark ? "#FBF8F1" : theme.fg;
  return { base, bright };
};

export const withAlpha = (hex, alphaHex) => hex + alphaHex;

// ---------- Editor canvas: a surface ladder, tinted toward the accent. ----------

// Each canvas surface is this contrast ratio away from the one below it.
export const SURFACE_STEP = 1.09;
// How far the canvas surfaces lean toward the accent hue, at the same luminance.
export const SURFACE_CHROMA = 0.12;
const CANVAS_SURFACE_KEYS = ["deep", "editor", "side", "header", "raised", "border", "hover", "inactiveSelect"];

// Scales the RGB channels, so the hue stays. Falls back to a mix with white when scaling clips before the target.
function withLuminance(hex, targetLuminance) {
  const rgb = hexToRgb(hex);
  const scaled = (factor) => rgbToHex(rgb.map((channel) => Math.min(255, channel * factor)));
  const maxFactor = 255 / Math.max(1, ...rgb);
  const search = (candidate, high) => {
    let low = 0;
    for (let step = 0; step < 40; step++) {
      const middle = (low + high) / 2;
      if (relativeLuminance(candidate(middle)) < targetLuminance) low = middle;
      else high = middle;
    }
    return candidate(high);
  };
  if (relativeLuminance(scaled(maxFactor)) < targetLuminance) return search((weight) => mix(hex, "#FFFFFF", weight), 1);
  return search(scaled, maxFactor);
}

// direction +1 is lighter, -1 is darker.
const stepSurface = (hex, ratio, direction) => {
  const luminance = relativeLuminance(hex);
  const target = direction > 0 ? (luminance + 0.05) * ratio - 0.05 : (luminance + 0.05) / ratio - 0.05;
  return withLuminance(hex, Math.max(0, target));
};

const keepOffset = (oldBase, oldHex, newBase) => {
  const direction = relativeLuminance(oldHex) >= relativeLuminance(oldBase) ? 1 : -1;
  return stepSurface(newBase, contrastRatio(oldHex, oldBase), direction);
};

// Dark themes climb deep < editor < side < header < raised. Parchment runs raised lightest, then editor, side, header.
function surfaceLadder(theme) {
  const ladder = { deep: theme.deep, editor: theme.editor };
  if (theme.kind === "dark") {
    ladder.side = stepSurface(theme.editor, SURFACE_STEP, 1);
    ladder.header = stepSurface(ladder.side, SURFACE_STEP, 1);
    ladder.raised = stepSurface(ladder.header, SURFACE_STEP, 1);
  } else {
    ladder.raised = stepSurface(theme.editor, SURFACE_STEP, 1);
    ladder.side = stepSurface(theme.editor, SURFACE_STEP, -1);
    ladder.header = stepSurface(ladder.side, SURFACE_STEP, -1);
  }
  ladder.hover = keepOffset(theme.side, theme.hover, ladder.side);
  ladder.inactiveSelect = keepOffset(theme.side, theme.inactiveSelect, ladder.side);
  ladder.border = keepOffset(theme.raised, theme.border, ladder.raised);
  return ladder;
}

const tintSurface = (hex, accent) => withLuminance(mix(hex, accent, SURFACE_CHROMA), relativeLuminance(hex));

function canvasSurfaces(theme) {
  const ladder = surfaceLadder(theme);
  return Object.fromEntries(CANVAS_SURFACE_KEYS.map((key) => [key, tintSurface(ladder[key], theme.accent)]));
}

// The keys that paint the editor body and the tab bar. They read the canvas surfaces; everything else reads THEMES.
const CANVAS_COLOR_KEYS = [
  "editor.background", "editorGutter.background", "minimap.background", "breadcrumb.background",
  "editorGroupHeader.tabsBackground", "editorGroupHeader.noTabsBackground", "editorGroupHeader.connectedTabsBackground",
  "tab.inactiveBackground", "tab.unfocusedActiveBackground", "tab.unfocusedInactiveBackground", "tab.hoverBackground", "tab.border",
  "editorGroup.border", "editorIndentGuide.background1", "editorWhitespace.foreground", "editorRuler.foreground", "editorOverviewRuler.border",
];

// ---------- Hues: syntax tiers, saturation, and the second accent. ----------

const DARK_KEYWORD_BRIGHTEN = 0.12;
const LIGHT_KEYWORD_DARKEN = 0.3;
const LIGHT_LOUD_SYNTAX_DARKEN = 0.1;
const PROP_RECEDE = 0.25;
const PUNC_RECEDE = 0.2;
const SYNTAX_SATURATION = 1.3;
const STATUS_SATURATION = 1.15;
const VARIABLE_TINT = 0.22;
const PARAM_TINT = 0.5;
const SATURATED_SYNTAX_KEYS = ["kw", "fn", "str", "num", "type", "cnst"];
// Hue adjustments aim a little above the 4.5:1 check so rounding never drops under it.
const TEXT_FLOOR_CONTRAST = 4.6;

const hexToHsl = (hex) => {
  const [red, green, blue] = hexToRgb(hex).map((channel) => channel / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const hue = max === red ? (green - blue) / delta + (green < blue ? 6 : 0) : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
  return [hue / 6, saturation, lightness];
};

const hslToHex = ([hue, saturation, lightness]) => {
  if (saturation === 0) return rgbToHex([lightness, lightness, lightness].map((channel) => channel * 255));
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const channel = (offset) => {
    let t = hue + offset;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return rgbToHex([channel(1 / 3), channel(0), channel(-1 / 3)].map((value) => value * 255));
};

// Raises HSL saturation, then restores the luminance so contrast stays put.
const saturate = (hex, factor) => {
  const [hue, saturation, lightness] = hexToHsl(hex);
  return withLuminance(hslToHex([hue, Math.min(1, saturation * factor), lightness]), relativeLuminance(hex));
};

// Moves a text color toward white (dark) or black (light) until it clears the floor on `background`.
function ensureContrast(hex, background, isDark) {
  if (contrastRatio(hex, background) >= TEXT_FLOOR_CONTRAST) return hex;
  const target = isDark ? "#FFFFFF" : "#000000";
  let low = 0;
  let high = 1;
  for (let step = 0; step < 30; step++) {
    const middle = (low + high) / 2;
    if (contrastRatio(mix(hex, target, middle), background) >= TEXT_FLOOR_CONTRAST) high = middle;
    else low = middle;
  }
  return mix(hex, target, high);
}

// Moves a syntax color toward the editor as far as `maxWeight`, but never under the floor.
function recede(hex, editor, maxWeight) {
  if (contrastRatio(mix(hex, editor, maxWeight), editor) >= TEXT_FLOOR_CONTRAST) return mix(hex, editor, maxWeight);
  let low = 0;
  let high = maxWeight;
  for (let step = 0; step < 30; step++) {
    const middle = (low + high) / 2;
    if (contrastRatio(mix(hex, editor, middle), editor) >= TEXT_FLOOR_CONTRAST) low = middle;
    else high = middle;
  }
  return mix(hex, editor, low);
}

// Keywords lead, properties and punctuation recede. Parchment spreads its syntax lightness wider.
function syntaxTiers(theme) {
  const tiers = {
    prop: recede(theme.prop, theme.editor, PROP_RECEDE),
    punc: recede(theme.punc, theme.editor, PUNC_RECEDE),
  };
  if (theme.kind === "dark") {
    tiers.kw = mix(theme.kw, "#FFFFFF", DARK_KEYWORD_BRIGHTEN);
  } else {
    tiers.kw = mix(theme.kw, "#000000", LIGHT_KEYWORD_DARKEN);
    for (const key of ["fn", "type", "str", "num"]) tiers[key] = mix(theme[key], "#000000", LIGHT_LOUD_SYNTAX_DARKEN);
  }
  return tiers;
}

// The palette the theme files are built from: THEMES surfaces, the canvas, saturated hues, and the role hues.
export function shippedPalette(theme) {
  const isDark = theme.kind === "dark";
  const canvas = canvasSurfaces(theme);
  const tiered = { ...theme, ...syntaxTiers(theme) };
  const readable = (hex) => ensureContrast(ensureContrast(hex, canvas.editor, isDark), canvas.side, isDark);
  const palette = { ...tiered, canvas };
  for (const key of STATUS_KEYS) palette[key] = readable(saturate(theme[key], STATUS_SATURATION));
  for (const key of SATURATED_SYNTAX_KEYS) palette[key] = readable(saturate(tiered[key], SYNTAX_SATURATION));
  const { roles } = theme;
  palette.secondary = palette[roles.secondary];
  palette.variable = readable(mix(theme.fg, palette.secondary, VARIABLE_TINT));
  palette.param = readable(mix(theme.fg, palette[roles.param], PARAM_TINT));
  palette.tag = palette[roles.tag];
  palette.attr = palette[roles.attr];
  palette.bracketHues = [isDark ? theme.accentHi : readable(theme.accent), palette.secondary, ...roles.brackets.map((key) => palette[key])];
  return palette;
}

const LIST_SELECT_ACCENT_WEIGHT = 0.48;
const LIST_INACTIVE_SELECT_ACCENT_WEIGHT = 0.34;
export const listSelectColors = (theme) => ({
  active: mix(theme.side, theme.accent, LIST_SELECT_ACCENT_WEIGHT),
  inactive: mix(theme.side, theme.accent, LIST_INACTIVE_SELECT_ACCENT_WEIGHT),
});

const RAIL_ALPHA = "8C";
const WIDGET_EDGE_ALPHA = "73";
const TRANSPARENT = "#00000000";

function edgeColors(theme) {
  const rail = withAlpha(theme.accent, RAIL_ALPHA);
  const widgetEdge = withAlpha(theme.accent, WIDGET_EDGE_ALPHA);
  return {
    "titleBar.border": rail,
    "statusBar.border": rail,
    "statusBar.noFolderBorder": rail,
    "statusBar.debuggingBorder": theme.orange,

    focusBorder: theme.accent,
    "list.focusOutline": theme.accent,
    "list.focusAndSelectionOutline": theme.accent,
    "sash.hoverBorder": theme.accent,
    "editorGroup.focusedEmptyBorder": rail,
    "tab.activeBorderTop": theme.accent,
    "tab.activeBorder": TRANSPARENT,
    "tab.unfocusedActiveBorderTop": TRANSPARENT,
    "tab.unfocusedActiveBackground": theme.header,

    "widget.border": widgetEdge,
    "widget.shadow": TRANSPARENT,
    "editorWidget.border": widgetEdge,
    "editorHoverWidget.border": widgetEdge,
    "editorSuggestWidget.border": widgetEdge,
    "menu.border": widgetEdge,
    "notifications.border": widgetEdge,
    "notificationToast.border": widgetEdge,
    "notificationCenter.border": widgetEdge,
    "peekView.border": widgetEdge,

    "activityBar.border": theme.border,
    "sideBar.border": theme.border,
    "sideBarSectionHeader.border": theme.border,
    "editorGroupHeader.tabsBorder": theme.border,
    "tab.border": theme.border,
    "editorGroup.border": theme.border,
    "terminal.border": theme.border,
    "panel.border": theme.border,
  };
}

const MODERN_ACTIVE_TINT_ALPHA = "2E";
const MODERN_TAB_ACTION_ALPHA = "33";
const MODERN_SASH_GRIP_ALPHA = "99";

// Parchment's accent is 4.0:1 on deep, so the light variant darkens it to pass on the tinted pill.
const LIGHT_ACTIVE_FOREGROUND_DARKEN = 0.3;
const modernActiveForeground = (theme) =>
  theme.kind === "dark" ? theme.accentHi : mix(theme.accent, "#000000", LIGHT_ACTIVE_FOREGROUND_DARKEN);

// VS Code 1.143+ modern UI (workbench.experimental.modernUI) ignores the classic
// tab, status bar, and title bar borders above and reads these ids instead.
function modernLayoutColors(theme) {
  const activeTint = withAlpha(theme.accent, MODERN_ACTIVE_TINT_ALPHA);
  const tabAction = withAlpha(theme.accent, MODERN_TAB_ACTION_ALPHA);
  const activeForeground = modernActiveForeground(theme);
  // Modern UI drops the window, title bar, and status bar borders, so the gold frame moves onto the cards.
  const cardFrame = withAlpha(theme.accent, WIDGET_EDGE_ALPHA);
  return {
    "modernUI.shellBackground": theme.deep,
    "modernUI.inactiveShellBackground": theme.deep,
    "surface.border": cardFrame,
    "editor.border": cardFrame,
    "modernPanel.border": cardFrame,
    "editorGroupHeader.connectedTabsBackground": theme.header,
    "editorGroupHeader.tabsBorder": cardFrame,
    "window.activeBorder": withAlpha(theme.accent, RAIL_ALPHA),
    "window.inactiveBorder": theme.border,

    "modernActivityBar.background": theme.deep,
    "modernActivityBar.inactiveBackground": theme.deep,
    "modernActivityBar.border": theme.border,
    "modernActivityBar.activeBackground": activeTint,
    "modernActivityBar.activeForeground": activeForeground,
    "modernActivityBar.hoverBackground": theme.hover,
    "modernActivityBar.hoverForeground": theme.fg,
    "modernActivityBarItem.activeBackground": activeTint,
    "modernActivityBarItem.activeForeground": activeForeground,
    "modernActivityBarItem.hoverBackground": theme.hover,
    "modernActivityBarItem.hoverForeground": theme.fg,

    "modernEditorTab.activeBackground": theme.select,
    "modernEditorTab.activeForeground": theme.fg,
    "modernEditorTab.activeHoverBackground": theme.select,
    "modernEditorTab.inactiveBackground": TRANSPARENT,
    "modernEditorTab.hoverBackground": theme.hover,
    "modernEditorTab.hoverForeground": theme.fg,
    "modernEditorTab.activeActionBackground": tabAction,
    "modernEditorTab.activeHoverActionBackground": tabAction,
    "modernEditorTab.hoverActionBackground": theme.raised,
    "modernEditorTab.selectedActionBackground": tabAction,

    "modernTab.activeBackground": theme.raised,
    "modernTab.activeForeground": theme.fg,
    "modernTab.hoverBackground": theme.hover,
    "modernTab.hoverForeground": theme.fg,

    "modernSash.gripForeground": withAlpha(theme.accent, MODERN_SASH_GRIP_ALPHA),
  };
}

function modernLayoutTextChecks(theme) {
  const activeForeground = modernActiveForeground(theme);
  const tintedDeep = mix(theme.deep, theme.accent, parseInt(MODERN_ACTIVE_TINT_ALPHA, 16) / 255);
  return [
    { what: "modern editor tab active fg on select", foreground: theme.fg, background: theme.select },
    { what: "modern editor tab hover fg on hover", foreground: theme.fg, background: theme.hover },
    { what: "modern tab active fg on raised", foreground: theme.fg, background: theme.raised },
    { what: "modern activity active fg on deep", foreground: activeForeground, background: theme.deep },
    { what: "modern activity active fg on tinted deep", foreground: activeForeground, background: tintedDeep },
    { what: "modern activity hover fg on hover", foreground: theme.fg, background: theme.hover },
  ];
}

export const linkStatusColors = (theme) =>
  Object.fromEntries(Object.entries(LINK_STATUS_PALETTE_KEYS).map(([colorId, paletteKey]) => [colorId, theme[paletteKey]]));

export function workbenchColors(theme) {
  const isDark = theme.kind === "dark";
  const ansi = ansiPalette(theme);
  const listSelect = listSelectColors(theme);
  const terminalColors = {};
  for (const [name, hex] of Object.entries(ansi.base)) terminalColors[`terminal.ansi${name}`] = hex;
  for (const [name, hex] of Object.entries(ansi.bright)) terminalColors[`terminal.ansiBright${name}`] = hex;

  return {
    foreground: theme.fg,
    descriptionForeground: theme.muted,
    disabledForeground: theme.faint,
    errorForeground: theme.red,
    contrastBorder: "#00000000",
    "icon.foreground": theme.muted,
    "selection.background": withAlpha(theme.accent, "55"),
    "textLink.foreground": isDark ? theme.accentHi : theme.accent,
    "textLink.activeForeground": isDark ? theme.accentHi : theme.accent,
    "textPreformat.foreground": theme.accentHi,
    "textBlockQuote.background": theme.raised,
    "textBlockQuote.border": theme.border,
    "textCodeBlock.background": theme.raised,
    "textSeparator.foreground": theme.border,
    "progressBar.background": theme.accent,
    "scrollbar.shadow": "#00000000",
    "scrollbarSlider.background": withAlpha(theme.faint, "33"),
    "scrollbarSlider.hoverBackground": withAlpha(theme.faint, "55"),
    "scrollbarSlider.activeBackground": withAlpha(theme.faint, "77"),

    "titleBar.activeBackground": theme.deep,
    "titleBar.activeForeground": theme.fg,
    "titleBar.inactiveBackground": theme.deep,
    "titleBar.inactiveForeground": theme.muted,

    "activityBar.background": theme.deep,
    "activityBar.foreground": theme.fg,
    "activityBar.inactiveForeground": theme.faint,
    "activityBar.activeBorder": theme.accent,
    "activityBar.activeBackground": theme.deep,
    "activityBarBadge.background": theme.accent,
    "activityBarBadge.foreground": theme.onAccent,
    "activityBarTop.foreground": theme.fg,
    "activityBarTop.inactiveForeground": theme.faint,
    "activityBarTop.activeBorder": theme.accent,

    "sideBar.background": theme.side,
    "sideBar.foreground": theme.fg,
    "sideBarTitle.foreground": theme.muted,
    "sideBarSectionHeader.background": theme.header,
    "sideBarSectionHeader.foreground": theme.fg,

    "list.hoverBackground": theme.hover,
    "list.hoverForeground": theme.fg,
    "list.activeSelectionBackground": listSelect.active,
    "list.activeSelectionForeground": theme.fg,
    "list.inactiveSelectionBackground": listSelect.inactive,
    "list.inactiveSelectionForeground": theme.fg,
    "list.focusBackground": listSelect.active,
    "list.inactiveFocusOutline": theme.border,
    "list.highlightForeground": isDark ? theme.accentHi : theme.accent,
    "list.focusHighlightForeground": isDark ? theme.accentHi : theme.accent,
    "list.dropBackground": withAlpha(theme.accent, "22"),
    "list.errorForeground": theme.red,
    "list.warningForeground": theme.yellow,
    "tree.indentGuidesStroke": theme.border,
    "tree.inactiveIndentGuidesStroke": theme.border,

    "editor.background": theme.editor,
    "editor.foreground": theme.fg,
    "editorLineNumber.foreground": theme.faint,
    "editorLineNumber.activeForeground": theme.fg,
    "editorCursor.foreground": theme.accent,
    "editor.selectionBackground": withAlpha(theme.accent, "33"),
    "editor.inactiveSelectionBackground": withAlpha(theme.accent, "1F"),
    "editor.selectionHighlightBackground": withAlpha(theme.accent, "1A"),
    "editor.wordHighlightBackground": withAlpha(theme.accent, "1A"),
    "editor.wordHighlightStrongBackground": withAlpha(theme.accent, "29"),
    "editor.findMatchBackground": withAlpha(theme.accent, "55"),
    "editor.findMatchHighlightBackground": withAlpha(theme.accent, "29"),
    "editor.findMatchBorder": theme.accent,
    "editor.lineHighlightBackground": withAlpha(theme.fg, isDark ? "08" : "0A"),
    "editor.lineHighlightBorder": "#00000000",
    "editor.rangeHighlightBackground": withAlpha(theme.accent, "14"),
    "editorBracketMatch.background": withAlpha(theme.accent, "22"),
    "editorBracketMatch.border": withAlpha(theme.accent, "66"),
    "editorIndentGuide.background1": theme.border,
    "editorIndentGuide.activeBackground1": theme.faint,
    "editorWhitespace.foreground": theme.border,
    "editorRuler.foreground": theme.border,
    "editorLink.activeForeground": isDark ? theme.accentHi : theme.accent,
    "editorError.foreground": theme.red,
    "editorWarning.foreground": theme.yellow,
    "editorInfo.foreground": theme.blue,
    "editorHint.foreground": theme.muted,
    "editorGutter.background": theme.editor,
    "editorGutter.modifiedBackground": theme.yellow,
    "editorGutter.addedBackground": theme.green,
    "editorGutter.deletedBackground": theme.red,
    "editorOverviewRuler.border": theme.border,
    "editorOverviewRuler.errorForeground": theme.red,
    "editorOverviewRuler.warningForeground": theme.yellow,
    "editorOverviewRuler.infoForeground": theme.blue,
    "editorOverviewRuler.modifiedForeground": theme.yellow,
    "editorOverviewRuler.addedForeground": theme.green,
    "editorOverviewRuler.deletedForeground": theme.red,
    "editorGroupHeader.tabsBackground": theme.header,
    "editorGroupHeader.noTabsBackground": theme.editor,

    "tab.activeBackground": theme.editor,
    "tab.activeForeground": theme.fg,
    "tab.inactiveBackground": theme.header,
    "tab.inactiveForeground": theme.muted,
    "tab.unfocusedActiveForeground": theme.muted,
    "tab.unfocusedInactiveBackground": theme.header,
    "tab.unfocusedInactiveForeground": theme.faint,
    "tab.hoverBackground": theme.hover,

    "breadcrumb.background": theme.editor,
    "breadcrumb.foreground": theme.muted,
    "breadcrumb.focusForeground": theme.fg,
    "breadcrumb.activeSelectionForeground": theme.fg,
    "breadcrumbPicker.background": theme.raised,

    "editorWidget.background": theme.raised,
    "editorWidget.foreground": theme.fg,
    "editorSuggestWidget.background": theme.raised,
    "editorSuggestWidget.foreground": theme.fg,
    "editorSuggestWidget.selectedBackground": theme.select,
    "editorSuggestWidget.highlightForeground": isDark ? theme.accentHi : theme.accent,
    "editorHoverWidget.background": theme.raised,
    "peekViewEditor.background": theme.editor,
    "peekViewResult.background": theme.side,
    "peekViewTitle.background": theme.header,

    "input.background": theme.raised,
    "input.foreground": theme.fg,
    "input.border": theme.border,
    "input.placeholderForeground": theme.faint,
    "inputOption.activeBorder": theme.accent,
    "inputOption.activeBackground": withAlpha(theme.accent, "33"),
    "inputValidation.errorBorder": theme.red,
    "inputValidation.warningBorder": theme.yellow,
    "inputValidation.infoBorder": theme.blue,
    "dropdown.background": theme.raised,
    "dropdown.foreground": theme.fg,
    "dropdown.border": theme.border,
    "dropdown.listBackground": theme.raised,
    "checkbox.background": theme.raised,
    "checkbox.border": theme.border,

    "menu.background": theme.raised,
    "menu.foreground": theme.fg,
    "menu.selectionBackground": theme.select,
    "menu.selectionForeground": theme.fg,
    "menu.separatorBackground": theme.border,
    "menubar.selectionBackground": theme.hover,

    "notifications.background": theme.raised,
    "notifications.foreground": theme.fg,
    "notificationCenterHeader.background": theme.header,
    "notificationsErrorIcon.foreground": theme.red,
    "notificationsWarningIcon.foreground": theme.yellow,
    "notificationsInfoIcon.foreground": theme.blue,

    "quickInput.background": theme.raised,
    "quickInput.foreground": theme.fg,
    "quickInputTitle.background": theme.header,
    "quickInputList.focusBackground": theme.select,
    "pickerGroup.border": theme.border,
    "pickerGroup.foreground": isDark ? theme.accentHi : theme.accent,

    "badge.background": theme.accent,
    "badge.foreground": theme.onAccent,
    "button.background": theme.accent,
    "button.foreground": theme.onAccent,
    "button.hoverBackground": isDark ? theme.accentHi : mix(theme.accent, "#000000", 0.15),
    "button.secondaryBackground": theme.raised,
    "button.secondaryForeground": theme.fg,
    "button.secondaryHoverBackground": theme.hover,
    "button.border": "#00000000",

    "panel.background": theme.deep,
    "panelTitle.activeForeground": theme.fg,
    "panelTitle.inactiveForeground": theme.muted,
    "panelTitle.activeBorder": theme.accent,
    "panelSection.border": theme.border,
    "panelSectionHeader.background": theme.header,

    "statusBar.background": theme.deep,
    "statusBar.foreground": theme.muted,
    "statusBar.debuggingBackground": theme.deep,
    "statusBar.debuggingForeground": theme.orange,
    "statusBar.noFolderBackground": theme.deep,
    "statusBar.noFolderForeground": theme.muted,
    "statusBarItem.hoverBackground": theme.hover,
    "statusBarItem.remoteBackground": theme.accent,
    "statusBarItem.remoteForeground": theme.onAccent,
    "statusBarItem.errorForeground": theme.red,
    "statusBarItem.warningForeground": theme.yellow,

    "terminal.background": theme.editor,
    "terminal.foreground": theme.fg,
    "terminal.selectionBackground": withAlpha(theme.accent, "44"),
    "terminal.inactiveSelectionBackground": withAlpha(theme.accent, "22"),
    "terminalCursor.foreground": theme.accent,
    ...terminalColors,

    "charts.foreground": theme.fg,
    "charts.lines": theme.border,
    "charts.red": theme.red,
    "charts.orange": theme.orange,
    "charts.yellow": theme.yellow,
    "charts.green": theme.green,
    "charts.blue": theme.blue,
    "charts.purple": theme.purple,

    "gitDecoration.modifiedResourceForeground": theme.yellow,
    "gitDecoration.stageModifiedResourceForeground": theme.yellow,
    "gitDecoration.addedResourceForeground": theme.green,
    "gitDecoration.untrackedResourceForeground": theme.green,
    "gitDecoration.deletedResourceForeground": theme.red,
    "gitDecoration.stageDeletedResourceForeground": theme.red,
    "gitDecoration.renamedResourceForeground": theme.blue,
    "gitDecoration.ignoredResourceForeground": theme.faint,
    "gitDecoration.conflictingResourceForeground": theme.orange,
    "gitDecoration.submoduleResourceForeground": theme.cyan,

    "diffEditor.insertedTextBackground": withAlpha(theme.green, "22"),
    "diffEditor.removedTextBackground": withAlpha(theme.red, "22"),
    "diffEditor.insertedLineBackground": withAlpha(theme.green, "14"),
    "diffEditor.removedLineBackground": withAlpha(theme.red, "14"),

    "minimap.background": theme.editor,
    "minimapGutter.modifiedBackground": theme.yellow,
    "minimapGutter.addedBackground": theme.green,
    "minimapGutter.deletedBackground": theme.red,

    "overseer.sessionWorking": theme.green,
    "overseer.sessionRunning": theme.green,
    "overseer.sessionCompacting": theme.cyan,
    "overseer.sessionElsewhere": theme.yellow,
    "overseer.sessionSuspended": theme.muted,
    "overseer.sessionDuplicate": theme.orange,
    "overseer.statusGray": theme.muted,
    "overseer.statusRed": theme.red,
    "overseer.statusOrange": theme.orange,
    "overseer.statusYellow": theme.yellow,
    "overseer.statusGreen": theme.green,
    "overseer.statusTeal": theme.cyan,
    "overseer.statusBlue": theme.blue,
    "overseer.statusPurple": theme.purple,
    "overseer.statusPink": theme.pink,
    ...linkStatusColors(theme),
    ...edgeColors(theme),
    ...modernLayoutColors(theme),
  };
}

// ---------- Accent tiers: WHISPER (a faint accent alpha), VOICE (accent mixed into a surface), SHOUT (solid accent). ----------

const WHISPER_ALPHA = "1A";
const WHISPER_STRONG_ALPHA = "26";
const VOICE_SOFT = 0.34;
const SCROLLBAR_HOVER_ALPHA = "55";
const SCROLLBAR_ACTIVE_ALPHA = "88";
const LIGHT_ACCENT_TEXT_DARKEN = 0.3;
const LIGHT_HOVER_DARKEN = 0.15;
const STATUS_BAR_WHISPER = 0.08;
const SECONDARY_VOICE = 0.4;
const ACTIVITY_INACTIVE_TINT = 0.35;

function accentTierColors(theme) {
  const isDark = theme.kind === "dark";
  const accentText = isDark ? theme.accentHi : mix(theme.accent, "#000000", LIGHT_ACCENT_TEXT_DARKEN);
  return {
    "activityBar.activeBackground": withAlpha(theme.accent, WHISPER_ALPHA),
    "list.dropBackground": withAlpha(theme.accent, WHISPER_STRONG_ALPHA),
    "tab.activeBackground": mix(theme.canvas.editor, theme.accent, VOICE_SOFT),
    "sideBarSectionHeader.foreground": accentText,
    "scrollbarSlider.hoverBackground": withAlpha(theme.accent, SCROLLBAR_HOVER_ALPHA),
    "scrollbarSlider.activeBackground": withAlpha(theme.accent, SCROLLBAR_ACTIVE_ALPHA),
    // The prominent item is the status bar's one SHOUT.
    "statusBarItem.prominentBackground": theme.accent,
    "statusBarItem.prominentForeground": theme.onAccent,
    "statusBarItem.prominentHoverBackground": isDark ? theme.accentHi : mix(theme.accent, "#000000", LIGHT_HOVER_DARKEN),
  };
}

// 60/30/10: the accent keeps the big roles, the second accent takes supporting roles, details get small hits of color.
function detailColors(theme) {
  const isDark = theme.kind === "dark";
  const { secondary, bracketHues } = theme;
  const secondaryEdge = withAlpha(secondary, WIDGET_EDGE_ALPHA);
  const bracketColors = {};
  bracketHues.forEach((hex, index) => {
    bracketColors[`editorBracketHighlight.foreground${index + 1}`] = hex;
    bracketColors[`editorBracketPairGuide.background${index + 1}`] = withAlpha(hex, "40");
    bracketColors[`editorBracketPairGuide.activeBackground${index + 1}`] = withAlpha(hex, "B3");
  });
  const statusBarBackground = mix(theme.canvas.deep, theme.accent, STATUS_BAR_WHISPER);
  const inactiveIcon = mix(theme.faint, secondary, ACTIVITY_INACTIVE_TINT);
  return {
    "textLink.foreground": secondary,
    "textLink.activeForeground": secondary,
    "editorLink.activeForeground": secondary,
    "badge.background": secondary,
    "badge.foreground": isDark ? theme.deep : theme.raised,
    "notificationsInfoIcon.foreground": secondary,
    "editorInfo.foreground": secondary,
    "activityBar.inactiveForeground": inactiveIcon,
    "activityBarTop.inactiveForeground": inactiveIcon,
    "list.inactiveFocusOutline": secondaryEdge,
    "inputOption.activeBorder": secondary,
    "inputOption.activeBackground": withAlpha(secondary, "33"),
    "inputOption.activeForeground": theme.fg,

    ...bracketColors,
    "editorBracketHighlight.unexpectedBracket.foreground": theme.red,
    "editorIndentGuide.activeBackground1": theme.accent,
    "editorGutter.addedBackground": theme.green,
    "editorGutter.modifiedBackground": secondary,
    "editorGutter.deletedBackground": theme.red,
    "gitDecoration.renamedResourceForeground": secondary,
    "editorOverviewRuler.findMatchForeground": withAlpha(theme.accent, "99"),
    "editorOverviewRuler.selectionHighlightForeground": withAlpha(secondary, "99"),
    "editorOverviewRuler.bracketMatchForeground": withAlpha(theme.accent, "80"),
    "editorOverviewRuler.modifiedForeground": secondary,
    "editorOverviewRuler.infoForeground": secondary,
    "minimap.findMatchHighlight": withAlpha(theme.accent, "AA"),
    "minimap.selectionHighlight": withAlpha(secondary, "88"),
    "minimap.errorHighlight": withAlpha(theme.red, "CC"),
    "minimap.warningHighlight": withAlpha(theme.yellow, "CC"),
    "minimapGutter.modifiedBackground": secondary,
    "minimapSlider.background": withAlpha(theme.faint, "33"),
    "minimapSlider.hoverBackground": withAlpha(theme.accent, "44"),

    "statusBar.background": statusBarBackground,
    "statusBar.foreground": ensureContrast(theme.muted, statusBarBackground, isDark),
    "statusBar.noFolderBackground": statusBarBackground,
    "statusBar.debuggingBackground": statusBarBackground,
    "statusBarItem.remoteBackground": mix(theme.canvas.deep, secondary, SECONDARY_VOICE),
    "statusBarItem.remoteForeground": theme.fg,

    "tab.activeModifiedBorder": theme.accent,
    "tab.inactiveModifiedBorder": withAlpha(theme.accent, "99"),
    "tab.unfocusedActiveModifiedBorder": withAlpha(theme.accent, "99"),
    "tab.unfocusedInactiveModifiedBorder": withAlpha(theme.accent, "55"),
  };
}

const pickColors = (colors, keys) => Object.fromEntries(keys.filter((key) => key in colors).map((key) => [key, colors[key]]));

// The frame and floating layers read the THEMES surfaces; the editor body and tab bar read the canvas.
export function shippedColors(theme) {
  return {
    ...workbenchColors(theme),
    ...pickColors(workbenchColors({ ...theme, ...theme.canvas }), CANVAS_COLOR_KEYS),
    ...accentTierColors(theme),
    ...detailColors(theme),
  };
}

export function tokenColors(theme) {
  const rule = (name, scope, foreground, fontStyle) => ({ name, scope, settings: fontStyle ? { foreground, fontStyle } : { foreground } });
  return [
    rule("Comment", ["comment", "punctuation.definition.comment", "string.comment"], theme.cmt, "italic"),
    rule("Variable", ["variable", "variable.other", "variable.parameter", "meta.definition.variable"], theme.variable),
    rule("Keyword", ["keyword", "keyword.control", "storage", "storage.type", "storage.modifier", "keyword.operator.new", "keyword.operator.expression", "keyword.operator.logical.python", "variable.language.this", "variable.language.self", "variable.language.super"], theme.kw, "bold"),
    rule("Operator", ["keyword.operator"], theme.punc),
    rule("Function", ["entity.name.function", "support.function", "meta.function-call.generic", "variable.function", "meta.function-call entity.name.function"], theme.fn),
    rule("String", ["string", "string.quoted", "string.template", "punctuation.definition.string", "markup.inline.raw"], theme.str),
    rule("Number", ["constant.numeric"], theme.num),
    rule("Type", ["entity.name.type", "entity.name.class", "entity.other.inherited-class", "support.type", "support.class", "entity.name.namespace", "storage.type.annotation"], theme.type),
    rule("Constant", ["constant", "constant.language", "constant.character", "constant.character.escape", "variable.other.constant", "variable.other.enummember", "support.constant"], theme.cnst),
    rule("Property", ["variable.other.property", "variable.other.object.property", "meta.object-literal.key", "support.type.property-name", "support.type.property-name.json", "entity.other.attribute-name", "meta.attribute"], theme.prop),
    rule("Punctuation", ["punctuation", "meta.brace", "punctuation.separator", "punctuation.terminator", "punctuation.definition.tag", "meta.tag punctuation"], theme.punc),
    rule("Decorator", ["meta.decorator", "entity.name.function.decorator", "punctuation.decorator"], theme.kw),
    rule("Tag", ["entity.name.tag"], theme.tag),
    rule("Regex", ["string.regexp"], theme.cnst),
    rule("Markdown heading", ["markup.heading", "entity.name.section", "markup.heading punctuation.definition.heading"], theme.kw),
    rule("Markdown bold", ["markup.bold"], theme.fg, "bold"),
    rule("Markdown italic", ["markup.italic"], theme.fg, "italic"),
    rule("Markdown link", ["markup.underline.link", "string.other.link"], theme.fn),
    rule("Markdown list", ["punctuation.definition.list.begin.markdown", "markup.list punctuation"], theme.punc),
    rule("Markdown quote", ["markup.quote"], theme.muted, "italic"),
    rule("Inserted", ["markup.inserted"], theme.green),
    rule("Deleted", ["markup.deleted"], theme.red),
    rule("Changed", ["markup.changed"], theme.yellow),
    rule("Invalid", ["invalid", "invalid.illegal"], theme.red),
    // Later rules win ties, so these come last.
    rule("Parameter", ["variable.parameter", "meta.parameter variable"], theme.param, "italic"),
    rule("Attribute", ["entity.other.attribute-name"], theme.attr),
  ];
}

export function semanticTokenColors(theme) {
  return {
    variable: theme.variable,
    parameter: { foreground: theme.param, italic: true },
    "variable.readonly": theme.cnst,
    "variable.defaultLibrary": theme.cnst,
    property: theme.prop,
    "property.readonly": theme.prop,
    function: theme.fn,
    method: theme.fn,
    keyword: { foreground: theme.kw, bold: true },
    string: theme.str,
    number: theme.num,
    type: theme.type,
    class: theme.type,
    interface: theme.type,
    enum: theme.type,
    typeParameter: theme.type,
    namespace: theme.type,
    enumMember: theme.cnst,
    decorator: theme.kw,
    comment: { foreground: theme.cmt, italic: true },
  };
}

export function buildTheme(theme) {
  return {
    $schema: "vscode://schemas/color-theme",
    name: theme.label,
    type: theme.kind,
    semanticHighlighting: true,
    colors: shippedColors(theme),
    tokenColors: tokenColors(theme),
    semanticTokenColors: semanticTokenColors(theme),
  };
}

// Text pairs read from the built colors, so every override counts and the sidebar is the real sidebar.
const COLOR_TEXT_PAIRS = [
  ["list.activeSelectionForeground", "list.activeSelectionBackground"],
  ["list.inactiveSelectionForeground", "list.inactiveSelectionBackground"],
  ["menu.selectionForeground", "menu.selectionBackground"],
  ["menu.foreground", "menu.background"],
  ["quickInput.foreground", "quickInputList.focusBackground"],
  ["tab.activeForeground", "tab.activeBackground"],
  ["tab.inactiveForeground", "tab.inactiveBackground"],
  ["tab.unfocusedActiveForeground", "tab.unfocusedActiveBackground"],
  ["sideBarSectionHeader.foreground", "sideBarSectionHeader.background"],
  ["sideBarTitle.foreground", "sideBar.background"],
  ["panelTitle.activeForeground", "panel.background"],
  ["statusBar.foreground", "statusBar.background"],
  ["statusBarItem.prominentForeground", "statusBarItem.prominentBackground"],
  ["statusBarItem.remoteForeground", "statusBarItem.remoteBackground"],
  ["button.foreground", "button.background"],
  ["button.secondaryForeground", "button.secondaryBackground"],
  ["input.foreground", "input.background"],
  ["textLink.foreground", "editor.background"],
  ["textLink.foreground", "sideBar.background"],
  ["badge.foreground", "badge.background"],
  ["activityBarBadge.foreground", "activityBarBadge.background"],
  ...["added", "untracked", "modified", "deleted", "conflicting", "renamed"].map((state) => [`gitDecoration.${state}ResourceForeground`, "sideBar.background"]),
  ...[1, 2, 3, 4, 5, 6].map((index) => [`editorBracketHighlight.foreground${index}`, "editor.background"]),
];
const ROLE_SYNTAX_KEYS = ["variable", "param", "tag", "attr", "secondary"];
const OPAQUE_HEX_LENGTH = 7;

export function contrastChecks(theme, colors) {
  const checks = [
    ...STATUS_KEYS.map((key) => ({ what: `status ${key} on side`, foreground: theme[key], background: theme.side })),
    ...Object.entries(linkStatusColors(theme)).map(([colorId, hex]) => ({ what: `${colorId} on side`, foreground: hex, background: theme.side })),
    ...[...CHECKED_SYNTAX_KEYS, ...ROLE_SYNTAX_KEYS].map((key) => ({ what: `syntax ${key} on editor`, foreground: theme[key], background: colors["editor.background"] })),
    ...SURFACE_KEYS.map((key) => ({ what: `fg on ${key}`, foreground: theme.fg, background: theme[key] })),
    ...modernLayoutTextChecks(theme),
    ...COLOR_TEXT_PAIRS
      .filter(([foreground, background]) => colors[foreground]?.length === OPAQUE_HEX_LENGTH && colors[background]?.length === OPAQUE_HEX_LENGTH)
      .map(([foreground, background]) => ({ what: `${foreground} on ${background}`, foreground: colors[foreground], background: colors[background] })),
  ];
  return checks.map((check) => ({ ...check, ratio: contrastRatio(check.foreground, check.background) }));
}

export function contrastFailures(variantName, theme, colors) {
  const ratios = contrastChecks(theme, colors);
  const lowest = ratios.reduce((min, check) => (check.ratio < min.ratio ? check : min));
  console.log(`${variantName.padEnd(10)} ${ratios.length} checks, lowest ${lowest.ratio.toFixed(2)}:1 (${lowest.what})`);
  return ratios.filter((check) => check.ratio < MIN_TEXT_CONTRAST).map((check) => `${variantName}: ${check.what} ${check.ratio.toFixed(2)}:1`);
}

const SITE_THEMES_PATH = "docs/assets/overseer-themes.js";
const THEME_LABEL_PREFIX = "Overseer ";
const SITE_PALETTE_KEYS = [
  "deep", "editor", "side", "header", "raised", "border", "hover", "select",
  "fg", "muted", "faint", "accent", "accentHi", "onAccent",
  ...STATUS_KEYS,
];
const COLOR_ID_PREFIX = "overseer.";

function siteTheme(theme) {
  const palette = Object.fromEntries(SITE_PALETTE_KEYS.map((key) => [key, theme[key]]));
  palette.editor = theme.canvas.editor;
  const links = Object.fromEntries(
    Object.entries(linkStatusColors(theme)).map(([colorId, hex]) => [colorId.slice(COLOR_ID_PREFIX.length), hex]),
  );
  return { name: theme.label.slice(THEME_LABEL_PREFIX.length), label: theme.label, kind: theme.kind, palette, links };
}

function writeSiteThemes() {
  const siteThemes = Object.fromEntries(Object.entries(THEMES).map(([variantName, theme]) => [variantName, siteTheme(shippedPalette(theme))]));
  const source = [
    "// Generated by scripts/themes.mjs (npm run themes). Do not edit by hand.",
    `window.OVERSEER_THEMES = ${JSON.stringify(siteThemes, null, 2)};`,
    "",
  ].join("\n");
  fs.writeFileSync(SITE_THEMES_PATH, source);
}

const TAB_SPOTLIGHT_PATH = "src/themeTabSpotlight.ts";

// Modern UI reads editor tab colors only from workbench.colorCustomizations, so the extension copies these there.
const tabSpotlightColors = (theme) => ({
  "tab.activeBackground": theme.select,
  "tab.unfocusedActiveBackground": theme.canvas.editor,
  "tab.activeBorderTop": theme.accent,
  "tab.unfocusedActiveBorderTop": TRANSPARENT,
});

function writeTabSpotlight() {
  const spotlightByLabel = Object.fromEntries(Object.values(THEMES).map((theme) => [theme.label, tabSpotlightColors(shippedPalette(theme))]));
  const source = [
    "// Generated by scripts/themes.mjs (npm run themes). Do not edit by hand.",
    `export const THEME_TAB_SPOTLIGHT: Readonly<Record<string, Readonly<Record<string, string>>>> = ${JSON.stringify(spotlightByLabel, null, 2)};`,
    "",
  ].join("\n");
  fs.writeFileSync(TAB_SPOTLIGHT_PATH, source);
}

const isRunDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isRunDirectly) {
  fs.mkdirSync(THEMES_DIR, { recursive: true });
  const failures = [];
  for (const [variantName, baseTheme] of Object.entries(THEMES)) {
    const theme = shippedPalette(baseTheme);
    const builtTheme = buildTheme(theme);
    const outputPath = path.join(THEMES_DIR, `overseer-${variantName}-color-theme.json`);
    fs.writeFileSync(outputPath, JSON.stringify(builtTheme, null, 2) + "\n");
    failures.push(...contrastFailures(variantName, theme, builtTheme.colors));
  }
  writeSiteThemes();
  writeTabSpotlight();

  if (failures.length > 0) {
    console.error(`Contrast under ${MIN_TEXT_CONTRAST}:1:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`All text colors meet ${MIN_TEXT_CONTRAST}:1.`);
}
