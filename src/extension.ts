import * as vscode from "vscode";
import { registerCommands } from "./commands";
import { LiveSessionMonitor } from "./liveSessions";
import { defaultClaudeHome } from "./paths";
import { Registry } from "./registry";
import { SessionIndex } from "./sessionIndex";
import { LinkStatusService } from "./linkStatusService";
import { SessionLinkService } from "./sessionLinks";
import { SessionSummaryService } from "./sessionSummaries";
import { adoptTerminalsByPid } from "./terminals";
import { SessionTreeProvider, TreeNode } from "./tree";

const INDEX_REFRESH_INTERVAL_MS = 60_000;

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel("Overseer");
  const configuredClaudeHome = vscode.workspace.getConfiguration("overseer").get<string>("claudeHome");
  const claudeHome = configuredClaudeHome || defaultClaudeHome();
  const sessionIndex = new SessionIndex(claudeHome, context.globalStorageUri.fsPath, log);
  const liveMonitor = new LiveSessionMonitor(claudeHome, log);
  const registry = new Registry(context.globalState);
  const findIndexedSession = (sessionId: string) =>
    sessionIndex.currentSessions.find((session) => session.sessionId === sessionId);
  const linkService = new SessionLinkService(
    context.globalStorageUri.fsPath,
    liveMonitor,
    findIndexedSession,
    (sessionId) => registry.linkMarks(sessionId),
    (sessionId) => registry.linkOrder(sessionId),
    log,
  );
  const linkStatusService = new LinkStatusService(log);
  const summaryService = new SessionSummaryService(context.globalStorageUri.fsPath, log);
  const treeProvider = new SessionTreeProvider(
    sessionIndex,
    liveMonitor,
    registry,
    linkService,
    linkStatusService,
    context.extensionUri,
    summaryService,
  );
  const treeView = vscode.window.createTreeView("overseer.sessions", {
    treeDataProvider: treeProvider,
    dragAndDropController: treeProvider,
    canSelectMany: true,
    showCollapseAll: true,
  });
  treeView.onDidExpandElement(({ element }) => void saveExpansion(registry, element, true));
  treeView.onDidCollapseElement(({ element }) => void saveExpansion(registry, element, false));

  const refreshTree = (): void => treeProvider.refresh();
  const adoptRevivedTerminals = async (): Promise<void> => {
    if (await adoptTerminalsByPid(await liveMonitor.refresh())) {
      refreshTree();
    }
  };
  registry.onDidChange(refreshTree);
  const indexRefreshTimer = setInterval(() => void sessionIndex.refresh(), INDEX_REFRESH_INTERVAL_MS);

  context.subscriptions.push(
    log,
    sessionIndex,
    liveMonitor,
    linkService,
    linkStatusService,
    summaryService,
    treeProvider,
    treeView,
    { dispose: () => clearInterval(indexRefreshTimer) },
    sessionIndex.onDidChange(refreshTree),
    linkService.onDidChange(refreshTree),
    linkStatusService.onDidChange(refreshTree),
    summaryService.onDidChange(refreshTree),
    liveMonitor.onDidChange(() => {
      refreshTree();
      void adoptRevivedTerminals();
    }),
    vscode.window.onDidOpenTerminal(refreshTree),
    vscode.window.onDidCloseTerminal(() => {
      refreshTree();
      void sessionIndex.refresh();
      void liveMonitor.refresh();
    }),
    // Other windows write the same globalState; re-read it when this window comes back into focus.
    vscode.window.onDidChangeWindowState((windowState) => {
      if (windowState.focused) {
        registry.notifyExternalChange();
        void sessionIndex.refresh();
        void liveMonitor.refresh();
      }
    }),
    ...registerCommands({
      sessionIndex,
      liveMonitor,
      registry,
      linkService,
      linkStatusService,
      summaryService,
      treeView,
      log,
    }),
  );

  void sessionIndex.refresh();
  void adoptRevivedTerminals();
}

export function deactivate(): void {}

async function saveExpansion(registry: Registry, node: TreeNode, isExpanded: boolean): Promise<void> {
  if (node.kind === "session") {
    await registry.setSessionExpanded(node.pinned.sessionId, isExpanded);
  } else if (node.kind === "group") {
    await registry.setGroupCollapsed(node.group.ref, !isExpanded);
  }
}
