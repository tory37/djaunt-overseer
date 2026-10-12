import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import {
  compactHookPaths,
  compactingSessionIds,
  hasCompactHooks,
  hookCommand,
  hookScript,
  MAX_MARKER_AGE_MS,
  withCompactHooks,
  withoutCompactHooks,
} from "../../src/compactHooks";

const SCRIPT_FILE = "/home/me/.claude/overseer/compact-hook.sh";
const OTHER_PRE_COMPACT = { matcher: "auto", hooks: [{ type: "command", command: "echo mine" }] };

describe("compact hook settings", () => {
  it("adds both hooks once and keeps the user's own hooks and settings", () => {
    const settings = { model: "opus", hooks: { PreCompact: [OTHER_PRE_COMPACT], Stop: [] } };
    const installed = withCompactHooks(withCompactHooks(settings, SCRIPT_FILE), SCRIPT_FILE);

    expect(hasCompactHooks(settings)).toBe(false);
    expect(hasCompactHooks(installed)).toBe(true);
    expect(installed).toEqual({
      model: "opus",
      hooks: {
        PreCompact: [OTHER_PRE_COMPACT, { hooks: [{ type: "command", command: hookCommand(SCRIPT_FILE, "start") }] }],
        PostCompact: [{ hooks: [{ type: "command", command: hookCommand(SCRIPT_FILE, "end") }] }],
        Stop: [],
      },
    });
  });

  it("removes only Overseer's entries and drops empty events", () => {
    const installed = withCompactHooks({ hooks: { PreCompact: [OTHER_PRE_COMPACT] } }, SCRIPT_FILE);
    expect(withoutCompactHooks(installed)).toEqual({ hooks: { PreCompact: [OTHER_PRE_COMPACT] } });
    expect(withoutCompactHooks(withCompactHooks({}, SCRIPT_FILE))).toEqual({});
  });

  it("treats a malformed hooks value as empty", () => {
    expect(hasCompactHooks({ hooks: "nope" })).toBe(false);
    expect(hasCompactHooks(withCompactHooks({ hooks: [] }, SCRIPT_FILE))).toBe(true);
  });
});

describe("compact hook script", () => {
  it("creates the marker on start and deletes it on end", () => {
    const claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), "overseer-compact-"));
    const paths = compactHookPaths(claudeHome);
    fs.mkdirSync(path.dirname(paths.scriptFile), { recursive: true });
    fs.writeFileSync(paths.scriptFile, hookScript(paths.markerDir));
    const hookInput = JSON.stringify({ session_id: "abc-123", hook_event_name: "PreCompact", trigger: "manual" });

    execFileSync("sh", [paths.scriptFile, "start"], { input: hookInput });
    expect([...compactingSessionIds(paths.markerDir, Date.now())]).toEqual(["abc-123"]);
    execFileSync("sh", [paths.scriptFile, "end"], { input: hookInput });
    expect(compactingSessionIds(paths.markerDir, Date.now()).size).toBe(0);
    execFileSync("sh", [paths.scriptFile, "start"], { input: '{"session_id":"../escape"}' });
    expect(fs.existsSync(path.join(claudeHome, "overseer", "escape"))).toBe(false);
  });

  it("ignores a marker older than the cutoff and a missing folder", () => {
    const markerDir = fs.mkdtempSync(path.join(os.tmpdir(), "overseer-markers-"));
    fs.writeFileSync(path.join(markerDir, "stale"), "");
    const nowMs = fs.statSync(path.join(markerDir, "stale")).mtimeMs + MAX_MARKER_AGE_MS + 1;
    expect(compactingSessionIds(markerDir, nowMs).size).toBe(0);
    expect(compactingSessionIds(path.join(markerDir, "missing"), nowMs).size).toBe(0);
  });
});
