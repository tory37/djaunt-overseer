import { randomUUID } from "crypto";
import * as fs from "fs";
import * as vscode from "vscode";
import { autoGroupRefFor, PinnedSession, pinnedSessionTitle } from "./grouping";
import * as path from "path";
import { displayTitle, SessionMeta } from "./indexer";
import { tildePath } from "./paths";
import { LiveSessionMonitor } from "./liveSessions";
import { pickSession } from "./quickPick";
import { Registry, userGroupRef } from "./registry";
import { resolveRepos, sessionDirectory } from "./repoSet";
import { createGitRootResolver } from "./gitRoots";
import { SessionIndex } from "./sessionIndex";
import { SessionLinkService } from "./sessionLinks";
import { LinkStatusService } from "./linkStatusService";
import { SessionSummaryService } from "./sessionSummaries";
import {
  attachBackgroundSession,
  findSessionTerminal,
  openShellTerminal,
  resumeSession,
  sendSlashCommand,
  startNewSession,
} from "./terminals";
import { RepoTreeNode } from "./repoTree";
import { fillPrompt, parseSessionCommands, promptParameters } from "./sessionCommands";
import { askStatusReason, configuredStatuses, pickSessionStatus } from "./sessionStatusView";
import { busySessions, confirmStopBusySessions, runningClaudeSessions, suspendSessions } from "./suspend";
import { TreeNode } from "./tree";
import { pickTargetWorkspace } from "./workspaceCommands";

export interface CommandDependencies {
  sessionIndex: SessionIndex;
  liveMonitor: LiveSessionMonitor;
  registry: Registry;
  linkService: SessionLinkService;
  linkStatusService: LinkStatusService;
  summaryService: SessionSummaryService;
  sessionViews: vscode.TreeView<TreeNode>[];
  showResources: (sessionId: string) => void;
  pinnedSessions: () => PinnedSession[];
  log: vscode.OutputChannel;
}

type SessionNode = Extract<TreeNode, { kind: "session" }>;
type GroupNode = Extract<TreeNode, { kind: "group" }>;

const FORK_CHOICE = "Fork a Copy Here";
const ATTACH_CHOICE = "Attach Here";
const SUSPEND_ANYWAY_CHOICE = "Suspend Anyway";
const DOUBLE_CLICK_WINDOW_MS = 400;
const RECENT_DIRECTORY_LIMIT = 12;

// Claude resolves each alias to the latest model in that family.
const MODEL_ALIASES: vscode.QuickPickItem[] = [
  { label: "opus", description: "Most capable" },
  { label: "sonnet", description: "Balanced" },
  { label: "haiku", description: "Fastest" },
  { label: "fable", description: "Latest Fable" },
];

interface DirectoryPickItem extends vscode.QuickPickItem {
  directory: string | undefined;
}

export function registerCommands(dependencies: CommandDependencies): vscode.Disposable[] {
  const {
    sessionIndex,
    liveMonitor,
    registry,
    linkService,
    linkStatusService,
    summaryService,
    sessionViews,
    showResources,
    pinnedSessions,
    log,
  } = dependencies;

  // Palette commands act on the view the user selected in last.
  let activeSessionView = sessionViews[0];
  const selectionListeners = sessionViews.map((sessionView) =>
    sessionView.onDidChangeSelection(({ selection }) => {
      if (selection.length > 0) {
        activeSessionView = sessionView;
      }
    }),
  );

  // A right-clicked row that is part of a multi-select acts on the whole selection of its own view.
  const selectionHolding = (clickedNode: TreeNode): readonly TreeNode[] =>
    sessionViews.map((sessionView) => sessionView.selection).find((selection) => selection.includes(clickedNode)) ?? [clickedNode];

  const selectedSessionNodes = (clickedNode?: TreeNode): SessionNode[] => {
    const candidateNodes = clickedNode === undefined ? activeSessionView.selection : selectionHolding(clickedNode);
    return candidateNodes.filter((node): node is SessionNode => node.kind === "session");
  };

  // A clicked session offers only its own repos; the palette offers every repo in the tree.
  const pickRepo = async (clickedNode?: TreeNode): Promise<string | undefined> => {
    const sessionNodes = clickedNode === undefined ? [] : selectedSessionNodes(clickedNode);
    const sourceSessions = sessionNodes.length > 0 ? sessionNodes.map((node) => node.pinned) : pinnedSessions();
    const repos = await resolveRepos(sourceSessions, createGitRootResolver());
    if (repos.length === 0) {
      void vscode.window.showInformationMessage("Overseer: no git repo found for that session.");
      return undefined;
    }
    if (repos.length === 1) {
      return repos[0].root;
    }
    const pickedRepo = await vscode.window.showQuickPick(
      repos.map((repo) => ({ label: repo.name, description: tildePath(repo.root), repo })),
      { placeHolder: "Open which repo in Source Control?" },
    );
    return pickedRepo?.repo.root;
  };

  const findSessionMeta = async (sessionId: string): Promise<SessionMeta | undefined> => {
    const indexedMeta = sessionIndex.currentSessions.find((session) => session.sessionId === sessionId);
    if (indexedMeta) {
      return indexedMeta;
    }
    const refreshedSessions = await sessionIndex.refresh();
    return refreshedSessions.find((session) => session.sessionId === sessionId);
  };

  // A session already running outside this window must not be resumed again: two processes would append to one transcript.
  const openSession = async (meta: SessionMeta): Promise<void> => {
    const openTerminal = findSessionTerminal(meta.sessionId);
    if (openTerminal) {
      openTerminal.show();
      return;
    }
    const liveSession = (await liveMonitor.refresh()).get(meta.sessionId);
    if (liveSession === undefined) {
      await registry.pin(meta.sessionId);
      resumeSession(meta, log);
      return;
    }

    const isBackgroundAgent = liveSession.kind === "background" && liveSession.agentId !== undefined;
    const runningWhere = isBackgroundAgent ? "as a background agent" : `in another terminal (pid ${liveSession.pid ?? "unknown"})`;
    const choices = isBackgroundAgent ? [ATTACH_CHOICE, FORK_CHOICE] : [FORK_CHOICE];
    const choice = await vscode.window.showWarningMessage(
      `"${displayTitle(meta)}" is already running ${runningWhere}.`,
      {
        modal: true,
        detail: "Resuming it here would run two copies of the same conversation. Switch to the other one, or fork a copy with its own session ID.",
      },
      ...choices,
    );
    if (choice === ATTACH_CHOICE && liveSession.agentId !== undefined) {
      await registry.pin(meta.sessionId);
      attachBackgroundSession(meta, liveSession.agentId, log);
    } else if (choice === FORK_CHOICE) {
      const forkSessionId = randomUUID();
      const originalGroupRef =
        registry.assignments()[meta.sessionId] ?? autoGroupRefFor(meta, registry.labels()[meta.sessionId]);
      await registry.pin(forkSessionId);
      await registry.assign([forkSessionId], originalGroupRef);
      resumeSession(meta, log, forkSessionId);
    }
  };

  const pickDirectory = async (groupDirectories: string[], pickTitle: string): Promise<string | undefined> => {
    const workspaceDirectories = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
    const recentDirectories = sessionIndex.currentSessions
      .map((session) => session.resumeCwd ?? session.startCwd)
      .filter((directory) => fs.existsSync(directory));
    const uniqueDirectories = [...new Set([...groupDirectories, ...workspaceDirectories, ...recentDirectories])].slice(
      0,
      RECENT_DIRECTORY_LIMIT,
    );
    const directoryItems: DirectoryPickItem[] = uniqueDirectories.map((directory) => ({
      label: path.basename(directory),
      description: tildePath(directory),
      directory,
    }));
    const browseItem: DirectoryPickItem = { label: "$(folder-opened) Browse…", directory: undefined };
    const pickedItem = await vscode.window.showQuickPick([...directoryItems, browseItem], {
      title: pickTitle,
      matchOnDescription: true,
    });
    if (pickedItem === undefined || pickedItem.directory !== undefined) {
      return pickedItem?.directory;
    }
    const browsedFolders = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false });
    return browsedFolders?.[0]?.fsPath;
  };

  const suspendSessionsAfterAsking = async (pinnedSessions: PinnedSession[]): Promise<void> => {
    const runningSessions = runningClaudeSessions(pinnedSessions);
    const isConfirmed = await confirmStopBusySessions(
      busySessions(runningSessions, liveMonitor),
      SUSPEND_ANYWAY_CHOICE,
      "Suspending stops that work. The conversation up to now is kept and resumes later.",
    );
    if (isConfirmed) {
      await suspendSessions(runningSessions);
    }
  };

  const renameSession = async (pinned: PinnedSession): Promise<void> => {
    const currentTitle = pinnedSessionTitle(pinned);
    const renamePrompt = pinned.terminal === undefined ? "Rename session" : "Rename terminal";
    const newName = (await vscode.window.showInputBox({ prompt: renamePrompt, value: currentTitle }))?.trim();
    if (!newName || newName === currentTitle) {
      return;
    }
    await registry.setLabel(pinned.sessionId, newName);
    const terminal = findSessionTerminal(pinned.sessionId);
    if (terminal === undefined) {
      return;
    }
    terminal.show();
    await vscode.commands.executeCommand("workbench.action.terminal.renameWithArg", { name: newName });
    if (pinned.terminal !== undefined) {
      return;
    }
    if (liveMonitor.get(pinned.sessionId)?.status === "busy") {
      void vscode.window.showInformationMessage(
        "Overseer: renamed the row and the tab. Claude is mid-task, so run /rename yourself once it finishes to update its own title.",
      );
      return;
    }
    sendSlashCommand(terminal, `/rename ${newName.replace(/[\r\n]+/g, " ")}`);
  };

  // Busy sessions are skipped because Claude drops input typed while it works.
  const sendToIdleSessions = (sessionNodes: SessionNode[], slashCommand: string): void => {
    const idleTerminals = sessionNodes
      .filter((node) => node.pinned.terminal === undefined)
      .filter((node) => liveMonitor.get(node.pinned.sessionId)?.status !== "busy")
      .map((node) => findSessionTerminal(node.pinned.sessionId))
      .filter(isDefined);
    idleTerminals.forEach((terminal) => sendSlashCommand(terminal, slashCommand));
    if (idleTerminals.length === 1) {
      idleTerminals[0].show();
    }
  };

  const pickModel = async (): Promise<string | undefined> => {
    const pickedModel = await vscode.window.showQuickPick(MODEL_ALIASES, { placeHolder: "Switch the session's model" });
    return pickedModel?.label;
  };

  // Returns the prompt ready to send, or undefined when the user backs out of the picker or any question.
  const pickSessionPrompt = async (): Promise<string | undefined> => {
    const commands = parseSessionCommands(vscode.workspace.getConfiguration("overseer").get<unknown>("sessionCommands"));
    if (commands.length === 0) {
      void vscode.window.showInformationMessage("Overseer: no commands set up yet. Add some to overseer.sessionCommands.");
      return undefined;
    }
    const picked = await vscode.window.showQuickPick(
      commands.map((command) => ({ label: command.name, detail: command.prompt, command })),
      { placeHolder: "Send a command to the session", matchOnDetail: true },
    );
    if (picked === undefined) {
      return undefined;
    }
    const valuesByParameter: Record<string, string> = {};
    for (const parameterName of promptParameters(picked.command.prompt)) {
      const value = await vscode.window.showInputBox({ title: picked.command.name, prompt: parameterName });
      if (value === undefined) {
        return undefined;
      }
      valuesByParameter[parameterName] = value;
    }
    return fillPrompt(picked.command.prompt, valuesByParameter);
  };

  const findPinnedSession = (sessionId: string): PinnedSession | undefined => {
    const sessionNode = sessionViews
      .flatMap((sessionView) => sessionView.selection)
      .find((node): node is SessionNode => node.kind === "session" && node.pinned.sessionId === sessionId);
    return sessionNode?.pinned;
  };

  const openTerminalSession = async (pinned: PinnedSession): Promise<void> => {
    if (pinned.terminal === undefined) {
      return;
    }
    const openTerminal = findSessionTerminal(pinned.sessionId);
    if (openTerminal !== undefined) {
      openTerminal.show();
      return;
    }
    const terminal = openShellTerminal(pinned.sessionId, pinnedSessionTitle(pinned), pinned.terminal.cwd, log);
    await registry.setTerminalShellPid(pinned.sessionId, await terminal?.processId);
  };

  let lastClick: { sessionId: string; atMs: number } | undefined;

  const renameGroup = async (groupNode: GroupNode): Promise<void> => {
    const group = groupNode.group;
    const newName = await vscode.window.showInputBox({ prompt: "Rename group", value: group.label });
    if (!newName || newName === group.label) {
      return;
    }
    if (group.kind === "user") {
      await registry.renameGroup(group.ref.slice("user:".length), newName);
      return;
    }
    // Renaming an auto group turns it into a user group that keeps its current sessions.
    const createdGroup = await registry.createGroup(newName, randomUUID());
    await registry.assign(
      group.sessions.map((pinned) => pinned.sessionId),
      userGroupRef(createdGroup.id),
    );
    await registry.replaceGroupRef(group.ref, userGroupRef(createdGroup.id));
  };

  return [
    ...selectionListeners,
    vscode.commands.registerCommand("overseer.allSessions", async () => {
      const pickedSession = await pickSession(sessionIndex, liveMonitor, registry);
      if (pickedSession) {
        await openSession(pickedSession);
      }
    }),
    vscode.commands.registerCommand("overseer.addExistingToGroup", async (clickedNode?: TreeNode) => {
      if (clickedNode?.kind !== "group") {
        return;
      }
      const pickedSession = await pickSession(sessionIndex, liveMonitor, registry);
      if (pickedSession === undefined) {
        return;
      }
      if (clickedNode.group.kind !== "ungrouped") {
        await registry.assign([pickedSession.sessionId], clickedNode.group.ref);
      }
      await registry.pin(pickedSession.sessionId);
      await openSession(pickedSession);
    }),
    vscode.commands.registerCommand("overseer.refreshIndex", async () => {
      await Promise.all([sessionIndex.refresh(), liveMonitor.refresh()]);
    }),
    vscode.commands.registerCommand("overseer.focusSession", (sessionId: string) => {
      findSessionTerminal(sessionId)?.show();
    }),
    vscode.commands.registerCommand("overseer.resumeSession", async (clickedNode?: TreeNode) => {
      for (const sessionNode of selectedSessionNodes(clickedNode)) {
        if (sessionNode.pinned.terminal !== undefined) {
          await openTerminalSession(sessionNode.pinned);
          continue;
        }
        const sessionId = sessionNode.pinned.sessionId;
        const meta = sessionNode.pinned.meta ?? (await findSessionMeta(sessionId));
        if (meta === undefined) {
          void vscode.window.showErrorMessage(`Overseer: no transcript found for session ${sessionId}.`);
          continue;
        }
        await openSession(meta);
      }
    }),
    vscode.commands.registerCommand("overseer.unpinSession", async (clickedNode?: TreeNode) => {
      for (const sessionNode of selectedSessionNodes(clickedNode)) {
        await registry.unpin(sessionNode.pinned.sessionId);
      }
    }),
    // The transcript stays on disk, so a killed session can still be resumed from All Sessions.
    vscode.commands.registerCommand("overseer.killSession", async (clickedNode?: TreeNode) => {
      const liveSessions = await liveMonitor.refresh();
      for (const sessionNode of selectedSessionNodes(clickedNode)) {
        const sessionId = sessionNode.pinned.sessionId;
        const terminal = findSessionTerminal(sessionId);
        const liveSession = liveSessions.get(sessionId);
        if (terminal !== undefined) {
          terminal.dispose();
        } else if (liveSession?.pid !== undefined && liveSession.kind !== "background") {
          killProcess(liveSession.pid, log);
        }
        await registry.unpin(sessionId);
      }
    }),
    // The row stays, now closed, so Open Terminal can start the shell again.
    vscode.commands.registerCommand("overseer.killTerminal", (clickedNode?: TreeNode) => {
      for (const sessionNode of selectedSessionNodes(clickedNode)) {
        findSessionTerminal(sessionNode.pinned.sessionId)?.dispose();
      }
    }),
    // A user group moves as a whole. Auto and Ungrouped groups only move their sessions.
    vscode.commands.registerCommand("overseer.moveToWorkspace", async (clickedNode?: TreeNode) => {
      const groupNode = clickedNode?.kind === "group" ? clickedNode : undefined;
      const sessionIds =
        groupNode === undefined
          ? selectedSessionNodes(clickedNode).map((node) => node.pinned.sessionId)
          : groupNode.group.sessions.map((pinned) => pinned.sessionId);
      if (groupNode === undefined && sessionIds.length === 0) {
        return;
      }
      const targetWorkspaceId = await pickTargetWorkspace(registry);
      if (targetWorkspaceId === undefined) {
        return;
      }
      if (groupNode?.group.kind === "user") {
        await registry.moveGroupToWorkspace(groupNode.group.ref.slice("user:".length), targetWorkspaceId);
      }
      await registry.moveToWorkspace(sessionIds, targetWorkspaceId);
    }),
    vscode.commands.registerCommand("overseer.newGroup", async () => {
      const groupName = await vscode.window.showInputBox({ prompt: "New group name", placeHolder: "PROJ-2567 login timeout" });
      if (groupName) {
        await registry.createGroup(groupName, randomUUID());
      }
    }),
    vscode.commands.registerCommand("overseer.renameGroup", async (clickedNode?: TreeNode) => {
      const groupNode = clickedNode ?? activeSessionView.selection[0];
      if (groupNode?.kind === "group" && groupNode.group.kind !== "ungrouped") {
        await renameGroup(groupNode);
      }
    }),
    vscode.commands.registerCommand("overseer.deleteGroup", async (clickedNode?: TreeNode) => {
      const groupNode = clickedNode ?? activeSessionView.selection[0];
      if (groupNode?.kind === "group" && groupNode.group.kind === "user") {
        await registry.deleteGroup(groupNode.group.ref.slice("user:".length));
      }
    }),
    vscode.commands.registerCommand("overseer.rename", async () => {
      const selectedNode = activeSessionView.selection[0];
      if (selectedNode?.kind === "session") {
        await renameSession(selectedNode.pinned);
      } else if (selectedNode?.kind === "group" && selectedNode.group.kind !== "ungrouped") {
        await renameGroup(selectedNode);
      }
    }),
    vscode.commands.registerCommand("overseer.renameSession", async (clickedNode?: TreeNode) => {
      const sessionNode = selectedSessionNodes(clickedNode)[0];
      if (sessionNode) {
        await renameSession(sessionNode.pinned);
      }
    }),
    vscode.commands.registerCommand("overseer.renameTerminal", async (clickedNode?: TreeNode) => {
      const sessionNode = selectedSessionNodes(clickedNode)[0];
      if (sessionNode) {
        await renameSession(sessionNode.pinned);
      }
    }),
    // Tree items have no double-click event, so two clicks on the same session in quick succession count as one.
    vscode.commands.registerCommand("overseer.clickSession", async (sessionId: string) => {
      const nowMs = Date.now();
      const isDoubleClick = lastClick?.sessionId === sessionId && nowMs - lastClick.atMs < DOUBLE_CLICK_WINDOW_MS;
      lastClick = isDoubleClick ? undefined : { sessionId, atMs: nowMs };
      const pinned = findPinnedSession(sessionId);
      if (isDoubleClick && pinned) {
        await renameSession(pinned);
        return;
      }
      findSessionTerminal(sessionId)?.show(true);
    }),
    vscode.commands.registerCommand("overseer.newSession", async (clickedNode?: TreeNode) => {
      const groupDirectories =
        clickedNode?.kind === "group" ? clickedNode.group.sessions.map(sessionDirectory).filter(isDefined) : [];
      const startDirectory = await pickDirectory(groupDirectories, "New Claude session: where should it start?");
      if (startDirectory === undefined) {
        return;
      }
      const sessionName = (
        await vscode.window.showInputBox({
          title: `New Claude session in ${tildePath(startDirectory)}`,
          prompt: "Name (optional). A ticket key like PROJ-2567 files it under that ticket.",
        })
      )?.trim();
      if (sessionName === undefined) {
        return;
      }
      const sessionId = randomUUID();
      await registry.addPendingSession(sessionId, { cwd: startDirectory, createdAtMs: Date.now() });
      if (sessionName !== "") {
        await registry.setLabel(sessionId, sessionName);
      }
      // Ungrouped stays implicit so a ticket key in the name still files the session under that ticket.
      if (clickedNode?.kind === "group" && clickedNode.group.kind !== "ungrouped") {
        await registry.assign([sessionId], clickedNode.group.ref);
      }
      await registry.pin(sessionId);
      startNewSession(sessionId, sessionName === "" ? undefined : sessionName, startDirectory, log);
    }),
    vscode.commands.registerCommand("overseer.newTerminal", async (clickedNode?: TreeNode) => {
      const groupDirectories =
        clickedNode?.kind === "group" ? clickedNode.group.sessions.map(sessionDirectory).filter(isDefined) : [];
      const startDirectory = await pickDirectory(groupDirectories, "New terminal: where should it open?");
      if (startDirectory === undefined) {
        return;
      }
      const terminalName = (
        await vscode.window.showInputBox({
          title: `New terminal in ${tildePath(startDirectory)}`,
          prompt: "Name (optional). A ticket key like PROJ-2567 files it under that ticket.",
        })
      )?.trim();
      if (terminalName === undefined) {
        return;
      }
      const sessionId = randomUUID();
      await registry.addTerminalSession(sessionId, { cwd: startDirectory, createdAtMs: Date.now() });
      if (terminalName !== "") {
        await registry.setLabel(sessionId, terminalName);
      }
      if (clickedNode?.kind === "group" && clickedNode.group.kind !== "ungrouped") {
        await registry.assign([sessionId], clickedNode.group.ref);
      }
      await registry.pin(sessionId);
      const terminal = openShellTerminal(sessionId, terminalName === "" ? "Terminal" : terminalName, startDirectory, log);
      await registry.setTerminalShellPid(sessionId, await terminal?.processId);
    }),
    vscode.commands.registerCommand("overseer.openTerminal", async (clickedNode?: TreeNode) => {
      for (const sessionNode of selectedSessionNodes(clickedNode)) {
        await openTerminalSession(sessionNode.pinned);
      }
    }),
    vscode.commands.registerCommand("overseer.suspendSession", async (clickedNode?: TreeNode) => {
      await suspendSessionsAfterAsking(selectedSessionNodes(clickedNode).map((node) => node.pinned));
    }),
    vscode.commands.registerCommand("overseer.compactSession", (clickedNode?: TreeNode) => {
      sendToIdleSessions(selectedSessionNodes(clickedNode), "/compact");
    }),
    vscode.commands.registerCommand("overseer.clearSession", (clickedNode?: TreeNode) => {
      sendToIdleSessions(selectedSessionNodes(clickedNode), "/clear");
    }),
    vscode.commands.registerCommand("overseer.costSession", (clickedNode?: TreeNode) => {
      sendToIdleSessions(selectedSessionNodes(clickedNode), "/cost");
    }),
    vscode.commands.registerCommand("overseer.switchModel", async (clickedNode?: TreeNode) => {
      const sessionNodes = selectedSessionNodes(clickedNode);
      const modelAlias = await pickModel();
      if (modelAlias !== undefined) {
        sendToIdleSessions(sessionNodes, `/model ${modelAlias}`);
      }
    }),
    vscode.commands.registerCommand("overseer.runSessionCommand", async (clickedNode?: TreeNode) => {
      const sessionNodes = selectedSessionNodes(clickedNode);
      const prompt = await pickSessionPrompt();
      if (prompt !== undefined) {
        sendToIdleSessions(sessionNodes, prompt);
      }
    }),
    // The resources panel passes a session ID; the context menu passes the clicked node.
    vscode.commands.registerCommand("overseer.findResources", async (clicked?: TreeNode | string) => {
      const sessionMetas =
        typeof clicked === "string"
          ? [await findSessionMeta(clicked)].filter(isDefined)
          : selectedSessionNodes(clicked)
              .map((node) => node.pinned.meta)
              .filter(isDefined);
      linkStatusService.clear();
      for (const meta of sessionMetas) {
        await registry.setSessionExpanded(meta.sessionId, true);
        await registry.markResourcesFound(meta.sessionId);
      }
      await vscode.window.withProgress(
        { location: { viewId: "overseer.sessions" }, title: "Finding resources" },
        () => Promise.all(sessionMetas.map((meta) => linkService.findResources(meta))),
      );
    }),
    vscode.commands.registerCommand("overseer.toggleRemovedLinks", async () => {
      const linksConfig = vscode.workspace.getConfiguration("overseer.links");
      const isShown = !linksConfig.get<boolean>("showRemoved", false);
      await linksConfig.update("showRemoved", isShown, vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage(`Removed links ${isShown ? "shown" : "hidden"}.`);
    }),
    vscode.commands.registerCommand("overseer.openResources", (sessionId?: string) => {
      if (typeof sessionId === "string") {
        showResources(sessionId);
      }
    }),
    // The hover link passes a session ID; the context menu passes the clicked node.
    vscode.commands.registerCommand("overseer.summarizeSession", async (clicked?: TreeNode | string) => {
      if (typeof clicked === "string") {
        const hoveredMeta = await findSessionMeta(clicked);
        if (hoveredMeta !== undefined) {
          await summaryService.summarize(hoveredMeta);
        }
        return;
      }
      const sessionMetas = selectedSessionNodes(clicked)
        .map((node) => node.pinned.meta)
        .filter(isDefined);
      await Promise.all(sessionMetas.map((meta) => summaryService.summarize(meta)));
    }),
    // The Repos view passes a repo row; the session context menu passes the clicked session.
    vscode.commands.registerCommand("overseer.openRepoInScm", async (clicked?: TreeNode | RepoTreeNode) => {
      if (clicked?.kind === "repo" || clicked?.kind === "commit") {
        await openRepoInSourceControl(clicked.kind === "repo" ? clicked.repo.root : clicked.repoRoot, log);
        return;
      }
      const repoRoot = await pickRepo(clicked);
      if (repoRoot !== undefined) {
        await openRepoInSourceControl(repoRoot, log);
      }
    }),
    vscode.commands.registerCommand("overseer.setSessionStatus", async (clickedNode?: TreeNode) => {
      const sessionIds = selectedSessionNodes(clickedNode).map((node) => node.pinned.sessionId);
      if (sessionIds.length === 0) {
        return;
      }
      const statusIdBySession = registry.sessionStatusIds();
      const pickedStatusId = await pickSessionStatus(new Set(sessionIds.map((sessionId) => statusIdBySession[sessionId])));
      if (pickedStatusId === null) {
        return;
      }
      const pickedStatus = configuredStatuses().find((status) => status.id === pickedStatusId);
      if (pickedStatus?.asksReason !== true) {
        await registry.setSessionStatus(sessionIds, pickedStatusId);
        return;
      }
      const currentReason = sessionIds.length === 1 ? registry.sessionStatusReasons()[sessionIds[0]] : undefined;
      const reason = await askStatusReason(pickedStatus, currentReason);
      if (reason !== undefined) {
        await registry.setSessionStatus(sessionIds, pickedStatusId, reason.trim());
      }
    }),
    vscode.commands.registerCommand("overseer.suspendGroup", async (clickedNode?: TreeNode) => {
      const groupNode = clickedNode ?? activeSessionView.selection[0];
      if (groupNode?.kind === "group") {
        await suspendSessionsAfterAsking(groupNode.group.sessions);
      }
    }),
  ];
}

export async function openRepoInSourceControl(repoRoot: string, log: vscode.OutputChannel): Promise<void> {
  try {
    await vscode.commands.executeCommand("git.openRepository", repoRoot);
    await vscode.commands.executeCommand("workbench.view.scm");
  } catch (error) {
    log.appendLine(`Can't open ${repoRoot} in Source Control: ${String(error)}`);
    void vscode.window.showErrorMessage(`Overseer: can't open ${tildePath(repoRoot)} in Source Control. Is the Git extension on?`);
  }
}

function isDefined<Value>(value: Value | undefined): value is Value {
  return value !== undefined;
}

function killProcess(pid: number, log: vscode.OutputChannel): void {
  try {
    process.kill(pid, "SIGTERM");
    log.appendLine(`Killed Claude process ${pid}`);
  } catch (error) {
    log.appendLine(`Could not kill Claude process ${pid}: ${String(error)}`);
  }
}
