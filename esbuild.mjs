import * as esbuild from "esbuild";

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

if (isWatchMode) {
  const context = await esbuild.context(buildOptions);
  await context.watch();
} else {
  await esbuild.build(buildOptions);
}
