import * as fs from "fs";
import * as path from "path";

export type GitRootResolver = (directory: string) => Promise<string | undefined>;

const WORKTREE_GITDIR_PATTERN = /^gitdir:\s*(.+?)[/\\]\.git[/\\]worktrees[/\\]/m;

// Memoizes every directory it walks through, so one index run stats each directory at most once.
export function createGitRootResolver(): GitRootResolver {
  const rootByDirectory = new Map<string, Promise<string | undefined>>();

  const resolve = (directory: string): Promise<string | undefined> => {
    const cachedRoot = rootByDirectory.get(directory);
    if (cachedRoot !== undefined) {
      return cachedRoot;
    }
    const pendingRoot = findRoot(directory);
    rootByDirectory.set(directory, pendingRoot);
    return pendingRoot;
  };

  const findRoot = async (directory: string): Promise<string | undefined> => {
    const gitEntry = path.join(directory, ".git");
    const gitStats = await fs.promises.stat(gitEntry).catch(() => undefined);
    if (gitStats?.isDirectory()) {
      return directory;
    }
    if (gitStats?.isFile()) {
      return mainRepoOfWorktree(gitEntry, directory);
    }
    const parentDirectory = path.dirname(directory);
    return parentDirectory === directory ? undefined : resolve(parentDirectory);
  };

  return resolve;
}

// A worktree's .git file points into the main repo's .git/worktrees; report the main repo instead.
async function mainRepoOfWorktree(gitFile: string, worktreeRoot: string): Promise<string> {
  const gitFileContent = await fs.promises.readFile(gitFile, "utf8").catch(() => "");
  return WORKTREE_GITDIR_PATTERN.exec(gitFileContent)?.[1] ?? worktreeRoot;
}
