import { SeedFacts, SessionAnalysis, TICKET_ITEM_PREFIX, ticketKeyOf, Workstream } from "./analysisState";

// What the user changed by hand. Every pass applies these last, so the user always wins over the model.
// pinnedItems maps an item key to the workstream id it is locked to.
export interface WorkstreamEdits {
  workstreamTitles: Record<string, string>;
  pinnedItems: Record<string, string>;
  removedItems: string[];
  workstreamDone: Record<string, boolean>;
  sessionStatus?: string;
  sessionDone?: boolean;
}

export function emptyWorkstreamEdits(): WorkstreamEdits {
  return { workstreamTitles: {}, pinnedItems: {}, removedItems: [], workstreamDone: {} };
}

export function hasWorkstreamEdits(edits: WorkstreamEdits): boolean {
  return (
    Object.keys(edits.workstreamTitles).length > 0 ||
    Object.keys(edits.pinnedItems).length > 0 ||
    edits.removedItems.length > 0 ||
    Object.keys(edits.workstreamDone).length > 0 ||
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

// Old link-mark removals hide items the way user removals do, but they never enter the stored edits.
export function withSeedRemovals(edits: WorkstreamEdits, seedFacts: SeedFacts): WorkstreamEdits {
  return { ...edits, removedItems: [...new Set([...edits.removedItems, ...seedFacts.removedItemKeys])] };
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
  const removedTicketKeys = new Set(edits.removedItems.flatMap((itemKey) => removedTicketKey(itemKey) ?? []));
  const workstreams: Workstream[] = analysis.workstreams.map((workstream) => ({
    ...workstream,
    title: edits.workstreamTitles[workstream.id] ?? workstream.title,
    done: edits.workstreamDone[workstream.id] ?? workstream.done,
    itemKeys: workstream.itemKeys.filter((itemKey) => !removedItemKeys.has(itemKey)),
    ticketKeys: workstream.ticketKeys.filter((ticketKey) => !removedTicketKeys.has(ticketKey)),
  }));
  for (const [itemKey, pinnedWorkstreamId] of Object.entries(edits.pinnedItems)) {
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

function removedTicketKey(itemKey: string): string | undefined {
  return itemKey.startsWith(TICKET_ITEM_PREFIX) ? ticketKeyOf(itemKey) : undefined;
}

function readRecord<Value>(value: unknown, isValid: (entryValue: unknown) => entryValue is Value): Record<string, Value> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, Value] => isValid(entry[1])));
}
