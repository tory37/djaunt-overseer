import * as path from "path";
import * as vscode from "vscode";
import { formatAge } from "./format";
import { displayTitle, SessionMeta } from "./indexer";
import { LiveSession } from "./liveParse";
import { LiveSessionMonitor } from "./liveSessions";
import { tildePath } from "./paths";
import { Registry } from "./registry";
import { matchesRepoQuery, otherReposLabel, parseRepoQuery, sessionRepoNames } from "./repoFilter";
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
  quickPick.placeholder = "Search title, repo, branch, or prompt. repo:<name> filters by every repo a session touched.";
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;

  let shownSessions = sessionIndex.currentSessions;
  const showSessions = (sessions: SessionMeta[]): void => {
    shownSessions = sessions;
    const activeSessionId = quickPick.activeItems[0]?.session.sessionId;
    const allItems = sessions.map((session) =>
      toPickItem(session, registry.isPinned(session.sessionId), liveMonitor.get(session.sessionId)),
    );
    quickPick.items = applyRepoQuery(allItems, quickPick.value);
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

  let hadRepoQuery = false;
  quickPick.onDidChangeValue((searchText) => {
    const hasRepoQuery = parseRepoQuery(searchText) !== undefined;
    if (hasRepoQuery || hadRepoQuery) {
      showSessions(shownSessions);
    }
    hadRepoQuery = hasRepoQuery;
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

// The built-in fuzzy filter never matches "repo:x", so a repo query filters here and pins the survivors visible.
function applyRepoQuery(items: SessionPickItem[], searchText: string): SessionPickItem[] {
  const repoQuery = parseRepoQuery(searchText);
  if (repoQuery === undefined) {
    return items;
  }
  return items
    .filter((item) => matchesRepoQuery(item.session, `${item.label} ${item.description} ${item.detail}`, repoQuery))
    .map((item) => ({ ...item, alwaysShow: true }));
}

function toPickItem(session: SessionMeta, isPinned: boolean, liveSession: LiveSession | undefined): SessionPickItem {
  const sessionCwd = session.resumeCwd ?? session.startCwd;
  const repoName = path.basename(sessionCwd);
  const descriptionParts = [repoName, session.gitBranch, otherReposLabel(session)].filter(
    (part) => part !== undefined && part !== "",
  );
  const title = displayTitle(session);
  const activity = liveSession ? `$(pulse) ${liveSession.status === "busy" ? "working" : "running"}` : formatAge(session.lastActivityMs);
  const detailParts = [activity, tildePath(sessionCwd)];
  if (session.otherReposTouched.length > 0) {
    detailParts.push(`also ${sessionRepoNames(session).slice(1).join(", ")}`);
  }
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
