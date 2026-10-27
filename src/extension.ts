import * as vscode from "vscode";
import { AnalyzerTrigger } from "./analyzerTrigger";
import { registerCommands } from "./commands";
import { CompactMonitor, registerCompactHookCommands } from "./compactMonitor";
import { PinnedSession, SessionSection } from "./grouping";
import { displayTitle, SessionMeta } from "./indexer";
import { LiveSessionMonitor } from "./liveSessions";
import { defaultClaudeHome } from "./paths";
import { Registry } from "./registry";
import { SessionIndex } from "./sessionIndex";
import { JiraService } from "./jiraService";
import { LinkStatusService } from "./linkStatusService";
import { SessionAnalyzer } from "./sessionAnalyzer";
import { SessionLinkService } from "./sessionLinks";
import { SessionSummaryService } from "./sessionSummaries";
import { StoredStatusCache } from "./statusCache";
import { registerSettingsCommands } from "./settingsCommands";
import { SettingsPanel } from "./settingsPanel";
import { jiraProjectRefresher, registerStatusCommands } from "./statusCommands";
import { StatusConfig } from "./statusConfig";
import { adoptTerminalsByPid, followSwitchedSessions, sessionIdOfTerminal } from "./terminals";
import { createGitRootResolver } from "./gitRoots";
import { registerRepoCommands } from "./repoCommands";
import { RepoService } from "./repoService";
import { resolveRepos } from "./repoSet";
import { COMMIT_DOCUMENT_SCHEME, CommitDocumentProvider, RepoTreeProvider } from "./repoTree";
import { CommitAuthorship, indexCommitAuthorship } from "./gitStatus";
import { HistoryPanel } from "./historyPanel";
import { SessionFocusTracker } from "./sessionFocus";
import { SessionPreview } from "./sessionPreview";
import { SESSION_PANEL_VIEW_ID, SessionPanelProvider } from "./sessionPanel";
import { SessionTreeProvider } from "./tree";
import { SessionStatusDecorations } from "./sessionStatusView";
import { registerWorkspaceCommands } from "./workspaceCommands";

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
  const linkService = new SessionLinkService(context.globalStorageUri.fsPath, log);
  const statusConfig = new StatusConfig(context.globalState);
  const jiraService = new JiraService(log);
  const linkStatusService = new LinkStatusService(log, jiraService, statusConfig, new StoredStatusCache(context.globalState));
  const summaryService = new SessionSummaryService(context.globalStorageUri.fsPath, log);
  const sessionAnalyzer = new SessionAnalyzer({
    claudeHome,
    registry,
    linkService,
    linkStatusService,
    findSessionMeta: findIndexedSession,
    sessionTitle: (titledSessionId) => sessionTitle(titledSessionId, registry, findIndexedSession),
    log,
  });
  const analyzerTrigger = new AnalyzerTrigger({ liveMonitor, analyzer: sessionAnalyzer, findSessionMeta: findIndexedSession, log });
  const compactMonitor = new CompactMonitor(claudeHome, log);
  const createSectionTree = (section: SessionSection, viewId: string) => {
    const provider = new SessionTreeProvider(section, sessionIndex, liveMonitor, registry, compactMonitor);
    const view = vscode.window.createTreeView(viewId, {
      treeDataProvider: provider,
      dragAndDropController: provider,
      canSelectMany: true,
      showCollapseAll: true,
    });
    view.onDidExpandElement(({ element }) => void provider.saveExpansion(element, true));
    view.onDidCollapseElement(({ element }) => void provider.saveExpansion(element, false));
    return { provider, view };
  };
  const { provider: treeProvider, view: treeView } = createSectionTree("claude", "overseer.sessions");
  const { provider: terminalTreeProvider, view: terminalTreeView } = createSectionTree("terminal", "overseer.terminals");
  const pinnedSessions = (): PinnedSession[] => [...treeProvider.pinnedSessions(), ...terminalTreeProvider.pinnedSessions()];
  // Switching tabs by hand should move the sidebar highlight too. A row already in the selection stays, so a multi-select survives.
  const selectSessionRow = (sessionId: string): void => {
    for (const { provider, view } of [{ provider: treeProvider, view: treeView }, { provider: terminalTreeProvider, view: terminalTreeView }]) {
      const sessionNode = provider.sessionNode(sessionId);
      if (sessionNode === undefined) {
        continue;
      }
      const isAlreadySelected = view.selection.some((node) => node.kind === "session" && node.pinned.sessionId === sessionId);
      if (view.visible && !isAlreadySelected) {
        void Promise.resolve(view.reveal(sessionNode, { select: true, focus: false })).catch(() => undefined);
      }
      return;
    }
  };
  const statusDecorations = new SessionStatusDecorations(registry);
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
    repoService.setRepos(await resolveRepos(pinnedSessions(), createGitRootResolver()));
  };

  const refreshTree = (): void => {
    treeProvider.refresh();
    terminalTreeProvider.refresh();
    void updateRepos();
  };
  const adoptRevivedTerminals = async (): Promise<void> => {
    const liveSessions = await liveMonitor.refresh();
    if (await adoptTerminalsByPid(liveSessions, shellPidsBySessionId(registry))) {
      refreshTree();
    }
    for (const { fromSessionId, toSessionId } of await followSwitchedSessions(liveSessions)) {
      log.appendLine(`Session ${fromSessionId} became ${toSessionId} in the same terminal; moving its row`);
      await registry.copyTicketMarks(fromSessionId, toSessionId);
      await sessionAnalyzer.copySession(fromSessionId, toSessionId);
      const previousTitle = sessionTitle(fromSessionId, registry, findIndexedSession);
      const isNewSession = !registry.isPinned(toSessionId) && findIndexedSession(toSessionId) === undefined;
      await registry.moveSession(fromSessionId, toSessionId);
      if (isNewSession) {
        void vscode.commands.executeCommand("overseer.nameClearedSession", toSessionId, previousTitle);
      }
    }
  };
  registry.onDidChange(refreshTree);
  const sessionPreview = new SessionPreview({
    extensionUri: context.extensionUri,
    registry,
    liveMonitor,
    summaryService,
    repoService,
    linkService,
    linkStatusService,
    findSessionMeta: findIndexedSession,
    sessionTitle: (titledSessionId) => sessionTitle(titledSessionId, registry, findIndexedSession),
  });
  const sessionFocus = new SessionFocusTracker(sessionPreview);
  sessionFocus.onDidChange(() => {
    if (sessionFocus.focusSource() === "terminal") {
      sessionPreview.close();
    }
  });
  const sessionPanelProvider = new SessionPanelProvider({
    extensionUri: context.extensionUri,
    registry,
    linkService,
    linkStatusService,
    statusConfig,
    liveMonitor,
    sessionFocus,
    sessionPreview,
    summaryService,
    sessionAnalyzer,
    findSessionMeta: findIndexedSession,
    sessionTitle: (titledSessionId) => sessionTitle(titledSessionId, registry, findIndexedSession),
    globalState: context.globalState,
  });
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
    sessionAnalyzer,
    analyzerTrigger,
    treeProvider,
    treeView,
    terminalTreeProvider,
    terminalTreeView,
    statusDecorations,
    vscode.window.registerFileDecorationProvider(statusDecorations),
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
    compactMonitor,
    sessionPreview,
    sessionFocus,
    sessionPanelProvider,
    vscode.window.registerWebviewViewProvider(SESSION_PANEL_VIEW_ID, sessionPanelProvider),
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
      selectSessionRow(sessionId);
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
      summaryService,
      sessionViews: [treeView, terminalTreeView],
      sessionPreview,
      pinnedSessions,
      sessionAnalyzer,
      sessionFocus,
      log,
    }),
    ...registerWorkspaceCommands({ registry, sessionIndex, liveMonitor, pinnedSessions, log }),
    vscode.commands.registerCommand("overseer.openHistory", () =>
      HistoryPanel.show({ extensionUri: context.extensionUri, sessionIndex, liveMonitor, registry, claudeHome }),
    ),
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
