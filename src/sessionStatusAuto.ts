import { clipReason, resolveStatusOption, StatusOption, TicketStatusFact } from "./sessionStatusSync";

export interface AutoStatusContext {
  title: string;
  options: StatusOption[];
  tickets: TicketStatusFact[];
}

export interface AutoStatusResult {
  statusId: string;
  reason?: string;
}

const AUTO_STATUS_SYSTEM_PROMPT = `You set the overall status of one Claude Code session. The session works on Jira tickets. You get the user's status options and each ticket's Jira status.
Reply with only this JSON, no markdown:
{"statusId":"<an id from the options>","reason":"<one short line>"}
Rules:
- The session status is an overall watcher. Pick the option that matches where the whole session is.
- One ticket: mirror it. Pick the option closest in meaning to the ticket's Jira status.
- Several tickets: condense. The session is only as far along as its least advanced open ticket. Example: one ticket in peer review, one ready for QA, one in progress means the session is in progress.
- Tickets that are done or closed do not hold the session back. If every ticket is done, pick the most finished option.
- If any ticket is blocked and an option means blocked, pick it.
- Match by meaning, not spelling. The options and Jira statuses use different words.
- reason: always give one short line naming the tickets that decided it.`;

export function autoStatusArgs(model: string): string[] {
  return [
    "-p",
    "--model", model,
    "--effort", "low",
    "--output-format", "json",
    "--no-session-persistence",
    "--tools", "",
    "--strict-mcp-config",
    "--setting-sources", "",
    "--settings", JSON.stringify({ alwaysThinkingEnabled: false }),
    "--system-prompt", AUTO_STATUS_SYSTEM_PROMPT,
  ];
}

export function buildAutoStatusDigest(context: AutoStatusContext): string {
  const optionLines = context.options.map((option) => `- ${option.id}: ${option.name}`);
  const ticketLines = context.tickets.map(
    (ticket) => `- ${ticket.key}: ${ticket.status}${ticket.summary === undefined ? "" : ` (${ticket.summary})`}`,
  );
  return ["Session title: " + context.title, "", "Status options:", ...optionLines, "", "Tickets:", ...ticketLines].join("\n");
}

// Throws when the run failed or named a status that is not an option, so a bad answer never lands on a session.
export function parseAutoStatusOutput(stdout: string, options: StatusOption[]): AutoStatusResult {
  const envelope = JSON.parse(stdout) as { is_error?: boolean; result?: unknown };
  if (envelope.is_error || typeof envelope.result !== "string") {
    throw new Error(`status run failed: ${String(envelope.result)}`);
  }
  const resultText = envelope.result;
  const jsonStart = resultText.indexOf("{");
  const jsonEnd = resultText.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd < jsonStart) {
    throw new Error("status run returned no JSON");
  }
  const { statusId, reason } = JSON.parse(resultText.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>;
  const option = typeof statusId === "string" ? resolveStatusOption(options, statusId) : undefined;
  if (option === undefined) {
    throw new Error(`status run named an unknown status: ${String(statusId)}`);
  }
  return { statusId: option.id, ...(typeof reason === "string" && reason.trim() !== "" ? { reason: clipReason(reason) } : {}) };
}
