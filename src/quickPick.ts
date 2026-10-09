import * as path from "path";
import * as vscode from "vscode";
import { formatAge } from "./format";
import { displayTitle, SessionMeta } from "./indexer";
import { LiveSession } from "./liveParse";
import { LiveSessionMonitor } from "./liveSessions";
import { tildePath } from "./paths";
import { Registry } from "./registry";
import { SessionIndex } from "./sessionIndex";

interface SessionPickItem extends vscode.QuickPickItem {
  session: SessionMeta;
}

const PIN_BUTTON: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon("pin"), tooltip: "Pin to sidebar" };
const UNPIN_BUTTON: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon("pinned"), tooltip: "Unpin from sidebar" };

export async function pickSession(
  sessionIndex: SessionIndex,
  liveMonitor: LiveSessionMonitor,
  registry: Registry,
): Promise<SessionMeta | undefined> {
  const quickPick = vscode.window.createQuickPick<SessionPickItem>();
  quickPick.title = "All Claude sessions";
  quickPick.placeholder = "Search by title, repo, branch, or first prompt. Enter resumes and pins.";
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;

  let shownSessions = sessionIndex.currentSessions;
  const showSessions = (sessions: SessionMeta[]): void => {
    shownSessions = sessions;
    const activeSessionId = quickPick.activeItems[0]?.session.sessionId;
    quickPick.items = sessions.map((session) =>
      toPickItem(session, registry.isPinned(session.sessionId), liveMonitor.get(session.sessionId)),
    );
    const activeItem = quickPick.items.find((item) => item.session.sessionId === activeSessionId);
    if (activeItem) {
      quickPick.activeItems = [activeItem];
    }
  };
  showSessions(shownSessions);
  quickPick.busy = true;
  void Promise.all([sessionIndex.refresh(), liveMonitor.refresh()]).then(([sessions]) => {
    showSessions(sessions);
    quickPick.busy = false;
  });

  quickPick.onDidTriggerItemButton(async ({ item }) => {
    const sessionId = item.session.sessionId;
    if (registry.isPinned(sessionId)) {
      await registry.unpin(sessionId);
    } else {
      await registry.pin(sessionId);
    }
    showSessions(shownSessions);
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

function toPickItem(session: SessionMeta, isPinned: boolean, liveSession: LiveSession | undefined): SessionPickItem {
  const sessionCwd = session.resumeCwd ?? session.startCwd;
  const repoName = path.basename(sessionCwd);
  const descriptionParts = [repoName, session.gitBranch].filter((part) => part !== undefined && part !== "");
  const title = displayTitle(session);
  const activity = liveSession ? `$(pulse) ${liveSession.status === "busy" ? "working" : "running"}` : formatAge(session.lastActivityMs);
  const detailParts = [activity, tildePath(sessionCwd)];
  if (session.firstPrompt !== undefined && session.firstPrompt !== title) {
    detailParts.push(session.firstPrompt);
  }
  return {
    label: isPinned ? `$(pinned) ${title}` : title,
    description: descriptionParts.join("  ·  "),
    detail: detailParts.join("  ·  "),
    buttons: [isPinned ? UNPIN_BUTTON : PIN_BUTTON],
    session,
  };
}
