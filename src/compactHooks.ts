import * as fs from "fs";
import * as path from "path";

// Claude Code runs these hooks around every compaction; each one gets the session_id on stdin.
const COMPACT_HOOK_EVENTS = ["PreCompact", "PostCompact"] as const;
const HOOK_SCRIPT_NAME = "compact-hook.sh";
const OVERSEER_DIR_NAME = "overseer";
const MARKER_DIR_NAME = "compacting";
// A crash mid-compaction never runs PostCompact, so an old marker is ignored instead of leaving the icon stuck.
export const MAX_MARKER_AGE_MS = 10 * 60_000;

type HookEntry = { type?: unknown; command?: unknown };
type HookMatcher = { matcher?: unknown; hooks?: unknown };
export type ClaudeSettings = Record<string, unknown>;

export interface CompactHookPaths {
  settingsFile: string;
  scriptFile: string;
  markerDir: string;
}

export function compactHookPaths(claudeHome: string): CompactHookPaths {
  const overseerDir = path.join(claudeHome, OVERSEER_DIR_NAME);
  return {
    settingsFile: path.join(claudeHome, "settings.json"),
    scriptFile: path.join(overseerDir, HOOK_SCRIPT_NAME),
    markerDir: path.join(overseerDir, MARKER_DIR_NAME),
  };
}

// No jq or node: the script has to run from any shell Claude Code starts.
export function hookScript(markerDir: string): string {
  return `#!/bin/sh
# Written by the Overseer VS Code extension. Marks a Claude Code session as compacting.
marker_dir=${shellQuote(markerDir)}
session_id=$(tr -d '\\n' | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p')
case "$session_id" in ''|*/*|.*) exit 0 ;; esac
mkdir -p "$marker_dir"
if [ "$1" = start ]; then
  : > "$marker_dir/$session_id"
else
  rm -f "$marker_dir/$session_id"
fi
exit 0
`;
}

export function hookCommand(scriptFile: string, phase: "start" | "end"): string {
  return `sh ${shellQuote(scriptFile)} ${phase}`;
}

export function hasCompactHooks(settings: ClaudeSettings): boolean {
  return COMPACT_HOOK_EVENTS.every((eventName) => eventMatchers(settings, eventName).some(isOverseerMatcher));
}

// Replaces any earlier Overseer entry, so a reinstall never doubles the hook.
export function withCompactHooks(settings: ClaudeSettings, scriptFile: string): ClaudeSettings {
  const cleanedSettings = withoutCompactHooks(settings);
  const hooks = { ...hooksObject(cleanedSettings) };
  for (const eventName of COMPACT_HOOK_EVENTS) {
    const phase = eventName === "PreCompact" ? "start" : "end";
    const overseerMatcher = { hooks: [{ type: "command", command: hookCommand(scriptFile, phase) }] };
    hooks[eventName] = [...eventMatchers(cleanedSettings, eventName), overseerMatcher];
  }
  return { ...cleanedSettings, hooks };
}

// Leaves every other hook in place, and drops an event or the hooks key only when Overseer's entry was all it held.
export function withoutCompactHooks(settings: ClaudeSettings): ClaudeSettings {
  const hooks = { ...hooksObject(settings) };
  for (const eventName of COMPACT_HOOK_EVENTS) {
    const otherMatchers = eventMatchers(settings, eventName).filter((matcher) => !isOverseerMatcher(matcher));
    if (otherMatchers.length > 0) {
      hooks[eventName] = otherMatchers;
    } else {
      delete hooks[eventName];
    }
  }
  const { hooks: _previousHooks, ...otherSettings } = settings;
  return Object.keys(hooks).length > 0 ? { ...otherSettings, hooks } : otherSettings;
}

export function compactingSessionIds(markerDir: string, nowMs: number): Set<string> {
  const sessionIds = new Set<string>();
  let markerNames: string[];
  try {
    markerNames = fs.readdirSync(markerDir);
  } catch {
    return sessionIds;
  }
  for (const markerName of markerNames) {
    try {
      const markerAgeMs = nowMs - fs.statSync(path.join(markerDir, markerName)).mtimeMs;
      if (markerAgeMs <= MAX_MARKER_AGE_MS) {
        sessionIds.add(markerName);
      }
    } catch {
      // PostCompact removed it between the listing and the stat.
    }
  }
  return sessionIds;
}

function hooksObject(settings: ClaudeSettings): Record<string, unknown> {
  const hooks = settings.hooks;
  return typeof hooks === "object" && hooks !== null && !Array.isArray(hooks) ? (hooks as Record<string, unknown>) : {};
}

function eventMatchers(settings: ClaudeSettings, eventName: string): HookMatcher[] {
  const matchers = hooksObject(settings)[eventName];
  return Array.isArray(matchers) ? (matchers as HookMatcher[]) : [];
}

function isOverseerMatcher(matcher: HookMatcher): boolean {
  const hookEntries = Array.isArray(matcher?.hooks) ? (matcher.hooks as HookEntry[]) : [];
  return hookEntries.some(
    (hookEntry) => typeof hookEntry?.command === "string" && hookEntry.command.includes(`${OVERSEER_DIR_NAME}/${HOOK_SCRIPT_NAME}`),
  );
}

function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}
