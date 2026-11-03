import { Workstream } from "./analysisState";

export interface EvalLabel {
  sessionId: string;
  workstreams: { title: string; itemKeys: string[] }[];
  where?: string[];
}

export interface GroupingScore {
  pairPrecision: number;
  pairRecall: number;
  pairF1: number;
  coverage: number;
  countDelta: number;
  labeledItems: number;
  unsortedItems: number;
}

type WorkstreamIndexesByItem = Map<string, Set<number>>;

function workstreamIndexesByItem(workstreams: Pick<Workstream, "itemKeys">[], keptItemKeys: Set<string>): WorkstreamIndexesByItem {
  const indexesByItem: WorkstreamIndexesByItem = new Map();
  workstreams.forEach((workstream, workstreamIndex) => {
    for (const itemKey of workstream.itemKeys) {
      if (!keptItemKeys.has(itemKey)) {
        continue;
      }
      const indexes = indexesByItem.get(itemKey) ?? new Set<number>();
      indexes.add(workstreamIndex);
      indexesByItem.set(itemKey, indexes);
    }
  });
  return indexesByItem;
}

function areTogether(indexesByItem: WorkstreamIndexesByItem, firstItemKey: string, secondItemKey: string): boolean {
  const firstIndexes = indexesByItem.get(firstItemKey);
  const secondIndexes = indexesByItem.get(secondItemKey);
  if (!firstIndexes || !secondIndexes) {
    return false;
  }
  return [...firstIndexes].some((index) => secondIndexes.has(index));
}

function ratioOrOne(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

export function scoreGrouping(label: EvalLabel, output: Pick<Workstream, "itemKeys">[]): GroupingScore {
  const labeledItemKeys = new Set(label.workstreams.flatMap((workstream) => workstream.itemKeys));
  const labelIndexesByItem = workstreamIndexesByItem(label.workstreams, labeledItemKeys);
  const outputIndexesByItem = workstreamIndexesByItem(output, labeledItemKeys);

  const itemKeys = [...labeledItemKeys];
  let truePositivePairs = 0;
  let falsePositivePairs = 0;
  let falseNegativePairs = 0;
  for (let first = 0; first < itemKeys.length; first++) {
    for (let second = first + 1; second < itemKeys.length; second++) {
      const isTogetherInLabel = areTogether(labelIndexesByItem, itemKeys[first], itemKeys[second]);
      const isTogetherInOutput = areTogether(outputIndexesByItem, itemKeys[first], itemKeys[second]);
      if (isTogetherInLabel && isTogetherInOutput) {
        truePositivePairs++;
      } else if (isTogetherInOutput) {
        falsePositivePairs++;
      } else if (isTogetherInLabel) {
        falseNegativePairs++;
      }
    }
  }

  const pairPrecision = ratioOrOne(truePositivePairs, truePositivePairs + falsePositivePairs);
  const pairRecall = ratioOrOne(truePositivePairs, truePositivePairs + falseNegativePairs);
  const hasNoPairs = truePositivePairs + falsePositivePairs + falseNegativePairs === 0;
  let pairF1 = 0;
  if (hasNoPairs) {
    pairF1 = 1;
  } else if (pairPrecision + pairRecall > 0) {
    pairF1 = (2 * pairPrecision * pairRecall) / (pairPrecision + pairRecall);
  }

  const labeledItems = labeledItemKeys.size;
  const sortedItems = outputIndexesByItem.size;
  const labelWorkstreamCount = label.workstreams.filter((workstream) => workstream.itemKeys.length > 0).length;
  // An output workstream holding only items the label removed is not a real disagreement.
  const outputWorkstreamCount = new Set([...outputIndexesByItem.values()].flatMap((indexes) => [...indexes])).size;

  return {
    pairPrecision,
    pairRecall,
    pairF1,
    coverage: ratioOrOne(sortedItems, labeledItems),
    countDelta: labelWorkstreamCount - outputWorkstreamCount,
    labeledItems,
    unsortedItems: labeledItems - sortedItems,
  };
}
