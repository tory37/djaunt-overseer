import * as vscode from "vscode";
import { RepoService } from "./repoService";
import { RepoTreeNode } from "./repoTree";

export function registerRepoCommands(repoService: RepoService): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("overseer.refreshRepos", () => repoService.refreshAll()),
    vscode.commands.registerCommand("overseer.openRepoInNewWindow", async (clicked?: RepoTreeNode) => {
      if (clicked?.kind === "repo") {
        await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(clicked.repo.root), { forceNewWindow: true });
      }
    }),
    vscode.commands.registerCommand("overseer.copyRepoPath", async (clicked?: RepoTreeNode) => {
      if (clicked?.kind === "repo") {
        await vscode.env.clipboard.writeText(clicked.repo.root);
      }
    }),
  ];
}
