import { clipLine, MAX_WORKSTREAM_TITLE_CHARS, SessionAnalysis, TICKET_ITEM_PREFIX, ticketKeyOf, Workstream } from "./analysisState";

// Model workstream ids all start with "ws-", so this pin target never names one.
export const UNSORTED_WORKSTREAM_ID = "unsorted";

// What the user changed by hand. Every pass applies these last, so the user always wins over the model.
// pinnedItems maps an item key to the workstream id it is locked to, or to UNSORTED_WORKSTREAM_ID.
export interface WorkstreamEdits {
  workstreamTitles: Record<string, string>;
  pinnedItems: Record<string, string>;
  removedItems: string[];
  workstreamDone: Record<string, boolean>;
  workstreamOrder: string[];
  sessionStatus?: string;
  sessionDone?: boolean;
}

export function emptyWorkstreamEdits(): WorkstreamEdits {
  return { workstreamTitles: {}, pinnedItems: {}, removedItems: [], workstreamDone: {}, workstreamOrder: [] };
}

export function hasWorkstreamEdits(edits: WorkstreamEdits): boolean {
  return (
    Object.keys(edits.workstreamTitles).length > 0 ||
    Object.keys(edits.pinnedItems).length > 0 ||
    edits.removedItems.length > 0 ||
    Object.keys(edits.workstreamDone).length > 0 ||
    edits.workstreamOrder.length > 0 ||
    edits.sessionStatus !== undefined ||
    edits.sessionDone !== undefined
  );
}

// A workstream the user renamed, pinned into, or marked survives a pass that leaves it empty.
export function isUserEditedWorkstream(edits: WorkstreamEdits, workstreamId: string): boolean {
  return (
    edits.workstreamTitles[workstreamId] !== undefined ||
    edits.workstreamDone[workstreamId] !== undefined ||
    Object.values(edits.pinnedItems).includes(workstreamId)
  );
}

// Link marks are the one store of removals; the sidebar's Remove and Restore write them, and every reader folds them in here.
export function withLinkMarkRemovals(edits: WorkstreamEdits, linkMarks: Record<string, string>): WorkstreamEdits {
  const markedRemovals = Object.entries(linkMarks)
    .filter(([, mark]) => mark === "removed")
    .map(([itemKey]) => itemKey);
  return { ...edits, removedItems: [...new Set([...edits.removedItems, ...markedRemovals])] };
}

// An empty title drops the rename, so the model's title shows again.
export function withRenamedWorkstream(edits: WorkstreamEdits, workstreamId: string, rawTitle: string): WorkstreamEdits {
  const { [workstreamId]: _previousTitle, ...otherTitles } = edits.workstreamTitles;
  const title = clipLine(rawTitle, MAX_WORKSTREAM_TITLE_CHARS);
  return { ...edits, workstreamTitles: title === "" ? otherTitles : { ...otherTitles, [workstreamId]: title } };
}

export function withPinnedItem(edits: WorkstreamEdits, itemKey: string, workstreamId: string): WorkstreamEdits {
  return { ...edits, pinnedItems: { ...edits.pinnedItems, [itemKey]: workstreamId } };
}

export function withWorkstreamDone(edits: WorkstreamEdits, workstreamId: string, isDone: boolean): WorkstreamEdits {
  return { ...edits, workstreamDone: { ...edits.workstreamDone, [workstreamId]: isDone } };
}

export function withWorkstreamOrder(edits: WorkstreamEdits, workstreamIds: string[]): WorkstreamEdits {
  return { ...edits, workstreamOrder: [...new Set(workstreamIds)] };
}

export function withoutRemovedItem(edits: WorkstreamEdits, itemKey: string): WorkstreamEdits {
  return { ...edits, removedItems: edits.removedItems.filter((removedKey) => removedKey !== itemKey) };
}

export function isLockedItem(edits: WorkstreamEdits, itemKey: string): boolean {
  return edits.removedItems.includes(itemKey) || edits.pinnedItems[itemKey] !== undefined;
}

export function readWorkstreamEdits(entries: unknown): WorkstreamEdits {
  const fields = typeof entries === "object" && entries !== null ? (entries as Record<string, unknown>) : {};
  const edits: WorkstreamEdits = {
    workstreamTitles: readRecord(fields.workstreamTitles, (value): value is string => typeof value === "string" && value.trim() !== ""),
    pinnedItems: readRecord(fields.pinnedItems, (value): value is string => typeof value === "string" && value !== ""),
    removedItems: Array.isArray(fields.removedItems)
      ? [...new Set(fields.removedItems.filter((itemKey): itemKey is string => typeof itemKey === "string" && itemKey !== ""))]
      : [],
    workstreamDone: readRecord(fields.workstreamDone, (value): value is boolean => typeof value === "boolean"),
    workstreamOrder: Array.isArray(fields.workstreamOrder)
      ? [...new Set(fields.workstreamOrder.filter((workstreamId): workstreamId is string => typeof workstreamId === "string" && workstreamId !== ""))]
      : [],
  };
  if (typeof fields.sessionStatus === "string" && fields.sessionStatus !== "") {
    edits.sessionStatus = fields.sessionStatus;
  }
  if (typeof fields.sessionDone === "boolean") {
    edits.sessionDone = fields.sessionDone;
  }
  return edits;
}

// Removal beats a pin. Edits that name a workstream no longer in the state are skipped.
export function applyUserEdits(analysis: SessionAnalysis, edits: WorkstreamEdits): SessionAnalysis {
  const removedItemKeys = new Set(edits.removedItems);
  const removedTicketKeys = new Set(edits.removedItems.flatMap((itemKey) => ticketKeyOfItem(itemKey) ?? []));
  const workstreams: Workstream[] = analysis.workstreams.map((workstream) => ({
    ...workstream,
    title: edits.workstreamTitles[workstream.id] ?? workstream.title,
    done: edits.workstreamDone[workstream.id] ?? workstream.done,
    itemKeys: workstream.itemKeys.filter((itemKey) => !removedItemKeys.has(itemKey)),
    ticketKeys: workstream.ticketKeys.filter((ticketKey) => !removedTicketKeys.has(ticketKey)),
  }));
  for (const [itemKey, pinnedWorkstreamId] of Object.entries(edits.pinnedItems)) {
    if (pinnedWorkstreamId === UNSORTED_WORKSTREAM_ID) {
      unsortItem(workstreams, itemKey);
      continue;
    }
    const pinnedWorkstream = workstreams.find((workstream) => workstream.id === pinnedWorkstreamId);
    if (pinnedWorkstream === undefined || removedItemKeys.has(itemKey)) {
      continue;
    }
    pinItem(workstreams, pinnedWorkstream, itemKey);
  }
  const editedAnalysis: SessionAnalysis = {
    ...analysis,
    workstreams,
    sessionDone: edits.sessionDone ?? analysis.sessionDone,
  };
  const sessionStatus = edits.sessionStatus ?? analysis.sessionStatus;
  if (sessionStatus !== undefined) {
    editedAnalysis.sessionStatus = sessionStatus;
  }
  return editedAnalysis;
}

// A pinned ticket gains a tag on its workstream and keeps its other tags; any other item moves there alone.
function pinItem(workstreams: Workstream[], pinnedWorkstream: Workstream, itemKey: string): void {
  const pinnedTicketKey = itemKey.startsWith(TICKET_ITEM_PREFIX) ? ticketKeyOf(itemKey) : undefined;
  if (pinnedTicketKey !== undefined) {
    if (!pinnedWorkstream.ticketKeys.includes(pinnedTicketKey)) {
      pinnedWorkstream.ticketKeys = [...pinnedWorkstream.ticketKeys, pinnedTicketKey];
    }
    return;
  }
  for (const workstream of workstreams) {
    if (workstream !== pinnedWorkstream && workstream.itemKeys.includes(itemKey)) {
      workstream.itemKeys = workstream.itemKeys.filter((otherKey) => otherKey !== itemKey);
    }
  }
  if (!pinnedWorkstream.itemKeys.includes(itemKey)) {
    pinnedWorkstream.itemKeys = [...pinnedWorkstream.itemKeys, itemKey];
  }
}

function unsortItem(workstreams: Workstream[], itemKey: string): void {
  const unsortedTicketKey = ticketKeyOfItem(itemKey);
  for (const workstream of workstreams) {
    workstream.itemKeys = workstream.itemKeys.filter((otherKey) => otherKey !== itemKey);
    workstream.ticketKeys = workstream.ticketKeys.filter((ticketKey) => ticketKey !== unsortedTicketKey);
  }
}

function ticketKeyOfItem(itemKey: string): string | undefined {
  return itemKey.startsWith(TICKET_ITEM_PREFIX) ? ticketKeyOf(itemKey) : undefined;
}

function readRecord<Value>(value: unknown, isValid: (entryValue: unknown) => entryValue is Value): Record<string, Value> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, Value] => isValid(entry[1])));
}
