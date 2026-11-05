import * as vscode from "vscode";
import { withTabSpotlight } from "./tabSpotlight";
import { THEME_TAB_SPOTLIGHT } from "./themeTabSpotlight";

const TAB_SPOTLIGHT_SETTING = "overseer.theme.tabSpotlight";
const COLOR_THEME_SETTING = "workbench.colorTheme";

export async function syncTabSpotlight(log: vscode.OutputChannel): Promise<void> {
  try {
    const isEnabled = vscode.workspace.getConfiguration().get<boolean>(TAB_SPOTLIGHT_SETTING, true);
    const activeTheme = vscode.workspace.getConfiguration().get<string>(COLOR_THEME_SETTING);
    const isOverseerThemeActive = activeTheme !== undefined && Object.hasOwn(THEME_TAB_SPOTLIGHT, activeTheme);
    if (isEnabled && !isOverseerThemeActive) {
      return;
    }
    const workbench = vscode.workspace.getConfiguration("workbench");
    // Only the global value, so workspace colors never get copied into user settings.
    const globalCustomizations = workbench.inspect("colorCustomizations")?.globalValue;
    const nextCustomizations = withTabSpotlight(globalCustomizations, THEME_TAB_SPOTLIGHT, isEnabled);
    if (nextCustomizations === undefined) {
      return;
    }
    await workbench.update("colorCustomizations", nextCustomizations, vscode.ConfigurationTarget.Global);
    log.appendLine(`[tabSpotlight] ${isEnabled ? "Added" : "Removed"} tab colors in user settings`);
  } catch (error) {
    log.appendLine(`[tabSpotlight] Can't update workbench.colorCustomizations: ${String(error)}`);
  }
}

export function registerTabSpotlightSync(log: vscode.OutputChannel): vscode.Disposable {
  void syncTabSpotlight(log);
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(COLOR_THEME_SETTING) || event.affectsConfiguration(TAB_SPOTLIGHT_SETTING)) {
      void syncTabSpotlight(log);
    }
  });
}
