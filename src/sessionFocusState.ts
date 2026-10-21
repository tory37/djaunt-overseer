export type SessionFocusSource = "terminal" | "preview";

export interface SessionFocus {
  sessionId: string;
  source: SessionFocusSource;
}

export type SessionFocusEvent =
  | { kind: "terminal"; sessionId: string | undefined }
  | { kind: "preview"; sessionId: string }
  | { kind: "otherTab" };

// A file or other tab keeps the last session, so the panel stays useful while the user reads code.
export function nextSessionFocus(current: SessionFocus | undefined, event: SessionFocusEvent): SessionFocus | undefined {
  switch (event.kind) {
    case "terminal":
      return event.sessionId === undefined ? undefined : { sessionId: event.sessionId, source: "terminal" };
    case "preview":
      return { sessionId: event.sessionId, source: "preview" };
    case "otherTab":
      return current;
  }
}

export function isSameSessionFocus(first: SessionFocus | undefined, second: SessionFocus | undefined): boolean {
  return first?.sessionId === second?.sessionId && first?.source === second?.source;
}
