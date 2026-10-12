import * as vscode from "vscode";
import { githubCommitUrl } from "./gitStatus";
import { openInBrowser } from "./openUrl";
import { RepoService } from "./repoService";
import { commitDocumentUri, RepoTreeNode } from "./repoTree";

export interface RepoCommandDependencies {
  repoService: RepoService;
  revealSession: (sessionId: string) => Promise<boolean>;
}

type CommitNode = Extract<RepoTreeNode, { kind: "commit" }>;

export function registerRepoCommands({ repoService, revealSession }: RepoCommandDependencies): vscode.Disposable[] {
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
    vscode.commands.registerCommand("overseer.showCommit", async (clicked?: RepoTreeNode) => {
      if (isCommitNode(clicked)) {
        const commitDocument = await vscode.workspace.openTextDocument(commitDocumentUri(clicked.repoRoot, clicked.commit));
        await vscode.languages.setTextDocumentLanguage(commitDocument, "diff");
        await vscode.window.showTextDocument(commitDocument, { preview: true });
      }
    }),
    vscode.commands.registerCommand("overseer.copyCommitHash", async (clicked?: RepoTreeNode) => {
      if (isCommitNode(clicked)) {
        await vscode.env.clipboard.writeText(clicked.commit.hash);
      }
    }),
    vscode.commands.registerCommand("overseer.revealCommitSession", async (clicked?: RepoTreeNode) => {
      if (!isCommitNode(clicked) || clicked.sessionId === undefined) {
        return;
      }
      if (!(await revealSession(clicked.sessionId))) {
        void vscode.window.showInformationMessage("Overseer: that session isn't pinned. Find it with All Sessions.");
      }
    }),
    vscode.commands.registerCommand("overseer.openCommitOnGitHub", async (clicked?: RepoTreeNode) => {
      if (!isCommitNode(clicked)) {
        return;
      }
      const remoteUrl = await repoService.remoteUrl(clicked.repoRoot);
      const commitUrl = remoteUrl === undefined ? undefined : githubCommitUrl(remoteUrl, clicked.commit.hash);
      if (commitUrl === undefined) {
        void vscode.window.showInformationMessage("Overseer: this repo's origin isn't on GitHub.");
        return;
      }
      await openInBrowser(commitUrl);
    }),
  ];
}

function isCommitNode(node: RepoTreeNode | undefined): node is CommitNode {
  return node?.kind === "commit";
}
