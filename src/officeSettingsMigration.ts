// Pure: which of the old overseer.office.* settings move to Office Simulation's officeSim.* ones. A setting moves once,
// only when you set it and haven't set the new one, so nothing you chose resets and nothing you set later is undone.

export const MOVED_OFFICE_SETTINGS = [
  "scene", "critters", "fliers", "dayNight", "visitors", "chatter", "talk", "bubbleLook", "performances", "races", "you", "yourLook",
] as const;

export interface SettingValues {
  old: unknown;
  current: unknown;
}

export function settingsToMove(read: (name: (typeof MOVED_OFFICE_SETTINGS)[number]) => SettingValues): { key: string; value: unknown }[] {
  return MOVED_OFFICE_SETTINGS.flatMap((name) => {
    const { old, current } = read(name);
    return old !== undefined && current === undefined ? [{ key: `officeSim.${name}`, value: old }] : [];
  });
}
