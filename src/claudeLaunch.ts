export const OVERSEER_CLAUDE_HOME_ENV_VAR = "OVERSEER_CLAUDE_HOME";

export function quoteForShell(text: string): string {
  const singleLine = text.replace(/[\r\n]+/g, " ");
  return `'${singleLine.replace(/'/g, `'\\''`)}'`;
}

export function launchShellCommand(claudeCommand: string): string {
  return `exec ${claudeCommand}`;
}
