// Tab positions are 1-based within each editor group, so each group counts its own terminals.
export class TerminalTabPositions<GroupKey> {
  private readonly placedCountByGroup = new Map<GroupKey, number>();

  next(groupKey: GroupKey): number {
    const position = (this.placedCountByGroup.get(groupKey) ?? 0) + 1;
    this.placedCountByGroup.set(groupKey, position);
    return position;
  }
}

export function terminalTabPositions<GroupKey>(groupKeysInTreeOrder: GroupKey[]): number[] {
  const positions = new TerminalTabPositions<GroupKey>();
  return groupKeysInTreeOrder.map((groupKey) => positions.next(groupKey));
}
