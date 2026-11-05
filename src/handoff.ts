import * as path from "path";
import { moveBeside } from "./reorder";

const OVERSEER_DIR_NAME = "overseer";
const HANDOFFS_DIR_NAME = "handoffs";
const DRAFTS_DIR_NAME = "drafts";
const HANDOFF_EXTENSION = ".md";
const DRAFT_FILE_PATTERN = /^([A-Za-z0-9-]+)\.md$/;

const HANDOFF_INSTRUCTIONS =
  "Write a handoff document so a fresh agent with no context can continue this work. " +
  "Cover: the goal, the current state, what is done, what is left and the next steps, " +
  "the key files with their paths, the decisions made and why, and open questions or gotchas. " +
  "Do not start new work.";

export function handoffsDir(claudeHome: string): string {
  return path.join(claudeHome, OVERSEER_DIR_NAME, HANDOFFS_DIR_NAME);
}

export function handoffDraftsDir(claudeHome: string): string {
  return path.join(handoffsDir(claudeHome), DRAFTS_DIR_NAME);
}

export function handoffDraftFile(claudeHome: string, sourceSessionId: string): string {
  return path.join(handoffDraftsDir(claudeHome), `${sourceSessionId}${HANDOFF_EXTENSION}`);
}

export function approvedHandoffFile(claudeHome: string, newSessionId: string): string {
  return path.join(handoffsDir(claudeHome), `${newSessionId}${HANDOFF_EXTENSION}`);
}

// The file name carries the source session, so a draft opened after a reload still knows where to send revisions.
export function draftSourceSessionId(claudeHome: string, draftPath: string): string | undefined {
  if (path.dirname(draftPath) !== handoffDraftsDir(claudeHome)) {
    return undefined;
  }
  return DRAFT_FILE_PATTERN.exec(path.basename(draftPath))?.[1];
}

// Enter inside a Claude input sends the prompt early, so every prompt is one line.
function singleLine(text: string): string {
  return text.replace(/[\r\n]+/g, " ").trim();
}

export function writeHandoffPrompt(draftPath: string, extraRules: string): string {
  const rules = singleLine(extraRules);
  const rulesSentence = rules === "" ? "" : ` Extra rules: ${rules}`;
  return singleLine(
    `${HANDOFF_INSTRUCTIONS} Write it only to ${draftPath}, and overwrite that file if it exists.${rulesSentence}`,
  );
}

export function reviseHandoffPrompt(draftPath: string, feedback: string): string {
  return singleLine(`Revise the handoff document at ${draftPath} per this feedback: ${singleLine(feedback)} Overwrite the same file.`);
}

export function handoffSeedPrompt(approvedPath: string): string {
  return singleLine(`Read the handoff at ${approvedPath} and continue the work it describes.`);
}

// The saved order for the whole tree, with the new session right below the source in the source's group.
export function sessionOrderWithBelow(
  savedOrder: string[],
  displayedGroupSessionIds: string[],
  sourceSessionId: string,
  newSessionId: string,
): string[] {
  if (!displayedGroupSessionIds.includes(sourceSessionId)) {
    return savedOrder;
  }
  // Starting the new id above the source makes moveBeside read it as a drag down, which lands it after the source.
  const groupWithNewFirst = [newSessionId, ...displayedGroupSessionIds.filter((sessionId) => sessionId !== newSessionId)];
  const reorderedGroupIds = moveBeside(groupWithNewFirst, [newSessionId], sourceSessionId);
  const otherOrderedIds = savedOrder.filter((sessionId) => !reorderedGroupIds.includes(sessionId));
  return [...otherOrderedIds, ...reorderedGroupIds];
}
