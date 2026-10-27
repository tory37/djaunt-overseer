import { createHash } from "crypto";
import { ClaudeRunner, headlessClaudeArgs } from "./claudeRunner";
import { fallbackRole, isPassiveMention, LinkCandidate, linkKey, LinkRole } from "./linkCandidates";

export type { ClaudeRunner } from "./claudeRunner";
export { linkKey } from "./linkCandidates";

export type JudgedRole = "owned" | "touched" | "irrelevant";

export interface JudgeVerdict {
  role: JudgedRole;
  stillRelevant: boolean;
  label: string | undefined;
  // The link key this link sits under in the Session sidebar.
  parentKey?: string;
}

export interface JudgeSessionContext {
  title: string | undefined;
  gitBranch: string | undefined;
  cwd: string | undefined;
  firstPrompt: string | undefined;
}

export interface JudgeCacheEntry {
  fingerprint: string;
  model: string;
  judgedAt: string;
  verdicts: Record<string, JudgeVerdict>;
}

export interface ResolvedLink extends LinkCandidate {
  role: JudgedRole;
  stillRelevant: boolean;
  label: string | undefined;
  judged: boolean;
  parentKey?: string;
  declaredParentKey?: string;
  isAgentDeclared?: boolean;
  agentNote?: string;
}

const MAX_DIGEST_BYTES = 8 * 1024;
const MAX_PROMPT_CHARS = 300;
const OMITTED_NOTE_RESERVE_BYTES = 48;
const MAX_LABEL_LENGTH = 60;
const JUDGED_ROLES = new Set<string>(["owned", "touched", "irrelevant"]);

const JUDGE_SYSTEM_PROMPT = `You decide which links matter to one Claude Code session.
The input lists the session's title, branch, cwd, first prompt, and candidate links found in its transcript. Each link has signals and short context snippets.

Signals:
- pr-created: the session ran gh pr create and got this PR back.
- pr-write: the session commented on, edited, reviewed, merged, or closed the PR.
- pr-read: the session viewed the PR, its checks, or its diff.
- pr-link-record: Claude Code recorded the PR for this session. It appears for PRs the session created and for PRs it only read.
- ticket-write / ticket-read: the session wrote to or read the Jira ticket through a Jira tool.
- artifact-published / artifact-read: the session published or read the artifact.
- branch: the ticket key is in the session's git branch.
- user-mention: the user typed the link or key.
- mention: the link only appeared in tool output or assistant text.

Roles:
- owned: the session's own work product. The PR it opened, the ticket the work is for, an artifact it published.
- touched: the session acted on it, or it is part of the task. A PR it reviewed, a ticket it commented on or moved, a link the user asked about.
- irrelevant: background noise. Examples, docs, search results, links in unrelated output.
A link the user typed once in passing is irrelevant unless the session went on to work on it.

stillRelevant is false when an owned or touched link was replaced or abandoned later in the session, for example an artifact republished under a new link or a PR closed for another one. Otherwise it is true.
label is a short name for the link, at most 60 characters: the PR title, the ticket summary, or what the artifact shows. Use an empty string if the snippets do not say.
parentId is the id of another returned link this one belongs under: a sub-ticket's parent ticket, the ticket a PR implements, or the PR or ticket an artifact documents. Use an empty string when it belongs under nothing.
Return only the owned and touched links, each once. Leave irrelevant links out.`;

const JUDGE_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    links: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          role: { type: "string", enum: ["owned", "touched"] },
          stillRelevant: { type: "boolean" },
          label: { type: "string" },
          parentId: { type: "string" },
        },
        required: ["id", "role", "stillRelevant", "label", "parentId"],
      },
    },
  },
  required: ["links"],
};

const FALLBACK_ROLE_RANK: Record<LinkRole, number> = { owned: 0, touched: 1, mentioned: 2 };
const JUDGED_ROLE_RANK: Record<JudgedRole, number> = { owned: 0, touched: 1, irrelevant: 2 };

// Signal counts grow on every turn, so only new links or new kinds of signal call for a fresh verdict.
// Passive mentions never show, so the judge never sees them; quoted text in their snippets misled it.
function judgeableCandidates(candidates: LinkCandidate[]): LinkCandidate[] {
  return candidates.filter((candidate) => !isPassiveMention(candidate));
}

export function candidateFingerprint(candidates: LinkCandidate[]): string {
  const fingerprintLines = judgeableCandidates(candidates)
    .map((candidate) => `${linkKey(candidate)}|${Object.keys(candidate.signals).sort().join(",")}`)
    .sort();
  return createHash("sha1").update(fingerprintLines.join("\n")).digest("hex");
}

export function needsJudging(candidates: LinkCandidate[], cachedEntry: JudgeCacheEntry | undefined, model: string): boolean {
  if (judgeableCandidates(candidates).length === 0) {
    return false;
  }
  return cachedEntry === undefined || cachedEntry.model !== model || cachedEntry.fingerprint !== candidateFingerprint(candidates);
}

export interface JudgeDigest {
  text: string;
  includedKeys: string[];
}

export function buildJudgeDigest(context: JudgeSessionContext, candidates: LinkCandidate[]): JudgeDigest {
  const headerLines = [
    `Session title: ${context.title ?? "(none)"}`,
    `Branch: ${context.gitBranch ?? "(none)"}`,
    `Cwd: ${context.cwd ?? "(unknown)"}`,
    `First prompt: ${clipText(context.firstPrompt ?? "(none)", MAX_PROMPT_CHARS)}`,
    "",
    "Links:",
  ];
  const headerText = headerLines.join("\n");
  const rankedCandidates = rankForDigest(candidates);

  // Every link listed bare beats a few links with snippets, so list first and spend leftover bytes on snippets.
  const includedEntries: { candidate: LinkCandidate; entryText: string }[] = [];
  let usedBytes = byteLength(headerText) + OMITTED_NOTE_RESERVE_BYTES;
  for (const candidate of rankedCandidates) {
    const bareEntry = renderCandidate(candidate, false);
    if (usedBytes + byteLength(bareEntry) > MAX_DIGEST_BYTES) {
      break;
    }
    includedEntries.push({ candidate, entryText: bareEntry });
    usedBytes += byteLength(bareEntry);
  }
  for (const includedEntry of includedEntries) {
    const fullEntry = renderCandidate(includedEntry.candidate, true);
    const extraBytes = byteLength(fullEntry) - byteLength(includedEntry.entryText);
    if (usedBytes + extraBytes <= MAX_DIGEST_BYTES) {
      includedEntry.entryText = fullEntry;
      usedBytes += extraBytes;
    }
  }

  let digestText = headerText + includedEntries.map((includedEntry) => includedEntry.entryText).join("");
  const omittedCount = rankedCandidates.length - includedEntries.length;
  if (omittedCount > 0) {
    digestText += `\n(${omittedCount} more links omitted for space.)`;
  }
  return { text: digestText, includedKeys: includedEntries.map((includedEntry) => linkKey(includedEntry.candidate)) };
}

export function judgeArgs(model: string): string[] {
  return headlessClaudeArgs(model, JUDGE_SYSTEM_PROMPT, JUDGE_OUTPUT_SCHEMA);
}

export function parseJudgeOutput(stdout: string, includedKeys: string[]): Record<string, JudgeVerdict> {
  const envelope = JSON.parse(stdout) as { is_error?: boolean; structured_output?: unknown; result?: unknown };
  if (envelope.is_error) {
    throw new Error(`judge run failed: ${String(envelope.result)}`);
  }
  const structuredOutput = envelope.structured_output ?? parseResultText(envelope.result);
  const verdictList = (structuredOutput as { links?: unknown } | undefined)?.links;
  if (!Array.isArray(verdictList)) {
    throw new Error("judge output has no links array");
  }

  const expectedKeys = new Set(includedKeys);
  const verdicts: Record<string, JudgeVerdict> = {};
  for (const includedKey of includedKeys) {
    verdicts[includedKey] = { role: "irrelevant", stillRelevant: true, label: undefined };
  }
  for (const rawVerdict of verdictList) {
    const verdict = validateVerdict(rawVerdict);
    if (verdict !== undefined && expectedKeys.has(verdict.key)) {
      const { parentKey, ...verdictFields } = verdict.verdict;
      const hasValidParent = parentKey !== undefined && parentKey !== verdict.key && expectedKeys.has(parentKey);
      verdicts[verdict.key] = hasValidParent ? { ...verdictFields, parentKey } : verdictFields;
    }
  }
  return verdicts;
}

export async function judgeSessionLinks(
  context: JudgeSessionContext,
  candidates: LinkCandidate[],
  model: string,
  runClaude: ClaudeRunner,
): Promise<JudgeCacheEntry> {
  const digest = buildJudgeDigest(context, judgeableCandidates(candidates));
  const stdout = await runClaude(judgeArgs(model), digest.text);
  return {
    fingerprint: candidateFingerprint(candidates),
    model,
    judgedAt: new Date().toISOString(),
    verdicts: parseJudgeOutput(stdout, digest.includedKeys),
  };
}

export function resolveLinks(candidates: LinkCandidate[], judgeEntry: JudgeCacheEntry | undefined): ResolvedLink[] {
  const resolvedLinks = candidates.map((candidate): ResolvedLink => {
    const verdict = judgeEntry?.verdicts[linkKey(candidate)];
    const signalRole = fallbackRole(candidate);
    if (isPassiveMention(candidate)) {
      return { ...candidate, role: "irrelevant", stillRelevant: true, label: candidate.title, judged: false };
    }
    if (verdict !== undefined) {
      const role = signalRole === "owned" ? "owned" : verdict.role;
      return { ...candidate, ...verdict, role, label: verdict.label ?? candidate.title, judged: true };
    }
    return {
      ...candidate,
      role: signalRole === "mentioned" ? "irrelevant" : signalRole,
      stillRelevant: true,
      label: candidate.title,
      judged: false,
    };
  });
  return resolvedLinks.sort((left, right) => judgedRoleRank(left.role) - judgedRoleRank(right.role));
}

function rankForDigest(candidates: LinkCandidate[]): LinkCandidate[] {
  return [...candidates].sort((left, right) => {
    const roleDifference = FALLBACK_ROLE_RANK[fallbackRole(left)] - FALLBACK_ROLE_RANK[fallbackRole(right)];
    if (roleDifference !== 0) {
      return roleDifference;
    }
    return (right.lastSeen ?? "").localeCompare(left.lastSeen ?? "");
  });
}

function renderCandidate(candidate: LinkCandidate, withSnippets: boolean): string {
  const signalSummary = Object.entries(candidate.signals)
    .map(([signal, count]) => `${signal} x${count}`)
    .join(", ");
  const titlePart = candidate.title === undefined ? "" : ` "${candidate.title}"`;
  let entry = `\n- id: ${linkKey(candidate)}${titlePart}\n  signals: ${signalSummary}`;
  if (withSnippets) {
    for (const snippet of candidate.snippets) {
      entry += `\n  > ${snippet.replace(/\s+/g, " ")}`;
    }
  }
  return entry;
}

function validateVerdict(rawVerdict: unknown): { key: string; verdict: JudgeVerdict } | undefined {
  if (typeof rawVerdict !== "object" || rawVerdict === null) {
    return undefined;
  }
  const { id, role, stillRelevant, label, parentId } = rawVerdict as Record<string, unknown>;
  if (typeof id !== "string" || typeof role !== "string" || !JUDGED_ROLES.has(role)) {
    return undefined;
  }
  const trimmedLabel = typeof label === "string" ? label.trim() : "";
  return {
    key: id,
    verdict: {
      role: role as JudgedRole,
      stillRelevant: stillRelevant !== false,
      label: trimmedLabel === "" ? undefined : clipText(trimmedLabel, MAX_LABEL_LENGTH),
      parentKey: typeof parentId === "string" && parentId.trim() !== "" ? parentId.trim() : undefined,
    },
  };
}

function parseResultText(resultText: unknown): unknown {
  if (typeof resultText !== "string") {
    return undefined;
  }
  try {
    return JSON.parse(resultText);
  } catch {
    return undefined;
  }
}

function judgedRoleRank(role: JudgedRole): number {
  return JUDGED_ROLE_RANK[role];
}

function clipText(text: string, maxLength: number): string {
  const singleLineText = text.replace(/\s+/g, " ").trim();
  return singleLineText.length <= maxLength ? singleLineText : `${singleLineText.slice(0, maxLength - 1)}…`;
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}
