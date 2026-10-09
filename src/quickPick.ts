import * as path from "path";
import * as vscode from "vscode";
import { formatAge } from "./format";
import { displayTitle, SessionMeta } from "./indexer";
import { tildePath } from "./paths";
import { SessionIndex } from "./sessionIndex";

interface SessionPickItem extends vscode.QuickPickItem {
  session: SessionMeta;
}

export async function pickSession(sessionIndex: SessionIndex): Promise<SessionMeta | undefined> {
  const quickPick = vscode.window.createQuickPick<SessionPickItem>();
  quickPick.title = "All Claude sessions";
  quickPick.placeholder = "Search by title, repo, branch, or first prompt";
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;

  const showSessions = (sessions: SessionMeta[]): void => {
    quickPick.items = sessions.map(toPickItem);
  };
  showSessions(sessionIndex.currentSessions);
  quickPick.busy = true;
  void sessionIndex.refresh().then((sessions) => {
    showSessions(sessions);
    quickPick.busy = false;
  });

  return new Promise<SessionMeta | undefined>((resolve) => {
    quickPick.onDidAccept(() => {
      resolve(quickPick.selectedItems[0]?.session);
      quickPick.hide();
    });
    quickPick.onDidHide(() => {
      resolve(undefined);
      quickPick.dispose();
    });
    quickPick.show();
  });
}

function toPickItem(session: SessionMeta): SessionPickItem {
  const sessionCwd = session.resumeCwd ?? session.startCwd;
  const repoName = path.basename(sessionCwd);
  const descriptionParts = [repoName, session.gitBranch].filter((part) => part !== undefined && part !== "");
  const title = displayTitle(session);
  const detailParts = [formatAge(session.lastActivityMs), tildePath(sessionCwd)];
  if (session.firstPrompt !== undefined && session.firstPrompt !== title) {
    detailParts.push(session.firstPrompt);
  }
  return {
    label: title,
    description: descriptionParts.join("  ·  "),
    detail: detailParts.join("  ·  "),
    session,
  };
}
