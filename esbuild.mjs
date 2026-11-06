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

// The Office webview runs in the browser, so it is its own bundle.
const officeViewOptions = {
  entryPoints: ["src/officeView/main.ts"],
  bundle: true,
  outfile: "dist/officeView.js",
  format: "iife",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
};

// The settings panel previews session icons with the Codicon font, so the font ships in media/.
const CODICON_SOURCE_DIR = "node_modules/@vscode/codicons/dist";
const CODICON_TARGET_DIR = "media/codicons";
fs.mkdirSync(CODICON_TARGET_DIR, { recursive: true });
for (const codiconFile of ["codicon.css", "codicon.ttf"]) {
  fs.copyFileSync(`${CODICON_SOURCE_DIR}/${codiconFile}`, `${CODICON_TARGET_DIR}/${codiconFile}`);
}

if (isWatchMode) {
  for (const options of [buildOptions, officeViewOptions]) {
    const context = await esbuild.context(options);
    await context.watch();
  }
} else {
  await Promise.all([esbuild.build(buildOptions), esbuild.build(officeViewOptions)]);
}
