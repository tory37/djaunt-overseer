import * as vscode from "vscode";
import { JiraService } from "./jiraService";
import { LinkStatusService } from "./linkStatusService";
import { StatusConfig } from "./statusConfig";

interface StatusCommandDependencies {
  jiraService: JiraService;
  linkStatusService: LinkStatusService;
  statusConfig: StatusConfig;
}

interface TransitionPickItem extends vscode.QuickPickItem {
  transitionName: string;
}

export function jiraProjectRefresher(linkStatusService: LinkStatusService, statusConfig: StatusConfig): () => Promise<void> {
  return async () => {
    await Promise.all(
      statusConfig.projects().map((project) => linkStatusService.loadProjectStatuses(project.key, project.sampleTicketKey)),
    );
  };
}

export function registerStatusCommands(dependencies: StatusCommandDependencies): vscode.Disposable[] {
  const { jiraService, linkStatusService, statusConfig } = dependencies;
  const refreshProjects = jiraProjectRefresher(linkStatusService, statusConfig);

  return [
    vscode.commands.registerCommand("overseer.refreshJiraProjects", async () => {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Refreshing Jira statuses" },
        refreshProjects,
      );
    }),
    // The resources panel passes the ticket key.
    vscode.commands.registerCommand("overseer.moveTicketStatus", async (ticketKey?: string) => {
      if (typeof ticketKey === "string") {
        await moveTicket(ticketKey, jiraService, linkStatusService);
      }
    }),
  ];
}

async function moveTicket(ticketKey: string, jiraService: JiraService, linkStatusService: LinkStatusService): Promise<void> {
  let workflow;
  try {
    workflow = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: `Loading ${ticketKey} transitions` },
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
      { location: vscode.ProgressLocation.Window, title: `Moving ${ticketKey} to ${picked.label}` },
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
