import {
  AGENT_TICKETS_SCHEMA_VERSION,
  declaredTicketsFile,
  DeclaredTicket,
  formatTicketList,
  isSafeSessionId,
  normalizeTicketKey,
  readDeclaredTickets,
  readUserTicketMarks,
  userTicketMarksFile,
  withDeclaredTicket,
  withoutDeclaredTicket,
} from "./agentTickets";
import { loadVersionedCache, saveVersionedCache } from "./linkCache";

export const OVERSEER_USAGE = `overseer: tell the Overseer VS Code extension about this Claude session.

Usage:
  overseer ticket add <KEY> [--note "<what you are doing>"]
      Declare a Jira ticket this session is working on (implementing, fixing, test-planning).
      Do not declare tickets you only read for context.
  overseer ticket remove <KEY>
      Undeclare a ticket you declared by mistake.
  overseer ticket list
      Show this session's tickets, including the ones the user pinned or removed in the panel.

The session comes from CLAUDE_CODE_SESSION_ID, or OVERSEER_SESSION_ID when that is unset.`;

export interface CliResult {
  exitCode: number;
  output: string;
}

const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;

export async function runOverseerCli(
  args: string[],
  env: Record<string, string | undefined>,
  claudeHome: string,
  now: number = Date.now(),
): Promise<CliResult> {
  const [area, action, ...rest] = args;
  if (area === undefined || area === "--help" || area === "-h" || area === "help") {
    return { exitCode: EXIT_OK, output: OVERSEER_USAGE };
  }
  if (area !== "ticket" || action === undefined) {
    return usageFailure(`Unknown command: ${args.join(" ")}`);
  }

  const sessionId = env.CLAUDE_CODE_SESSION_ID || env.OVERSEER_SESSION_ID;
  if (sessionId === undefined || !isSafeSessionId(sessionId)) {
    return { exitCode: EXIT_FAILURE, output: "No Claude session found: CLAUDE_CODE_SESSION_ID is not set." };
  }

  const ticketsFile = declaredTicketsFile(claudeHome, sessionId);
  const declaredTickets = readDeclaredTickets(await loadVersionedCache<unknown>(ticketsFile, AGENT_TICKETS_SCHEMA_VERSION));

  switch (action) {
    case "add":
    case "remove": {
      const { key, note, error } = parseTicketArguments(rest, action === "add");
      if (error !== undefined) {
        return usageFailure(error);
      }
      const updatedTickets =
        action === "add" ? withDeclaredTicket(declaredTickets, key, note, now) : withoutDeclaredTicket(declaredTickets, key);
      await saveDeclaredTickets(ticketsFile, updatedTickets);
      const verb = action === "add" ? "Declared" : "Removed";
      return { exitCode: EXIT_OK, output: `${verb} ${key}.\n${await ticketListText(claudeHome, sessionId, updatedTickets)}` };
    }
    case "list":
      return { exitCode: EXIT_OK, output: await ticketListText(claudeHome, sessionId, declaredTickets) };
    default:
      return usageFailure(`Unknown ticket action: ${action}`);
  }
}

interface TicketArguments {
  key: string;
  note?: string;
  error?: string;
}

function parseTicketArguments(rest: string[], allowsNote: boolean): TicketArguments {
  const [rawKey, ...options] = rest;
  const key = rawKey === undefined ? undefined : normalizeTicketKey(rawKey);
  if (key === undefined) {
    return { key: "", error: `Not a Jira ticket key: ${rawKey ?? "(missing)"}` };
  }
  if (options.length === 0) {
    return { key };
  }
  const [optionName, ...noteWords] = options;
  if (!allowsNote || optionName !== "--note" || noteWords.length === 0) {
    return { key, error: `Unexpected arguments: ${options.join(" ")}` };
  }
  return { key, note: noteWords.join(" ").replace(/\s+/g, " ").trim() };
}

async function ticketListText(claudeHome: string, sessionId: string, declaredTickets: DeclaredTicket[]): Promise<string> {
  const marksFile = userTicketMarksFile(claudeHome, sessionId);
  const userMarks = readUserTicketMarks(await loadVersionedCache<unknown>(marksFile, AGENT_TICKETS_SCHEMA_VERSION));
  return formatTicketList(declaredTickets, userMarks);
}

function saveDeclaredTickets(ticketsFile: string, declaredTickets: DeclaredTicket[]): Promise<void> {
  return saveVersionedCache(ticketsFile, declaredTickets, AGENT_TICKETS_SCHEMA_VERSION);
}

function usageFailure(message: string): CliResult {
  return { exitCode: EXIT_USAGE, output: `${message}\n\n${OVERSEER_USAGE}` };
}
