import * as vscode from "vscode";
import { SettingsPanel, SettingsPanelDependencies, SettingsSection } from "./settingsPanel";

interface SectionCommand {
  command: string;
  section: SettingsSection | undefined;
}

const SECTION_COMMANDS: SectionCommand[] = [
  { command: "overseer.openSettings", section: undefined },
  { command: "overseer.openSessionSettings", section: "sessions" },
  { command: "overseer.openStatusSettings", section: "statuses" },
  { command: "overseer.openJiraSettings", section: "jira" },
  { command: "overseer.openGithubSettings", section: "github" },
];

interface IntegrationSwitch {
  name: string;
  settingKey: string;
}

// Each integration gets an Enable and a Disable command; package.json shows only the one that applies.
const INTEGRATION_SWITCHES: Record<string, IntegrationSwitch> = {
  Jira: { name: "Jira", settingKey: "jira.enabled" },
  Github: { name: "GitHub", settingKey: "github.enabled" },
  Artifacts: { name: "Artifact links", settingKey: "artifacts.enabled" },
};

const EXTENSION_SETTINGS_QUERY = "@ext:djaunt.djaunt-overseer";

export function registerSettingsCommands(dependencies: SettingsPanelDependencies): vscode.Disposable[] {
  const sectionCommands = SECTION_COMMANDS.map((sectionCommand) =>
    vscode.commands.registerCommand(sectionCommand.command, () => SettingsPanel.show(dependencies, sectionCommand.section)),
  );
  const switchCommands = Object.entries(INTEGRATION_SWITCHES).flatMap(([commandSuffix, integration]) =>
    [true, false].map((isEnabled) =>
      vscode.commands.registerCommand(`overseer.${isEnabled ? "enable" : "disable"}${commandSuffix}`, async () => {
        await vscode.workspace
          .getConfiguration("overseer.links")
          .update(integration.settingKey, isEnabled, vscode.ConfigurationTarget.Global);
        void vscode.window.showInformationMessage(`${integration.name} ${isEnabled ? "on" : "off"}.`);
      }),
    ),
  );
  return [
    ...sectionCommands,
    ...switchCommands,
    vscode.commands.registerCommand("overseer.openAllSettings", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", EXTENSION_SETTINGS_QUERY),
    ),
  ];
}
