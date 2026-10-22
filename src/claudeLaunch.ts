import * as path from "path";

export const OVERSEER_NODE_ENV_VAR = "OVERSEER_NODE";
export const OVERSEER_CLAUDE_HOME_ENV_VAR = "OVERSEER_CLAUDE_HOME";
const OVERSEER_ALLOWED_TOOL = "Bash(overseer *)";
const OVERSEER_DIR_NAME = "overseer";
const STABLE_LINK_NAME = "current";

// Where the overseer CLI and its Claude plugin live: the stable link, or the versioned extension folder as a fallback.
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

// VS Code deletes an old extension folder on update, so running sessions reach the CLI and plugin through this link.
export function stableExtensionLink(claudeHome: string): string {
  return path.join(claudeHome, OVERSEER_DIR_NAME, STABLE_LINK_NAME);
}

export interface StableLinkTarget {
  targetDir: string;
  // Undefined when the target folder or its package.json is gone.
  version: string | undefined;
}

// Compares dotted numeric versions and ignores any prerelease suffix.
export function compareVersions(left: string, right: string): number {
  const leftParts = versionNumbers(left);
  const rightParts = versionNumbers(right);
  const partCount = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < partCount; index++) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }
  return 0;
}

function versionNumbers(version: string): number[] {
  const releasePart = version.trim().split(/[-+]/)[0];
  return releasePart.split(".").map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  });
}

// Never moves the link back to an older extension that another window still runs.
export function shouldRepointStableLink(
  currentTarget: StableLinkTarget | undefined,
  extensionDir: string,
  extensionVersion: string,
): boolean {
  if (currentTarget === undefined || currentTarget.version === undefined) {
    return true;
  }
  if (path.resolve(currentTarget.targetDir) === path.resolve(extensionDir)) {
    return false;
  }
  return compareVersions(currentTarget.version, extensionVersion) <= 0;
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
