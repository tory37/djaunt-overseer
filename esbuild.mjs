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

// The overseer CLI runs in Claude's Bash tool, outside VS Code, so it is its own bundle.
const cliBuildOptions = {
  ...buildOptions,
  entryPoints: ["src/overseerMain.ts"],
  outfile: "dist/overseer.js",
  external: [],
};

// The settings panel previews session icons with the Codicon font, so the font ships in media/.
const CODICON_SOURCE_DIR = "node_modules/@vscode/codicons/dist";
const CODICON_TARGET_DIR = "media/codicons";
fs.mkdirSync(CODICON_TARGET_DIR, { recursive: true });
for (const codiconFile of ["codicon.css", "codicon.ttf"]) {
  fs.copyFileSync(`${CODICON_SOURCE_DIR}/${codiconFile}`, `${CODICON_TARGET_DIR}/${codiconFile}`);
}

if (isWatchMode) {
  for (const options of [buildOptions, cliBuildOptions]) {
    const context = await esbuild.context(options);
    await context.watch();
  }
} else {
  await Promise.all([esbuild.build(buildOptions), esbuild.build(cliBuildOptions)]);
}
