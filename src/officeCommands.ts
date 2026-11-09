import * as vscode from "vscode";
import type { PinnedSession } from "./grouping";
import type { OfficeBridge } from "./officeBridge";

// The Office's commands on Overseer's side: its view's buttons run the Office Simulation extension's own commands
// (keeping the old ids, so keybindings still work), and the session row's Pixel Guy menu edits that session's guy.
export function registerOfficeCommands(office: OfficeBridge): vscode.Disposable[] {
  const forSession = (run: (sessionId: string) => Promise<void>) => async (node?: { pinned?: PinnedSession }) => {
    const sessionId = node?.pinned?.sessionId;
    if (sessionId !== undefined) {
      await run(sessionId);
    }
  };
  return [
    vscode.commands.registerCommand("overseer.office.playShow", (kind?: unknown) => office.runOfficeCommand("officeSim.playShow", kind)),
    vscode.commands.registerCommand("overseer.office.chatterStyle", (style?: unknown) => office.runOfficeCommand("officeSim.chatter", style)),
    vscode.commands.registerCommand("overseer.office.switchScene", () => office.runOfficeCommand("officeSim.switchScene")),
    vscode.commands.registerCommand("overseer.office.customizeYou", () => office.runOfficeCommand("officeSim.customizeYou")),
    vscode.commands.registerCommand("overseer.customizePixelGuy", forSession((sessionId) => office.customize(sessionId))),
    vscode.commands.registerCommand("overseer.rerollPixelGuy", forSession((sessionId) => office.reroll(sessionId))),
    vscode.commands.registerCommand("overseer.pickPixelGuyRace", forSession((sessionId) => office.pickRace(sessionId))),
    vscode.commands.registerCommand("overseer.resetPixelGuy", forSession((sessionId) => office.reset(sessionId))),
  ];
}
