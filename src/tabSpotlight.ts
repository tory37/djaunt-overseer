export type TabSpotlightColorsByTheme = Readonly<Record<string, Readonly<Record<string, string>>>>;
export type ColorCustomizations = Record<string, unknown>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const themeBlockKey = (themeLabel: string): string => `[${themeLabel}]`;

const isSameColor = (left: unknown, right: string): boolean =>
  typeof left === "string" && left.toLowerCase() === right.toLowerCase();

// Returns the new workbench.colorCustomizations, or undefined when nothing changes or the value isn't an object.
export function withTabSpotlight(
  currentCustomizations: unknown,
  colorsByTheme: TabSpotlightColorsByTheme,
  isEnabled: boolean,
): ColorCustomizations | undefined {
  const isUnset = currentCustomizations === undefined || currentCustomizations === null;
  if (!isUnset && !isPlainObject(currentCustomizations)) {
    return undefined;
  }
  const customizations: ColorCustomizations = isUnset ? {} : { ...currentCustomizations };
  let hasChanged = false;
  for (const [themeLabel, spotlightColors] of Object.entries(colorsByTheme)) {
    const blockKey = themeBlockKey(themeLabel);
    const existingBlock = customizations[blockKey];
    const nextBlock = isEnabled
      ? blockWithSpotlight(existingBlock, spotlightColors)
      : blockWithoutSpotlight(existingBlock, spotlightColors);
    if (nextBlock === existingBlock) {
      continue;
    }
    hasChanged = true;
    if (nextBlock === undefined) {
      delete customizations[blockKey];
    } else {
      customizations[blockKey] = nextBlock;
    }
  }
  return hasChanged ? customizations : undefined;
}

// A block that exists but isn't an object is the user's, so it stays as is.
function blockWithSpotlight(existingBlock: unknown, spotlightColors: Readonly<Record<string, string>>): unknown {
  if (existingBlock !== undefined && !isPlainObject(existingBlock)) {
    return existingBlock;
  }
  const block: Record<string, unknown> = { ...(existingBlock ?? {}) };
  const missingColorIds = Object.keys(spotlightColors).filter((colorId) => !Object.hasOwn(block, colorId));
  if (missingColorIds.length === 0) {
    return existingBlock;
  }
  for (const colorId of missingColorIds) {
    block[colorId] = spotlightColors[colorId];
  }
  return block;
}

function blockWithoutSpotlight(existingBlock: unknown, spotlightColors: Readonly<Record<string, string>>): unknown {
  if (!isPlainObject(existingBlock)) {
    return existingBlock;
  }
  const ownColorIds = Object.entries(spotlightColors)
    .filter(([colorId, color]) => isSameColor(existingBlock[colorId], color))
    .map(([colorId]) => colorId);
  if (ownColorIds.length === 0) {
    return existingBlock;
  }
  const block = { ...existingBlock };
  for (const colorId of ownColorIds) {
    delete block[colorId];
  }
  return Object.keys(block).length === 0 ? undefined : block;
}
