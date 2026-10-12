import { defaultJiraStatusColor } from "./jira";
import { DEFAULT_PR_COLORS, PR_STATUS_KEYS, PrStatusKey } from "./linkStatus";
import { KeyValueStore } from "./registry";

export interface JiraProject {
  key: string;
  isEnabled: boolean;
  statuses: string[];
  // Any ticket in the project; get_workflow needs one to list the project's statuses.
  sampleTicketKey: string;
}

const JIRA_PROJECTS_KEY = "overseer.jiraProjects";
const JIRA_COLORS_KEY = "overseer.jiraStatusColors";
const PR_COLORS_KEY = "overseer.prStatusColors";

type ProjectColors = Record<string, Record<string, string>>;

// Projects and colors are shared by every window, so each change re-reads the store before it writes.
export class StatusConfig {
  private readonly changeListeners: Array<() => void> = [];

  constructor(private readonly store: KeyValueStore) {}

  onDidChange(listener: () => void): { dispose(): void } {
    this.changeListeners.push(listener);
    return {
      dispose: () => {
        const listenerIndex = this.changeListeners.indexOf(listener);
        if (listenerIndex !== -1) {
          this.changeListeners.splice(listenerIndex, 1);
        }
      },
    };
  }

  projects(): JiraProject[] {
    return Object.values(this.allProjects()).sort((left, right) => left.key.localeCompare(right.key));
  }

  project(projectKey: string): JiraProject | undefined {
    return this.allProjects()[projectKey];
  }

  isProjectEnabled(projectKey: string): boolean {
    return this.project(projectKey)?.isEnabled ?? true;
  }

  // Returns true when the project is new, so the caller can fetch its workflow.
  async noteProject(projectKey: string, sampleTicketKey: string): Promise<boolean> {
    if (this.project(projectKey) !== undefined) {
      return false;
    }
    await this.writeProject({ key: projectKey, isEnabled: true, statuses: [], sampleTicketKey });
    return true;
  }

  // Workflows can differ by issue type, so statuses only ever add up.
  async addStatuses(projectKey: string, statusNames: string[]): Promise<void> {
    const existingProject = this.project(projectKey);
    if (existingProject === undefined) {
      return;
    }
    const newStatuses = statusNames.filter((statusName) => !existingProject.statuses.includes(statusName));
    if (newStatuses.length > 0) {
      await this.writeProject({ ...existingProject, statuses: [...existingProject.statuses, ...newStatuses] });
    }
  }

  async setProjectEnabled(projectKey: string, isEnabled: boolean): Promise<void> {
    const existingProject = this.project(projectKey);
    if (existingProject !== undefined) {
      await this.writeProject({ ...existingProject, isEnabled });
    }
  }

  jiraColor(projectKey: string, statusName: string): string {
    return this.allJiraColors()[projectKey]?.[statusName] ?? defaultJiraStatusColor(statusName);
  }

  async setJiraColor(projectKey: string, statusName: string, color: string): Promise<void> {
    const allColors = this.allJiraColors();
    await this.write(JIRA_COLORS_KEY, { ...allColors, [projectKey]: { ...allColors[projectKey], [statusName]: color } });
  }

  async resetJiraColors(): Promise<void> {
    await this.write(JIRA_COLORS_KEY, {});
  }

  prColor(statusKey: string): string {
    const savedColors = this.store.get<Record<string, string>>(PR_COLORS_KEY) ?? {};
    return savedColors[statusKey] ?? DEFAULT_PR_COLORS[statusKey as PrStatusKey] ?? DEFAULT_PR_COLORS.open;
  }

  prColors(): Record<PrStatusKey, string> {
    return Object.fromEntries(PR_STATUS_KEYS.map((statusKey) => [statusKey, this.prColor(statusKey)])) as Record<
      PrStatusKey,
      string
    >;
  }

  async setPrColor(statusKey: PrStatusKey, color: string): Promise<void> {
    const savedColors = this.store.get<Record<string, string>>(PR_COLORS_KEY) ?? {};
    await this.write(PR_COLORS_KEY, { ...savedColors, [statusKey]: color });
  }

  async resetPrColors(): Promise<void> {
    await this.write(PR_COLORS_KEY, {});
  }

  notifyExternalChange(): void {
    this.changeListeners.forEach((listener) => listener());
  }

  private allProjects(): Record<string, JiraProject> {
    return this.store.get<Record<string, JiraProject>>(JIRA_PROJECTS_KEY) ?? {};
  }

  private allJiraColors(): ProjectColors {
    return this.store.get<ProjectColors>(JIRA_COLORS_KEY) ?? {};
  }

  private async writeProject(project: JiraProject): Promise<void> {
    await this.write(JIRA_PROJECTS_KEY, { ...this.allProjects(), [project.key]: project });
  }

  private async write(key: string, value: unknown): Promise<void> {
    await this.store.update(key, value);
    this.notifyExternalChange();
  }
}
