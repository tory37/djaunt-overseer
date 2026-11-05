import type { RepoStatus } from "./repoService";

export const REPO_CLEAN_COLOR_ID = "overseer.repoClean";
export const REPO_DIRTY_COLOR_ID = "gitDecoration.modifiedResourceForeground";
export const REPO_FAILED_COLOR_ID = "problemsWarningIcon.foreground";
export const REPO_LOADING_COLOR_ID = "descriptionForeground";

export interface RepoRowColors {
  iconName: string;
  iconColorId: string;
  // Only a clean or dirty repo tints its label; a failed one shows its state in the icon.
  labelColorId: string | undefined;
}

export function repoRowColors(status: RepoStatus): RepoRowColors {
  if (status.kind === "loading") {
    return { iconName: "repo", iconColorId: REPO_LOADING_COLOR_ID, labelColorId: undefined };
  }
  if (status.kind === "failed") {
    return { iconName: "warning", iconColorId: REPO_FAILED_COLOR_ID, labelColorId: undefined };
  }
  const stateColorId = status.branchStatus.changedFileCount > 0 ? REPO_DIRTY_COLOR_ID : REPO_CLEAN_COLOR_ID;
  return { iconName: "repo", iconColorId: stateColorId, labelColorId: stateColorId };
}
