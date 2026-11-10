import * as esbuild from "esbuild";
import * as fs from "fs";

const isWatchMode = process.argv.includes("--watch");

const buildOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node22",
  sourcemap: true,
};

// The settings panel previews session icons with the Codicon font, so the font ships in media/.
const CODICON_SOURCE_DIR = "node_modules/@vscode/codicons/dist";
const CODICON_TARGET_DIR = "media/codicons";
fs.mkdirSync(CODICON_TARGET_DIR, { recursive: true });
for (const codiconFile of ["codicon.css", "codicon.ttf"]) {
  fs.copyFileSync(`${CODICON_SOURCE_DIR}/${codiconFile}`, `${CODICON_TARGET_DIR}/${codiconFile}`);
}

// The Office moved to the Office Simulation extension; don't package its old bundle from an earlier build.
for (const stale of ["dist/officeView.js", "dist/officeView.js.map"]) {
  fs.rmSync(stale, { force: true });
}

if (isWatchMode) {
  const context = await esbuild.context(buildOptions);
  await context.watch();
} else {
  await esbuild.build(buildOptions);
}
