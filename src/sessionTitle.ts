import { findTicketKeysInText } from "./ticket";

export type SessionTitleSource = "locked" | "analyzer" | "label" | "index";

export interface SessionTitleSources {
  label: string | undefined;
  isLocked: boolean;
  analyzerTitle: string | undefined;
  indexedTitle: string | undefined;
}

export interface ShownSessionTitle {
  text: string;
  source: SessionTitleSource;
}

// A label the user locked wins; a launch-time label only shows until the analyzer names the session.
export function shownSessionTitle({ label, isLocked, analyzerTitle, indexedTitle }: SessionTitleSources): ShownSessionTitle | undefined {
  if (isLocked && label !== undefined) {
    return { text: label, source: "locked" };
  }
  if (analyzerTitle !== undefined) {
    return { text: analyzerTitle, source: "analyzer" };
  }
  if (label !== undefined) {
    return { text: label, source: "label" };
  }
  return indexedTitle === undefined ? undefined : { text: indexedTitle, source: "index" };
}

export function hiddenLabelTicketKeys(label: string | undefined, shownTitle: string): string[] {
  if (label === undefined) {
    return [];
  }
  const shownTicketKeys = new Set(findTicketKeysInText(shownTitle));
  return findTicketKeysInText(label).filter((ticketKey) => !shownTicketKeys.has(ticketKey));
}
