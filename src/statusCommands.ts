import * as vscode from "vscode";
import { JiraService } from "./jiraService";
import { LinkStatusService } from "./linkStatusService";
import { StatusConfig } from "./statusConfig";
import { StatusSettingsPanel } from "./statusSettingsPanel";
import { TreeNode } from "./tree";

interface StatusCommandDependencies {
  jiraService: JiraService;
  linkStatusService: LinkStatusService;
  statusConfig: StatusConfig;
}

interface TransitionPickItem extends vscode.QuickPickItem {
  transitionName: string;
}

export function registerStatusCommands(dependencies: StatusCommandDependencies): vscode.Disposable[] {
  const { jiraService, linkStatusService, statusConfig } = dependencies;

  const refreshProjects = async (): Promise<void> => {
    await Promise.all(
      statusConfig.projects().map((project) => linkStatusService.loadProjectStatuses(project.key, project.sampleTicketKey)),
    );
  };

  return [
    vscode.commands.registerCommand("overseer.openStatusSettings", () => StatusSettingsPanel.show(statusConfig, refreshProjects)),
    vscode.commands.registerCommand("overseer.refreshJiraProjects", async () => {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Refreshing Jira statuses" },
        refreshProjects,
      );
    }),
    vscode.commands.registerCommand("overseer.moveTicketStatus", async (clickedNode?: TreeNode) => {
      if (clickedNode?.kind !== "link" || clickedNode.link.kind !== "ticket") {
        return;
      }
      await moveTicket(clickedNode.link.id, jiraService, linkStatusService);
    }),
  ];
}

async function moveTicket(ticketKey: string, jiraService: JiraService, linkStatusService: LinkStatusService): Promise<void> {
  let workflow;
  try {
    workflow = await vscode.window.withProgress(
      { location: { viewId: "overseer.sessions" }, title: `Loading ${ticketKey} transitions` },
      () => jiraService.workflow(ticketKey),
    );
  } catch (error) {
    void vscode.window.showErrorMessage(`Couldn't load transitions for ${ticketKey}: ${errorText(error)}`);
    return;
  }
  const transitions = (workflow?.transitions ?? []).filter((transition) => transition.toStatus !== workflow?.currentStatus);
  if (transitions.length === 0) {
    void vscode.window.showInformationMessage(`${ticketKey} has no other status to move to.`);
    return;
  }
  const pickItems: TransitionPickItem[] = transitions.map((transition) => ({
    label: transition.toStatus,
    description: transition.name === transition.toStatus ? undefined : transition.name,
    transitionName: transition.name,
  }));
  const picked = await vscode.window.showQuickPick(pickItems, {
    title: `Move ${ticketKey}`,
    placeHolder: `Now: ${workflow?.currentStatus ?? "unknown"}`,
  });
  if (picked === undefined) {
    return;
  }
  try {
    await vscode.window.withProgress(
      { location: { viewId: "overseer.sessions" }, title: `Moving ${ticketKey} to ${picked.label}` },
      () => jiraService.transition(ticketKey, picked.transitionName),
    );
  } catch (error) {
    void vscode.window.showErrorMessage(`Couldn't move ${ticketKey} to ${picked.label}: ${errorText(error)}`);
    return;
  }
  linkStatusService.forgetTicket(ticketKey);
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split("\n")[0];
}
