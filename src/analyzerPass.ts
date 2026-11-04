import { SessionAnalysis } from "./analysisState";
import { AnalyzerDigestInput, AnalyzerMode, buildAnalyzerDigest } from "./analyzerDigest";
import { analyzerArgs, applyOps, isRecheckDropTooLarge, parseAnalyzerOutput, parseRunUsage, RecheckDrop, recheckDropOf, RunUsage } from "./analyzerOps";
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

// One runner call. usage is undefined when the runner rejected or the reply carried no usage.
export interface AnalyzerCall {
  model: string;
  digestMode: AnalyzerMode;
  digestBytes: number;
  usage: RunUsage | undefined;
}

export interface AnalyzerPassResult {
  analysis: SessionAnalysis;
  model: string;
  calls: AnalyzerCall[];
}

// A failed pass still made calls that cost money, so the error carries them.
export class AnalyzerPassError extends Error {
  readonly calls: AnalyzerCall[];

  constructor(message: string, calls: AnalyzerCall[]) {
    super(message);
    this.name = "AnalyzerPassError";
    this.calls = calls;
  }
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
  const digestBytes = Buffer.byteLength(digest.text, "utf8");
  const calls: AnalyzerCall[] = [];
  const attemptOn = async (model: string): Promise<AnalyzerAttempt> => {
    let stdout: string;
    try {
      stdout = await runClaude(analyzerArgs(model, statusIds), digest.text);
    } catch (error) {
      calls.push({ model, digestMode, digestBytes, usage: undefined });
      throw new AnalyzerPassError(error instanceof Error ? error.message : String(error), calls);
    }
    calls.push({ model, digestMode, digestBytes, usage: parseRunUsage(stdout) });
    const ops = parseAnalyzerOutput(stdout, statusIds);
    if (ops === undefined) {
      return { kind: "schema-failed" };
    }
    const appliedAnalysis = applyOps(input.analysis, ops, input.edits, {
      mode: digestMode,
      knownItemKeys: new Set(digest.itemKeys),
      statusOptions: input.statusOptions,
      isTitleLocked: input.isTitleLocked,
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
    throw new AnalyzerPassError(`analyzer reply from ${model} failed the schema`, calls);
  }
  if (attempt.kind === "dropped-items") {
    throw new AnalyzerPassError(`recheck dropped ${attempt.drop.droppedCount} of ${attempt.drop.previouslyAssignedCount} items; kept the previous grouping`, calls);
  }
  return {
    analysis: { ...attempt.analysis, watermarkBytes: digest.watermarkBytes, lastPassAt: input.now, lastModel: model },
    model,
    calls,
  };
}
