export const GROUP_ICON_COLOR_IDS = [
  "overseer.groupIcon1",
  "overseer.groupIcon2",
  "overseer.groupIcon3",
  "overseer.groupIcon4",
  "overseer.groupIcon5",
  "overseer.groupIcon6",
] as const;

export const UNGROUPED_ICON_COLOR_ID = "icon.foreground";

// The color follows the group's place in the saved user group list, so a group keeps it in both views and after a drag.
export function groupIconColorId(groupRef: string, userGroupRefs: readonly string[]): string {
  const userGroupIndex = userGroupRefs.indexOf(groupRef);
  if (userGroupIndex < 0) {
    return UNGROUPED_ICON_COLOR_ID;
  }
  return GROUP_ICON_COLOR_IDS[userGroupIndex % GROUP_ICON_COLOR_IDS.length];
}
