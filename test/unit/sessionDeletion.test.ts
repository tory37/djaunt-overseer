import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteSessionFiles, findSessionFiles, withoutSessionLines } from "../../src/sessionDeletion";

const DOOMED_ID = "0b3c1d52-7a8e-4f1e-9c2a-5d6e7f8a9b0c";
const KEPT_ID = "1c4d2e63-8b9f-4a2f-8d3b-6e7f8a9b0c1d";

let claudeHome: string;
let projectDir: string;

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function historyLine(sessionId: string, prompt: string): string {
  return JSON.stringify({ display: prompt, sessionId });
}

beforeEach(() => {
  claudeHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "overseer-delete-")));
  projectDir = path.join(claudeHome, "projects", "-src-web");
  for (const sessionId of [DOOMED_ID, KEPT_ID]) {
    writeFile(path.join(projectDir, `${sessionId}.jsonl`), "{}\n");
    writeFile(path.join(projectDir, sessionId, "subagents", "agent.jsonl"), "{}\n");
    writeFile(path.join(claudeHome, "file-history", sessionId, "backup"), "x");
    writeFile(path.join(claudeHome, "session-env", sessionId, "env"), "x");
  }
  writeFile(
    path.join(claudeHome, "history.jsonl"),
    [historyLine(DOOMED_ID, "a"), historyLine(KEPT_ID, "b"), "not json", historyLine(DOOMED_ID, "c")].join("\n") + "\n",
  );
});

afterEach(() => {
  fs.rmSync(claudeHome, { recursive: true, force: true });
});

describe("session deletion", () => {
  it("finds the transcript and every folder named by the session", async () => {
    const sessionFiles = await findSessionFiles(claudeHome, DOOMED_ID, path.join(projectDir, `${DOOMED_ID}.jsonl`));

    expect(sessionFiles.paths.map((sessionPath) => path.relative(claudeHome, sessionPath))).toEqual([
      `projects/-src-web/${DOOMED_ID}.jsonl`,
      `projects/-src-web/${DOOMED_ID}`,
      `file-history/${DOOMED_ID}`,
      `session-env/${DOOMED_ID}`,
    ]);
    expect(sessionFiles.sizeBytes).toBe(8);
  });

  it("finds nothing for a bad id or a transcript outside the projects folder", async () => {
    expect((await findSessionFiles(claudeHome, "../../etc", path.join(projectDir, "x.jsonl"))).paths).toEqual([]);
    expect((await findSessionFiles(claudeHome, DOOMED_ID, path.join(claudeHome, `${DOOMED_ID}.jsonl`))).paths).toEqual([]);
  });

  it("deletes one session's files and prompt history, and keeps the others", async () => {
    const sessionFiles = await findSessionFiles(claudeHome, DOOMED_ID, path.join(projectDir, `${DOOMED_ID}.jsonl`));

    const result = await deleteSessionFiles(claudeHome, [sessionFiles]);

    expect(result).toEqual({ deletedIds: [DOOMED_ID], failures: [], removedHistoryLineCount: 2 });
    sessionFiles.paths.forEach((sessionPath) => expect(fs.existsSync(sessionPath)).toBe(false));
    expect(fs.existsSync(path.join(projectDir, `${KEPT_ID}.jsonl`))).toBe(true);
    expect(fs.existsSync(path.join(claudeHome, "file-history", KEPT_ID))).toBe(true);
    expect(fs.readFileSync(path.join(claudeHome, "history.jsonl"), "utf8")).toBe(`${historyLine(KEPT_ID, "b")}\nnot json\n`);
  });

  it("keeps lines it can't parse", () => {
    expect(withoutSessionLines("garbage\n", new Set([DOOMED_ID]))).toEqual({ text: "garbage\n", removedLineCount: 0 });
  });
});
