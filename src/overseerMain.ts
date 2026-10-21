import { runOverseerCli } from "./overseerCli";
import { defaultClaudeHome } from "./paths";

runOverseerCli(process.argv.slice(2), process.env, defaultClaudeHome()).then(
  ({ exitCode, output }) => {
    (exitCode === 0 ? process.stdout : process.stderr).write(`${output}\n`);
    process.exitCode = exitCode;
  },
  (error: unknown) => {
    process.stderr.write(`overseer failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
