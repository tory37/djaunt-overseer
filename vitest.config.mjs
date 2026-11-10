import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Modules that need vscode run against a small fake of it.
  resolve: { alias: { vscode: fileURLToPath(new URL("./test/fakes/vscode.ts", import.meta.url)) } },
  test: { include: ["test/unit/**/*.test.ts"] },
});
