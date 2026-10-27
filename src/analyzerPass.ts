import { SessionAnalysis } from "./analysisState";
import { AnalyzerDigestInput, AnalyzerMode, buildAnalyzerDigest } from "./analyzerDigest";
import { analyzerArgs, applyOps, isRecheckDropTooLarge, parseAnalyzerOutput, RecheckDrop, recheckDropOf } from "./analyzerOps";
import { ClaudeRunner } from "./claudeRunner";

export interface AnalyzerModels {
  model: string;
  recheckModel: string;
}

// digestMode sets what the model reads; model and retryModel set who reads it.
export interface AnalyzerPassPlan {
  digestMode: AnalyzerMode;
  model: string;
  retryModel: string | undefined;
}

export interface AnalyzerPassInput extends Omit<AnalyzerDigestInput, "mode"> {
  plan: AnalyzerPassPlan;
  now: number;
}

export interface AnalyzerPassResult {
  analysis: SessionAnalysis;
  model: string;
}

// A first pass reads the whole transcript like a recheck, since a diff of a long session keeps only its tail, but stays on the cheaper diff model.
export function planAnalyzerPass(
  requestedMode: AnalyzerMode,
  analysis: Pick<SessionAnalysis, "lastPassAt" | "watermarkBytes" | "workstreams">,
  models: AnalyzerModels,
): AnalyzerPassPlan {
  if (requestedMode === "recheck") {
    return { digestMode: "recheck", model: models.recheckModel, retryModel: undefined };
  }
  return { digestMode: hasNoPriorPass(analysis) ? "recheck" : "diff", model: models.model, retryModel: models.recheckModel };
}

// A copy after /clear has a watermark of 0 but keeps its workstreams, so it still gets a plain diff.
function hasNoPriorPass(analysis: Pick<SessionAnalysis, "lastPassAt" | "watermarkBytes" | "workstreams">): boolean {
  const isUnreadWithNoWorkstreams = analysis.watermarkBytes === 0 && analysis.workstreams.length === 0;
  return analysis.lastPassAt === undefined || isUnreadWithNoWorkstreams;
}

type AnalyzerAttempt =
  | { kind: "applied"; analysis: SessionAnalysis }
  | { kind: "schema-failed" }
  | { kind: "dropped-items"; drop: RecheckDrop };

// A diff-model reply that fails the schema, or a recheck that drops too many sorted items, gets one retry on the recheck model; a second failure throws and keeps the previous state.
export async function runAnalyzerPass(input: AnalyzerPassInput, runClaude: ClaudeRunner): Promise<AnalyzerPassResult> {
  const { digestMode, retryModel } = input.plan;
  const digest = buildAnalyzerDigest({ ...input, mode: digestMode });
  const statusIds = input.statusOptions.map((option) => option.id);
  const attemptOn = async (model: string): Promise<AnalyzerAttempt> => {
    const ops = parseAnalyzerOutput(await runClaude(analyzerArgs(model, statusIds), digest.text), statusIds);
    if (ops === undefined) {
      return { kind: "schema-failed" };
    }
    const appliedAnalysis = applyOps(input.analysis, ops, input.edits, {
      mode: digestMode,
      knownItemKeys: new Set(digest.itemKeys),
      statusOptions: input.statusOptions,
    });
    if (digestMode === "recheck") {
      const drop = recheckDropOf(input.analysis, appliedAnalysis, input.edits);
      if (isRecheckDropTooLarge(drop)) {
        return { kind: "dropped-items", drop };
      }
    }
    return { kind: "applied", analysis: appliedAnalysis };
  };

  let model = input.plan.model;
  let attempt = await attemptOn(model);
  if (attempt.kind !== "applied" && retryModel !== undefined) {
    model = retryModel;
    attempt = await attemptOn(model);
  }
  if (attempt.kind === "schema-failed") {
    throw new Error(`analyzer reply from ${model} failed the schema`);
  }
  if (attempt.kind === "dropped-items") {
    throw new Error(`recheck dropped ${attempt.drop.droppedCount} of ${attempt.drop.previouslyAssignedCount} items; kept the previous grouping`);
  }
  return {
    analysis: { ...attempt.analysis, watermarkBytes: digest.watermarkBytes, lastPassAt: input.now, lastModel: model },
    model,
  };
}
