import * as vscode from "vscode";
import { registerCommands } from "./commands";
import { CompactMonitor, registerCompactHookCommands } from "./compactMonitor";
import { displayTitle, SessionMeta } from "./indexer";
import { LiveSessionMonitor } from "./liveSessions";
import { defaultClaudeHome } from "./paths";
import { Registry } from "./registry";
import { SessionIndex } from "./sessionIndex";
import { JiraService } from "./jiraService";
import { LinkStatusService } from "./linkStatusService";
import { SessionLinkService } from "./sessionLinks";
import { SessionSummaryService } from "./sessionSummaries";
import { StoredStatusCache } from "./statusCache";
import { registerSettingsCommands } from "./settingsCommands";
import { SettingsPanel } from "./settingsPanel";
import { jiraProjectRefresher, registerStatusCommands } from "./statusCommands";
import { StatusConfig } from "./statusConfig";
import { adoptTerminalsByPid, sessionIdOfTerminal } from "./terminals";
import { createGitRootResolver } from "./gitRoots";
import { registerRepoCommands } from "./repoCommands";
import { RepoService } from "./repoService";
import { resolveRepos } from "./repoSet";
import { COMMIT_DOCUMENT_SCHEME, CommitDocumentProvider, RepoTreeProvider } from "./repoTree";
import { CommitAuthorship, indexCommitAuthorship } from "./gitStatus";
import { ResourcesPanel } from "./resourcesPanel";
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
    findIndexedSession,
    (sessionId) => registry.linkMarks(sessionId),
    (sessionId) => registry.linkOrder(sessionId),
    log,
  );
  const statusConfig = new StatusConfig(context.globalState);
  const jiraService = new JiraService(log);
  const linkStatusService = new LinkStatusService(log, jiraService, statusConfig, new StoredStatusCache(context.globalState));
  const summaryService = new SessionSummaryService(context.globalStorageUri.fsPath, log);
  const compactMonitor = new CompactMonitor(claudeHome, log);
  const treeProvider = new SessionTreeProvider(
    sessionIndex,
    liveMonitor,
    registry,
    linkService,
    summaryService,
    compactMonitor,
  );
  const treeView = vscode.window.createTreeView("overseer.sessions", {
    treeDataProvider: treeProvider,
    dragAndDropController: treeProvider,
    canSelectMany: true,
    showCollapseAll: true,
  });
  const repoService = new RepoService(log);
  let authorshipSource: SessionMeta[] | undefined;
  let authorshipByPrefix = new Map<string, CommitAuthorship[]>();
  // Rebuilt only when the index hands over a new session list.
  const commitAuthorship = (): Map<string, CommitAuthorship[]> => {
    if (authorshipSource !== sessionIndex.currentSessions) {
      authorshipSource = sessionIndex.currentSessions;
      authorshipByPrefix = indexCommitAuthorship(
        new Map(authorshipSource.map((meta) => [meta.sessionId, meta.commitHashes])),
      );
    }
    return authorshipByPrefix;
  };
  const repoTreeProvider = new RepoTreeProvider({
    repoService,
    sessionTitle: (sessionId) => sessionTitle(sessionId, registry, findIndexedSession),
    commitAuthorship,
  });
  const repoTreeView = vscode.window.createTreeView("overseer.repos", { treeDataProvider: repoTreeProvider });
  repoService.setVisible(repoTreeView.visible);
  // A new resolver each time, so a folder that became a repo since the last update is found.
  const updateRepos = async (): Promise<void> => {
    repoService.setRepos(await resolveRepos(treeProvider.pinnedSessions(), createGitRootResolver()));
  };
  treeView.onDidExpandElement(({ element }) => void saveExpansion(registry, element, true));
  treeView.onDidCollapseElement(({ element }) => void saveExpansion(registry, element, false));

  const refreshTree = (): void => {
    treeProvider.refresh();
    void updateRepos();
  };
  const adoptRevivedTerminals = async (): Promise<void> => {
    if (await adoptTerminalsByPid(await liveMonitor.refresh(), shellPidsBySessionId(registry))) {
      refreshTree();
    }
  };
  registry.onDidChange(refreshTree);
  statusConfig.onDidChange(() => {
    refreshTree();
    SettingsPanel.notifyConfigChanged();
  });
  const indexRefreshTimer = setInterval(() => void sessionIndex.refresh(), INDEX_REFRESH_INTERVAL_MS);

  context.subscriptions.push(
    log,
    sessionIndex,
    liveMonitor,
    linkService,
    linkStatusService,
    jiraService,
    summaryService,
    treeProvider,
    treeView,
    { dispose: () => clearInterval(indexRefreshTimer) },
    repoService,
    repoTreeProvider,
    repoTreeView,
    repoTreeView.onDidChangeVisibility(({ visible }) => repoService.setVisible(visible)),
    vscode.workspace.registerTextDocumentContentProvider(COMMIT_DOCUMENT_SCHEME, new CommitDocumentProvider(repoService)),
    sessionIndex.onDidChange(() => repoTreeProvider.refresh()),
    ...registerRepoCommands({
      repoService,
      revealSession: async (sessionId) => {
        const sessionNode = treeProvider.sessionNode(sessionId);
        if (sessionNode === undefined) {
          return false;
        }
        await treeView.reveal(sessionNode, { select: true, focus: true });
        await vscode.commands.executeCommand("overseer.focusSession", sessionId);
        return true;
      },
    }),
    sessionIndex.onDidChange(refreshTree),
    linkService.onDidChange(refreshTree),
    summaryService.onDidChange(refreshTree),
    compactMonitor,
    compactMonitor.onDidChange(refreshTree),
    ...registerCompactHookCommands(context, claudeHome, log),
    liveMonitor.onDidChange(() => {
      refreshTree();
      void adoptRevivedTerminals();
    }),
    vscode.window.onDidOpenTerminal(() => {
      refreshTree();
      void adoptRevivedTerminals();
    }),
    // A reload can bring a tab back without its name; renaming needs the tab active, so it waits for focus.
    vscode.window.onDidChangeActiveTerminal((activeTerminal) => {
      const sessionId = activeTerminal === undefined ? undefined : sessionIdOfTerminal(activeTerminal);
      if (activeTerminal === undefined || sessionId === undefined) {
        return;
      }
      const meta = findIndexedSession(sessionId);
      const expectedName = registry.labels()[sessionId] ?? (meta === undefined ? undefined : displayTitle(meta));
      if (expectedName !== undefined && activeTerminal.name !== expectedName) {
        void vscode.commands.executeCommand("workbench.action.terminal.renameWithArg", { name: expectedName });
      }
    }),
    vscode.window.onDidCloseTerminal(() => {
      refreshTree();
      void sessionIndex.refresh();
      void liveMonitor.refresh();
    }),
    // Other windows write the same globalState; re-read it when this window comes back into focus.
    vscode.window.onDidChangeWindowState((windowState) => {
      if (windowState.focused) {
        registry.notifyExternalChange();
        statusConfig.notifyExternalChange();
        repoService.refreshAll();
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
      showResources: (sessionId) =>
        ResourcesPanel.show(
          {
            extensionUri: context.extensionUri,
            registry,
            linkService,
            linkStatusService,
            statusConfig,
            findSessionMeta: findIndexedSession,
            sessionTitle: (titledSessionId) => sessionTitle(titledSessionId, registry, findIndexedSession),
          },
          sessionId,
        ),
      pinnedSessions: () => treeProvider.pinnedSessions(),
      log,
    }),
    ...registerStatusCommands({ jiraService, linkStatusService, statusConfig }),
    ...registerSettingsCommands({
      extensionUri: context.extensionUri,
      statusConfig,
      refreshProjects: jiraProjectRefresher(linkStatusService, statusConfig),
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("overseer")) {
        refreshTree();
      }
    }),
  );
  void adoptRevivedTerminals();

  void sessionIndex.refresh();
}

export function deactivate(): void {}

async function saveExpansion(registry: Registry, node: TreeNode, isExpanded: boolean): Promise<void> {
  if (node.kind === "session") {
    await registry.setSessionExpanded(node.pinned.sessionId, isExpanded);

  } else if (node.kind === "group") {
    await registry.setGroupCollapsed(node.group.ref, !isExpanded);
  }
}

function sessionTitle(
  sessionId: string,
  registry: Registry,
  findIndexedSession: (sessionId: string) => SessionMeta | undefined,
): string {
  const meta = findIndexedSession(sessionId);
  return registry.labels()[sessionId] ?? (meta === undefined ? sessionId : displayTitle(meta));
}

function shellPidsBySessionId(registry: Registry): Record<string, number | undefined> {
  return Object.fromEntries(
    Object.entries(registry.terminalSessions()).map(([sessionId, terminalSession]) => [sessionId, terminalSession.shellPid]),
  );
}
