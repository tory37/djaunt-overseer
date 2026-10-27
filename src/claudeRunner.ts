import { execFile, ExecFileException } from "child_process";
import * as os from "os";

export type ClaudeRunner = (claudeArgs: string[], stdinText: string) => Promise<string>;

const HEADLESS_TIMEOUT_MS = 120_000;
const HEADLESS_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const MAX_FAILURE_OUTPUT_CHARS = 300;

// One-shot, tool-free, settings-free run; the reply arrives as a JSON envelope on stdout.
export function headlessClaudeArgs(model: string, systemPrompt: string, outputSchema: object): string[] {
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
    "--system-prompt", systemPrompt,
    "--json-schema", JSON.stringify(outputSchema),
  ];
}

// Headless runs start in the temp dir so no project CLAUDE.md rides along with the digest.
export function createClaudeRunner(claudeBinary: string): ClaudeRunner {
  return (claudeArgs, stdinText) =>
    new Promise((resolve, reject) => {
      const claudeProcess = execFile(
        claudeBinary,
        claudeArgs,
        { cwd: os.tmpdir(), timeout: HEADLESS_TIMEOUT_MS, maxBuffer: HEADLESS_MAX_BUFFER_BYTES },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`headless claude run failed: ${describeRunFailure(error, stdout, stderr)}`));
          } else {
            resolve(stdout);
          }
        },
      );
      claudeProcess.stdin?.end(stdinText);
    });
}

function describeRunFailure(error: ExecFileException, stdout: string, stderr: string): string {
  if (error.killed) {
    return `timed out after ${HEADLESS_TIMEOUT_MS / 1000}s`;
  }
  const output = (stderr.trim() || stdout.trim()).slice(0, MAX_FAILURE_OUTPUT_CHARS);
  const exitDescription = error.signal ? `signal ${error.signal}` : `exit code ${error.code}`;
  return output ? `${exitDescription}: ${output}` : exitDescription;
}
