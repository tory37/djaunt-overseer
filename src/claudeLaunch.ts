import * as path from "path";

export const OVERSEER_NODE_ENV_VAR = "OVERSEER_NODE";
export const OVERSEER_CLAUDE_HOME_ENV_VAR = "OVERSEER_CLAUDE_HOME";
const OVERSEER_ALLOWED_TOOL = "Bash(overseer *)";

// Where the overseer CLI and its Claude plugin live inside the installed extension.
export interface AgentIntegration {
  extensionDir: string;
  nodePath: string;
  claudeHome: string;
}

export function quoteForShell(text: string): string {
  const singleLine = text.replace(/[\r\n]+/g, " ");
  return `'${singleLine.replace(/'/g, `'\\''`)}'`;
}

export function overseerBinDir(extensionDir: string): string {
  return path.join(extensionDir, "bin");
}

export function overseerPluginDir(extensionDir: string): string {
  return path.join(extensionDir, "plugin");
}

// PATH is set inside the command, after the login shell's rc files, which may rewrite PATH.
export function shellCommandWithAgentIntegration(claudeCommand: string, integration: AgentIntegration | undefined): string {
  if (integration === undefined) {
    return `exec ${claudeCommand}`;
  }
  const binDir = quoteForShell(overseerBinDir(integration.extensionDir));
  const pluginDir = quoteForShell(overseerPluginDir(integration.extensionDir));
  const agentArguments = `--plugin-dir ${pluginDir} --allowedTools ${quoteForShell(OVERSEER_ALLOWED_TOOL)}`;
  return `export PATH=${binDir}:"$PATH"; exec ${claudeCommand} ${agentArguments}`;
}

export function agentIntegrationEnv(integration: AgentIntegration | undefined): Record<string, string> {
  if (integration === undefined) {
    return {};
  }
  return { [OVERSEER_NODE_ENV_VAR]: integration.nodePath, [OVERSEER_CLAUDE_HOME_ENV_VAR]: integration.claudeHome };
}
