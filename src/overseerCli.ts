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
import {
  AGENT_WORK_SCHEMA_VERSION,
  declaredWorkFile,
  formatWorkList,
  normalizeArtifactParentKey,
  normalizeArtifactUrl,
  normalizeCommitHash,
  normalizePullRequestUrl,
  readSessionWork,
  SessionWork,
  withDeclaredArtifact,
  withDeclaredCommit,
  withDeclaredPullRequest,
  withoutDeclaredArtifact,
  withoutDeclaredCommit,
  withoutDeclaredPullRequest,
} from "./agentWork";
import {
  AGENT_TRACKER_SCHEMA_VERSION,
  formatWhereShow,
  readSessionWhere,
  whereFile,
  withWhereDone,
  withWhereLines,
} from "./agentTracker";
import { loadVersionedCache, saveVersionedCache } from "./linkCache";
import {
  clipReason,
  doneStatusOption,
  formatStatusList,
  readStatusContext,
  readStatusOptions,
  resolveStatusOption,
  StatusOption,
  STATUS_SYNC_SCHEMA_VERSION,
  statusContextFile,
  statusOptionsFile,
  statusRequestFile,
} from "./sessionStatusSync";

export const OVERSEER_USAGE = `overseer: tell the Overseer VS Code extension about this Claude session.

Usage:
  overseer ticket add <KEY> [--note "<what you are doing>"]
      Declare a Jira ticket this session is working on (implementing, fixing, test-planning).
      Do not declare tickets you only read for context.
  overseer ticket remove <KEY>
      Undeclare a ticket you declared by mistake.
  overseer ticket list
      Show this session's tickets, including the ones the user pinned or removed in the panel.
  overseer commit add <HASH> [--note "<what it does>"]
      Declare a commit this session made. Run it right after the commit.
  overseer pr add <URL> [--note "<what it does>"]
      Declare a GitHub pull request this session opened or pushed to.
  overseer artifact add <URL> [--note "<what it is>"] [--parent <TICKET KEY | PR URL>]
      Declare a claude.ai artifact this session published or updated.
  overseer commit remove <HASH> / overseer pr remove <URL> / overseer artifact remove <URL>
      Undeclare one you declared by mistake.
  overseer commit list / overseer pr list / overseer artifact list
      Show this session's declared commits, pull requests, and artifacts.
  overseer status list
      Show the status options, the session's current status, and its tickets' Jira statuses.
  overseer status set <ID> [--reason "<why>"]
      Set the session's overall status. It is an overall watcher: with one ticket, mirror it;
      with several, condense them into where the whole session stands.
  overseer where set "<line>" ["<line>" ...]
      Replace this session's tracker lines: up to 3, 100 characters each, present state only.
  overseer where show
      Show this session's tracker lines.
  overseer done [--reason "<why>"]
      Mark the work completely done: strikes the tracker entry and sets the done status.

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
  const isDoneCommand = area === "done";
  const isKnownArea = area === "ticket" || area === "status" || area === "where" || isWorkArea(area);
  if (!isDoneCommand && (!isKnownArea || action === undefined)) {
    return usageFailure(`Unknown command: ${args.join(" ")}`);
  }

  const sessionId = env.CLAUDE_CODE_SESSION_ID || env.OVERSEER_SESSION_ID;
  if (sessionId === undefined || !isSafeSessionId(sessionId)) {
    return { exitCode: EXIT_FAILURE, output: "No Claude session found: CLAUDE_CODE_SESSION_ID is not set." };
  }

  if (isDoneCommand) {
    return runDoneCommand(args.slice(1), claudeHome, sessionId, now);
  }
  if (area === "status") {
    return runStatusCommand(action, rest, claudeHome, sessionId);
  }
  if (area === "where") {
    return runWhereCommand(action, rest, whereFile(claudeHome, sessionId), now);
  }
  if (isWorkArea(area)) {
    return runWorkCommand(area, action, rest, declaredWorkFile(claudeHome, sessionId), now);
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

async function runStatusCommand(action: string, rest: string[], claudeHome: string, sessionId: string): Promise<CliResult> {
  const options = readStatusOptions(await loadVersionedCache<unknown>(statusOptionsFile(claudeHome), STATUS_SYNC_SCHEMA_VERSION));
  if (action === "list") {
    const context = readStatusContext(await loadVersionedCache<unknown>(statusContextFile(claudeHome, sessionId), STATUS_SYNC_SCHEMA_VERSION));
    return { exitCode: EXIT_OK, output: formatStatusList(options, context) };
  }
  if (action !== "set") {
    return usageFailure(`Unknown status action: ${action}`);
  }
  const [requested, ...optionWords] = rest;
  if (requested === undefined) {
    return usageFailure("Missing status.");
  }
  const { note: reason, error } = parseOption(optionWords, "--reason");
  if (error !== undefined) {
    return usageFailure(error);
  }
  const option = resolveStatusOption(options, requested);
  if (option === undefined) {
    return { exitCode: EXIT_FAILURE, output: `Not a status: ${requested}\n${formatStatusList(options, { tickets: [] })}` };
  }
  await saveStatusRequest(claudeHome, sessionId, option, reason);
  return { exitCode: EXIT_OK, output: `Set the session status to ${option.name}.` };
}

async function saveStatusRequest(claudeHome: string, sessionId: string, option: StatusOption, reason: string | undefined): Promise<void> {
  const request = { statusId: option.id, ...(reason === undefined ? {} : { reason: clipReason(reason) }) };
  await saveVersionedCache(statusRequestFile(claudeHome, sessionId), request, STATUS_SYNC_SCHEMA_VERSION);
}

async function runWhereCommand(action: string, rest: string[], trackerFile: string, now: number): Promise<CliResult> {
  const where = readSessionWhere(await loadVersionedCache<unknown>(trackerFile, AGENT_TRACKER_SCHEMA_VERSION));
  if (action === "show" && rest.length === 0) {
    return { exitCode: EXIT_OK, output: formatWhereShow(where) };
  }
  if (action !== "set") {
    return usageFailure(`Unknown where action: ${[action, ...rest].join(" ")}`);
  }
  const updatedWhere = withWhereLines(rest, now);
  if (updatedWhere.lines.length === 0) {
    return usageFailure("Missing tracker line.");
  }
  await saveVersionedCache(trackerFile, updatedWhere, AGENT_TRACKER_SCHEMA_VERSION);
  return { exitCode: EXIT_OK, output: formatWhereShow(updatedWhere) };
}

async function runDoneCommand(optionWords: string[], claudeHome: string, sessionId: string, now: number): Promise<CliResult> {
  const { note: reason, error } = parseOption(optionWords, "--reason");
  if (error !== undefined) {
    return usageFailure(error);
  }
  const options = readStatusOptions(await loadVersionedCache<unknown>(statusOptionsFile(claudeHome), STATUS_SYNC_SCHEMA_VERSION));
  const doneOption = doneStatusOption(options);
  if (doneOption === undefined) {
    return { exitCode: EXIT_FAILURE, output: "No status is marked done. The user can mark one in Overseer's status settings." };
  }
  const trackerFile = whereFile(claudeHome, sessionId);
  const where = readSessionWhere(await loadVersionedCache<unknown>(trackerFile, AGENT_TRACKER_SCHEMA_VERSION));
  await saveVersionedCache(trackerFile, withWhereDone(where, now), AGENT_TRACKER_SCHEMA_VERSION);
  await saveStatusRequest(claudeHome, sessionId, doneOption, reason);
  return { exitCode: EXIT_OK, output: `Marked the work done and set the session status to ${doneOption.name}.` };
}

const WORK_ITEMS = {
  commit: { normalize: normalizeCommitHash, invalid: "Not a commit hash", addFlags: ["--note"] },
  pr: { normalize: normalizePullRequestUrl, invalid: "Not a GitHub pull request URL", addFlags: ["--note"] },
  artifact: { normalize: normalizeArtifactUrl, invalid: "Not a claude.ai artifact URL", addFlags: ["--note", "--parent"] },
};

type WorkArea = keyof typeof WORK_ITEMS;

function isWorkArea(area: string): area is WorkArea {
  return Object.hasOwn(WORK_ITEMS, area);
}

async function runWorkCommand(area: WorkArea, action: string, rest: string[], workFile: string, now: number): Promise<CliResult> {
  const work = readSessionWork(await loadVersionedCache<unknown>(workFile, AGENT_WORK_SCHEMA_VERSION));
  if (action === "list") {
    return { exitCode: EXIT_OK, output: formatWorkList(work) };
  }
  if (action !== "add" && action !== "remove") {
    return usageFailure(`Unknown ${area} action: ${action}`);
  }
  const { normalize, invalid, addFlags } = WORK_ITEMS[area];
  const [rawId, ...options] = rest;
  const id = rawId === undefined ? undefined : normalize(rawId);
  if (id === undefined) {
    return usageFailure(`${invalid}: ${rawId ?? "(missing)"}`);
  }
  const { values, error } = parseFlagOptions(options, action === "add" ? addFlags : []);
  if (error !== undefined) {
    return usageFailure(error);
  }
  const rawParentKey = values["--parent"];
  const parentKey = rawParentKey === undefined ? undefined : normalizeArtifactParentKey(rawParentKey);
  if (rawParentKey !== undefined && parentKey === undefined) {
    return usageFailure(`Not a Jira ticket key or GitHub pull request URL: ${rawParentKey}`);
  }
  const updatedWork = updatedSessionWork(work, area, action, id, values["--note"], parentKey, now);
  await saveVersionedCache(workFile, updatedWork, AGENT_WORK_SCHEMA_VERSION);
  const verb = action === "add" ? "Declared" : "Removed";
  return { exitCode: EXIT_OK, output: `${verb} ${id}.\n${formatWorkList(updatedWork)}` };
}

function updatedSessionWork(
  work: SessionWork,
  area: WorkArea,
  action: "add" | "remove",
  id: string,
  note: string | undefined,
  parentKey: string | undefined,
  now: number,
): SessionWork {
  if (area === "commit") {
    return action === "add" ? withDeclaredCommit(work, id, note, now) : withoutDeclaredCommit(work, id);
  }
  if (area === "artifact") {
    return action === "add" ? withDeclaredArtifact(work, id, note, now, parentKey) : withoutDeclaredArtifact(work, id);
  }
  return action === "add" ? withDeclaredPullRequest(work, id, note, now) : withoutDeclaredPullRequest(work, id);
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
  return { key, ...parseNoteOption(options, allowsNote) };
}

function parseNoteOption(options: string[], allowsNote: boolean): { note?: string; error?: string } {
  return allowsNote ? parseOption(options, "--note") : parseOption(options, undefined);
}

function parseOption(options: string[], flag: string | undefined): { note?: string; error?: string } {
  if (options.length === 0) {
    return {};
  }
  const [optionName, ...noteWords] = options;
  if (flag === undefined || optionName !== flag || noteWords.length === 0) {
    return { error: `Unexpected arguments: ${options.join(" ")}` };
  }
  return { note: noteWords.join(" ").replace(/\s+/g, " ").trim() };
}

// Each flag's value runs until the next allowed flag, so notes need no quoting.
function parseFlagOptions(options: string[], allowedFlags: string[]): { values: Record<string, string>; error?: string } {
  const values: Record<string, string> = {};
  let index = 0;
  while (index < options.length) {
    const flag = options[index];
    const valueWords: string[] = [];
    index += 1;
    while (index < options.length && !allowedFlags.includes(options[index])) {
      valueWords.push(options[index]);
      index += 1;
    }
    const isRepeatedFlag = values[flag] !== undefined;
    if (!allowedFlags.includes(flag) || isRepeatedFlag || valueWords.length === 0) {
      return { values: {}, error: `Unexpected arguments: ${options.join(" ")}` };
    }
    values[flag] = valueWords.join(" ").replace(/\s+/g, " ").trim();
  }
  return { values };
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
