export type SessionIconState = "working" | "compacting" | "running" | "elsewhere" | "suspended" | "duplicate";

export interface SessionIconSpec {
  state: SessionIconState;
  label: string;
  defaultIcon: string;
  // A theme color contributed in package.json; users override it in workbench.colorCustomizations.
  colorId: string;
}

export const SESSION_ICON_SPECS: SessionIconSpec[] = [
  { state: "working", label: "Working in this window", defaultIcon: "loading~spin", colorId: "overseer.sessionWorking" },
  { state: "compacting", label: "Compacting", defaultIcon: "sync~spin", colorId: "overseer.sessionCompacting" },
  { state: "running", label: "Running in this window", defaultIcon: "terminal", colorId: "overseer.sessionRunning" },
  { state: "elsewhere", label: "Running outside this window", defaultIcon: "window", colorId: "overseer.sessionElsewhere" },
  { state: "suspended", label: "Suspended", defaultIcon: "debug-pause", colorId: "overseer.sessionSuspended" },
  { state: "duplicate", label: "Copies running", defaultIcon: "warning", colorId: "overseer.sessionDuplicate" },
];

const CODICON_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*(~spin)?$/;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function sessionIconSpec(state: SessionIconState): SessionIconSpec {
  return SESSION_ICON_SPECS.find((spec) => spec.state === state) ?? SESSION_ICON_SPECS[0];
}

// A blank or malformed name falls back to the default, so a typo never leaves a row without an icon.
export function sessionIconName(state: SessionIconState, configuredName: string | undefined): string {
  const trimmedName = configuredName?.trim() ?? "";
  return CODICON_NAME_PATTERN.test(trimmedName) ? trimmedName : sessionIconSpec(state).defaultIcon;
}

export function isCodiconName(name: string): boolean {
  return CODICON_NAME_PATTERN.test(name);
}

// Returns the color customizations with one Overseer color set, or removed when color is undefined.
export function withSessionColor(
  colorCustomizations: Record<string, unknown> | undefined,
  colorId: string,
  color: string | undefined,
): Record<string, unknown> {
  const updatedCustomizations = { ...(colorCustomizations ?? {}) };
  if (color === undefined) {
    delete updatedCustomizations[colorId];
  } else if (HEX_COLOR_PATTERN.test(color)) {
    updatedCustomizations[colorId] = color;
  }
  return updatedCustomizations;
}

export function customSessionColor(colorCustomizations: Record<string, unknown> | undefined, colorId: string): string | undefined {
  const color = colorCustomizations?.[colorId];
  return typeof color === "string" ? color : undefined;
}
