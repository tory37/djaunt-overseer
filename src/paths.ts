import * as os from "os";
import * as path from "path";

export function defaultClaudeHome(): string {
  return path.join(os.homedir(), ".claude");
}

export function projectsDir(claudeHome: string): string {
  return path.join(claudeHome, "projects");
}

// Claude names each project folder after the session's cwd with every non-alphanumeric character turned into '-'.
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

export function tildePath(absolutePath: string): string {
  const homeDir = os.homedir();
  return absolutePath.startsWith(homeDir) ? "~" + absolutePath.slice(homeDir.length) : absolutePath;
}
