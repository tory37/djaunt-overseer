import { OVERSEER_CLAUDE_HOME_ENV_VAR } from "./claudeLaunch";
import { runOverseerCli } from "./overseerCli";
import { defaultClaudeHome } from "./paths";

const claudeHome = process.env[OVERSEER_CLAUDE_HOME_ENV_VAR] || defaultClaudeHome();

runOverseerCli(process.argv.slice(2), process.env, claudeHome).then(
  ({ exitCode, output }) => {
    (exitCode === 0 ? process.stdout : process.stderr).write(`${output}\n`);
    process.exitCode = exitCode;
  },
  (error: unknown) => {
    process.stderr.write(`overseer failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
