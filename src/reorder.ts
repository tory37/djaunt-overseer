// Tree drops carry no above/below position, so the drag direction decides it:
// items dragged down land after the target, items dragged up or in from elsewhere land before it.
export function moveBeside(currentOrder: string[], movedIds: string[], targetId: string | undefined): string[] {
  if (targetId !== undefined && movedIds.includes(targetId)) {
    return currentOrder;
  }
  const remainingIds = currentOrder.filter((id) => !movedIds.includes(id));
  if (targetId === undefined) {
    return [...remainingIds, ...movedIds];
  }
  const firstMovedIndex = currentOrder.findIndex((id) => movedIds.includes(id));
  const isMovingDown = firstMovedIndex !== -1 && firstMovedIndex < currentOrder.indexOf(targetId);
  const targetIndex = remainingIds.indexOf(targetId);
  const insertIndex = isMovingDown ? targetIndex + 1 : targetIndex;
  return [...remainingIds.slice(0, insertIndex), ...movedIds, ...remainingIds.slice(insertIndex)];
}

// Ids missing from the saved order rank first, so new groups and sessions show up at the top.
export function sortBySavedOrder<Item>(items: Item[], savedOrder: string[], idOf: (item: Item) => string): Item[] {
  const rankById = new Map(savedOrder.map((id, index) => [id, index]));
  const rankOf = (item: Item): number => rankById.get(idOf(item)) ?? -1;
  return [...items].sort((left, right) => rankOf(left) - rankOf(right));
}
