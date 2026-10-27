import { SessionAnalysis, ticketItemKey, Workstream } from "./analysisState";
import { UNSORTED_WORKSTREAM_ID } from "./workstreamEdits";

export const MAX_EXPANDED_UNSORTED_ITEMS = 5;

export interface DisplayGroup<Row> {
  id: string;
  isUnsorted: boolean;
  title: string;
  isDone: boolean;
  tickets: Row[];
  rows: Row[];
  isCollapsedByDefault: boolean;
}

export interface WorkstreamDisplay<Row> {
  groups: DisplayGroup<Row>[];
  removedRows: Row[];
  isEmpty: boolean;
}

// analysis already has the user's edits applied. candidateItemKeys are the transcript's items that may land in Unsorted.
export interface WorkstreamDisplayInput<Row> {
  analysis: SessionAnalysis | undefined;
  workstreamOrder: string[];
  candidateItemKeys: string[];
  removedItemKeys: string[];
  lastActivityOf: (itemKey: string) => number;
  rowFor: (itemKey: string) => Row | undefined;
}

export function buildWorkstreamDisplay<Row>(input: WorkstreamDisplayInput<Row>): WorkstreamDisplay<Row> {
  const workstreams = input.analysis?.workstreams ?? [];
  const rowsFor = (itemKeys: string[]): Row[] => itemKeys.flatMap((itemKey) => input.rowFor(itemKey) ?? []);
  const workstreamGroups = orderWorkstreams(workstreams, input.workstreamOrder, input.lastActivityOf).map(
    (workstream): DisplayGroup<Row> => ({
      id: workstream.id,
      isUnsorted: false,
      title: workstream.title,
      isDone: workstream.done,
      tickets: rowsFor(workstream.ticketKeys.map(ticketItemKey)),
      rows: rowsFor(workstream.itemKeys),
      isCollapsedByDefault: workstream.done,
    }),
  );
  const unsortedKeys = unsortedItemKeys(workstreams, input.candidateItemKeys, input.removedItemKeys, input.lastActivityOf);
  const unsortedRows = rowsFor(unsortedKeys);
  const groups = [...workstreamGroups];
  if (unsortedRows.length > 0) {
    groups.push({
      id: UNSORTED_WORKSTREAM_ID,
      isUnsorted: true,
      title: "Unsorted",
      isDone: false,
      tickets: [],
      rows: unsortedRows,
      isCollapsedByDefault: unsortedRows.length > MAX_EXPANDED_UNSORTED_ITEMS,
    });
  }
  return { groups, removedRows: rowsFor([...new Set(input.removedItemKeys)]), isEmpty: groups.length === 0 };
}

// The user's saved order first, then active workstreams newest first, then done ones newest first.
// Newest means the latest activity among its items; a tie goes to the one the model created later.
export function orderWorkstreams(workstreams: Workstream[], savedOrder: string[], lastActivityOf: (itemKey: string) => number): Workstream[] {
  const savedWorkstreams = savedOrder.flatMap((workstreamId) => workstreams.find((workstream) => workstream.id === workstreamId) ?? []);
  const creationIndexOf = new Map(workstreams.map((workstream, index) => [workstream.id, index]));
  const activityOf = (workstream: Workstream): number =>
    Math.max(0, ...[...workstream.itemKeys, ...workstream.ticketKeys.map(ticketItemKey)].map(lastActivityOf));
  const newestFirst = (left: Workstream, right: Workstream): number =>
    activityOf(right) - activityOf(left) || (creationIndexOf.get(right.id) ?? 0) - (creationIndexOf.get(left.id) ?? 0);
  const unsavedWorkstreams = workstreams.filter((workstream) => !savedWorkstreams.includes(workstream));
  const activeWorkstreams = unsavedWorkstreams.filter((workstream) => !workstream.done).sort(newestFirst);
  const doneWorkstreams = unsavedWorkstreams.filter((workstream) => workstream.done).sort(newestFirst);
  return [...savedWorkstreams, ...activeWorkstreams, ...doneWorkstreams];
}

function unsortedItemKeys(
  workstreams: Workstream[],
  candidateItemKeys: string[],
  removedItemKeys: string[],
  lastActivityOf: (itemKey: string) => number,
): string[] {
  const placedItemKeys = new Set(
    workstreams.flatMap((workstream) => [...workstream.itemKeys, ...workstream.ticketKeys.map(ticketItemKey)]),
  );
  const removedKeySet = new Set(removedItemKeys);
  return [...new Set(candidateItemKeys)]
    .filter((itemKey) => !placedItemKeys.has(itemKey) && !removedKeySet.has(itemKey))
    .sort((left, right) => lastActivityOf(right) - lastActivityOf(left));
}

// A drop names the group under the pointer. It pins the item there, unless the item is not shown or already sits in that group.
// Unsorted is a valid target even before it has a group of its own.
export function resolveItemDrop(groups: DisplayGroup<{ key: string }>[], itemKey: string, targetGroupId: string): string | undefined {
  const sourceGroup = groups.find((group) => group.rows.some((row) => row.key === itemKey));
  const isKnownTarget = targetGroupId === UNSORTED_WORKSTREAM_ID || groups.some((group) => group.id === targetGroupId);
  if (sourceGroup === undefined || !isKnownTarget || sourceGroup.id === targetGroupId) {
    return undefined;
  }
  return targetGroupId;
}
