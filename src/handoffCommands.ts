import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { PinnedSession } from "./grouping";
import {
  approvedHandoffFile,
  draftSourceSessionId,
  handoffDraftFile,
  handoffDraftsDir,
  handoffSeedPrompt,
  reviseHandoffPrompt,
  sessionOrderWithBelow,
  writeHandoffPrompt,
} from "./handoff";
import { LiveSessionMonitor } from "./liveSessions";
import { tildePath } from "./paths";
import { Registry } from "./registry";
import { sessionDirectory } from "./repoSet";
import { SessionFocusTracker } from "./sessionFocus";
import { SessionIndex } from "./sessionIndex";
import { findSessionTerminal, sendSlashCommand, startNewSession, suspendTerminal } from "./terminals";
import { TreeNode } from "./tree";

export interface HandoffDependencies {
  claudeHome: string;
  sessionIndex: SessionIndex;
  liveMonitor: LiveSessionMonitor;
  registry: Registry;
  sessionFocus: SessionFocusTracker;
  pinnedSessions: () => PinnedSession[];
  // The session ids of the group holding a session, in the order the sidebar shows them.
  groupSessionIdsHolding: (sessionId: string) => string[];
  log: vscode.OutputChannel;
}

const DRAFT_WAIT_MS = 10 * 60 * 1000;

interface ApproveModeItem extends vscode.QuickPickItem {
  mode: "below" | "replace";
}

const APPROVE_MODES: ApproveModeItem[] = [
  { mode: "below", label: "Start below", detail: "A new session starts under this one. The old session stays." },
  { mode: "replace", label: "Replace", detail: "The old session exits. The new session takes its place." },
];

export function registerHandoffCommands(dependencies: HandoffDependencies): vscode.Disposable[] {
  const { claudeHome, sessionIndex, liveMonitor, registry, sessionFocus, pinnedSessions, groupSessionIdsHolding, log } = dependencies;
  const draftWatchers = new Map<string, vscode.Disposable>();

  // The tree passes the clicked node, the Session sidebar a session ID, and the palette nothing, so it acts on the focused session.
  const targetSessionId = (clicked?: TreeNode | string): string | undefined => {
    if (typeof clicked === "string") {
      return clicked;
    }
    if (clicked?.kind === "session") {
      return clicked.pinned.sessionId;
    }
    return clicked === undefined ? sessionFocus.focusedSessionId() : undefined;
  };

  // Claude drops input typed while it works, and a session running elsewhere has no terminal to type into.
  const idleTerminalOf = (sessionId: string, action: string): vscode.Terminal | undefined => {
    const terminal = findSessionTerminal(sessionId);
    if (terminal === undefined) {
      void vscode.window.showInformationMessage(`Overseer: ${action} needs the session running in a terminal in this window.`);
      return undefined;
    }
    if (liveMonitor.get(sessionId)?.status === "busy") {
      void vscode.window.showInformationMessage(`Overseer: Claude is mid-task. ${action} once it finishes.`);
      return undefined;
    }
    return terminal;
  };

  const stopWatchingDraft = (sourceSessionId: string): void => {
    draftWatchers.get(sourceSessionId)?.dispose();
    draftWatchers.delete(sourceSessionId);
  };

  const openDraftWhenWritten = (sourceSessionId: string): void => {
    stopWatchingDraft(sourceSessionId);
    const draftsDir = handoffDraftsDir(claudeHome);
    const draftPath = handoffDraftFile(claudeHome, sourceSessionId);
    const draftFileName = path.basename(draftPath);
    let watcher: fs.FSWatcher | undefined;
    const openDraft = (): void => {
      if (!fs.existsSync(draftPath) || fs.statSync(draftPath).size === 0) {
        return;
      }
      stopWatchingDraft(sourceSessionId);
      void vscode.window.showTextDocument(vscode.Uri.file(draftPath), { preview: false });
    };
    try {
      watcher = fs.watch(draftsDir, (_event, changedFileName) => {
        if (changedFileName === null || changedFileName.toString() === draftFileName) {
          openDraft();
        }
      });
    } catch (error) {
      log.appendLine(`Can't watch ${draftsDir}: ${String(error)}`);
      return;
    }
    const timeoutHandle = setTimeout(() => {
      stopWatchingDraft(sourceSessionId);
      void vscode.window.showInformationMessage(`Overseer: no handoff draft showed up at ${tildePath(draftPath)}.`);
    }, DRAFT_WAIT_MS);
    draftWatchers.set(sourceSessionId, {
      dispose: () => {
        watcher?.close();
        clearTimeout(timeoutHandle);
      },
    });
  };

  const startHandoff = async (clicked?: TreeNode | string): Promise<void> => {
    const sourceSessionId = targetSessionId(clicked);
    if (sourceSessionId === undefined) {
      void vscode.window.showInformationMessage("Overseer: focus a session first.");
      return;
    }
    if (idleTerminalOf(sourceSessionId, "Handoff") === undefined) {
      return;
    }
    const extraRules = await vscode.window.showInputBox({
      title: "Handoff",
      prompt: "Extra rules for the handoff (optional)",
      placeHolder: "e.g. include the test plan",
    });
    if (extraRules === undefined) {
      return;
    }
    // Recheck after the input box: the session may have started work or closed while it was open.
    const terminal = idleTerminalOf(sourceSessionId, "Handoff");
    if (terminal === undefined) {
      return;
    }
    const draftPath = handoffDraftFile(claudeHome, sourceSessionId);
    try {
      await fs.promises.mkdir(handoffDraftsDir(claudeHome), { recursive: true });
      await fs.promises.rm(draftPath, { force: true });
    } catch (error) {
      log.appendLine(`Can't prepare ${draftPath}: ${String(error)}`);
      void vscode.window.showErrorMessage(`Overseer: can't prepare ${tildePath(draftPath)}. See the Overseer output.`);
      return;
    }
    openDraftWhenWritten(sourceSessionId);
    sendSlashCommand(terminal, writeHandoffPrompt(draftPath, extraRules));
    log.appendLine(`Asked ${sourceSessionId} for a handoff at ${draftPath}`);
  };

  // An editor title button passes the file's URI; a keybinding passes nothing, so the active editor is used.
  const targetDraft = (clickedUri?: vscode.Uri): { draftPath: string; sourceSessionId: string } | undefined => {
    const draftUri = clickedUri instanceof vscode.Uri ? clickedUri : vscode.window.activeTextEditor?.document.uri;
    const draftPath = draftUri?.fsPath;
    const sourceSessionId = draftPath === undefined ? undefined : draftSourceSessionId(claudeHome, draftPath);
    if (draftPath === undefined || sourceSessionId === undefined) {
      void vscode.window.showInformationMessage("Overseer: open a handoff draft first.");
      return undefined;
    }
    return { draftPath, sourceSessionId };
  };

  const openDocumentAt = (filePath: string): vscode.TextDocument | undefined =>
    vscode.workspace.textDocuments.find((document) => document.uri.fsPath === filePath);

  const saveDraft = async (draftPath: string): Promise<boolean> => {
    const document = openDocumentAt(draftPath);
    return document === undefined || !document.isDirty || (await document.save());
  };

  const closeDraftTabs = async (draftPath: string): Promise<void> => {
    const draftTabs = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.fsPath === draftPath);
    if (draftTabs.length > 0) {
      await vscode.window.tabGroups.close(draftTabs, true);
    }
  };

  const reviseHandoff = async (clickedUri?: vscode.Uri): Promise<void> => {
    const draft = targetDraft(clickedUri);
    if (draft === undefined || !(await saveDraft(draft.draftPath))) {
      return;
    }
    const feedback = (await vscode.window.showInputBox({ title: "Revise Handoff", prompt: "What should change?" }))?.trim();
    if (!feedback) {
      return;
    }
    const terminal = idleTerminalOf(draft.sourceSessionId, "Revise");
    if (terminal !== undefined) {
      sendSlashCommand(terminal, reviseHandoffPrompt(draft.draftPath, feedback));
    }
  };

  // A dirty draft is reverted first, so closing its tab doesn't ask to save a file that is about to be deleted.
  const cancelHandoff = async (clickedUri?: vscode.Uri): Promise<void> => {
    const draft = targetDraft(clickedUri);
    if (draft === undefined) {
      return;
    }
    stopWatchingDraft(draft.sourceSessionId);
    const document = openDocumentAt(draft.draftPath);
    if (document?.isDirty) {
      await vscode.window.showTextDocument(document);
      await vscode.commands.executeCommand("workbench.action.files.revert");
    }
    await closeDraftTabs(draft.draftPath);
    await fs.promises.rm(draft.draftPath, { force: true });
  };

  const sessionCwd = (sessionId: string): string | undefined => {
    const pinned = pinnedSessions().find((session) => session.sessionId === sessionId);
    const pinnedDirectory = pinned === undefined ? undefined : sessionDirectory(pinned);
    const meta = sessionIndex.currentSessions.find((session) => session.sessionId === sessionId);
    return pinnedDirectory ?? meta?.resumeCwd ?? meta?.startCwd;
  };

  const startBelow = async (sourceSessionId: string, newSessionId: string, cwd: string, seedPrompt: string): Promise<void> => {
    const sourceLabel = registry.labels()[sourceSessionId];
    const sourceGroupRef = registry.assignments()[sourceSessionId];
    const displayedGroupIds = groupSessionIdsHolding(sourceSessionId);
    await registry.addPendingSession(newSessionId, { cwd, createdAtMs: Date.now() });
    if (sourceLabel !== undefined) {
      await registry.setLabel(newSessionId, sourceLabel);
    }
    if (sourceGroupRef !== undefined) {
      await registry.assign([newSessionId], sourceGroupRef);
    }
    await registry.setSessionOrder(sessionOrderWithBelow(registry.sessionOrder(), displayedGroupIds, sourceSessionId, newSessionId));
    await registry.pin(newSessionId);
    startNewSession(newSessionId, sourceLabel, cwd, log, seedPrompt);
  };

  // moveSession skips a target that is already pinned, so it runs before the new session is pinned.
  const replaceSession = async (
    sourceTerminal: vscode.Terminal,
    sourceSessionId: string,
    newSessionId: string,
    cwd: string,
    seedPrompt: string,
  ): Promise<void> => {
    await suspendTerminal(sourceTerminal);
    await registry.addPendingSession(newSessionId, { cwd, createdAtMs: Date.now() });
    await registry.copyTicketMarks(sourceSessionId, newSessionId);
    await registry.moveSession(sourceSessionId, newSessionId);
    await registry.pin(newSessionId);
    startNewSession(newSessionId, registry.labels()[newSessionId], cwd, log, seedPrompt);
  };

  const approveHandoff = async (clickedUri?: vscode.Uri): Promise<void> => {
    const draft = targetDraft(clickedUri);
    if (draft === undefined || !(await saveDraft(draft.draftPath))) {
      return;
    }
    const { draftPath, sourceSessionId } = draft;
    const cwd = sessionCwd(sourceSessionId);
    if (cwd === undefined) {
      void vscode.window.showErrorMessage(`Overseer: can't tell where session ${sourceSessionId} ran, so the new session has nowhere to start.`);
      return;
    }
    const pickedMode = await vscode.window.showQuickPick(APPROVE_MODES, { title: "Approve Handoff", placeHolder: "Where should the new session go?" });
    if (pickedMode === undefined) {
      return;
    }
    // Replacing a session that is busy or live elsewhere would leave two processes on one transcript.
    const sourceTerminal = pickedMode.mode === "replace" ? idleTerminalOf(sourceSessionId, "Replace") : undefined;
    if (pickedMode.mode === "replace" && sourceTerminal === undefined) {
      return;
    }

    const newSessionId = randomUUID();
    const approvedPath = approvedHandoffFile(claudeHome, newSessionId);
    stopWatchingDraft(sourceSessionId);
    await closeDraftTabs(draftPath);
    try {
      await fs.promises.rename(draftPath, approvedPath);
    } catch (error) {
      log.appendLine(`Can't move ${draftPath} to ${approvedPath}: ${String(error)}`);
      void vscode.window.showErrorMessage(`Overseer: can't save the handoff to ${tildePath(approvedPath)}. See the Overseer output.`);
      return;
    }
    log.appendLine(`Handoff from ${sourceSessionId} approved as ${approvedPath} (${pickedMode.mode})`);
    const seedPrompt = handoffSeedPrompt(approvedPath);
    if (sourceTerminal !== undefined) {
      await replaceSession(sourceTerminal, sourceSessionId, newSessionId, cwd, seedPrompt);
    } else {
      await startBelow(sourceSessionId, newSessionId, cwd, seedPrompt);
    }
  };

  return [
    vscode.commands.registerCommand("overseer.handoffSession", startHandoff),
    vscode.commands.registerCommand("overseer.handoffRevise", reviseHandoff),
    vscode.commands.registerCommand("overseer.handoffApprove", approveHandoff),
    vscode.commands.registerCommand("overseer.handoffCancel", cancelHandoff),
    { dispose: () => [...draftWatchers.keys()].forEach(stopWatchingDraft) },
  ];
}
