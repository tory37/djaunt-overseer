import * as path from "path";

// Overseer builds its launch commands in POSIX shell syntax (`exec claude ...`, single-quoted prompts).
// On Windows that shell is Git Bash. System32\bash.exe is the WSL launcher, so it is never used.
const POSIX_FALLBACK_SHELL = "/bin/zsh";
const DEFAULT_WINDOWS_EXECUTABLE_EXTENSIONS = ".COM;.EXE;.BAT;.CMD";
const GIT_BASH_RELATIVE_PATH = path.win32.join("bin", "bash.exe");
const GIT_EXECUTABLE_NAME = "git.exe";
const GIT_ROOT_SEARCH_LEVELS = 3;
const PROGRAM_FILES_ENV_VARS = ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"];

export type Environment = Record<string, string | undefined>;
export type FileExists = (filePath: string) => boolean;

export const GIT_BASH_MISSING_MESSAGE =
  "Overseer needs Git Bash on Windows to start Claude sessions. Install Git for Windows, or run scripts/sync.sh from djaunt-dot-agents, then reload the window.";

// Git for Windows has <root>\bin\bash.exe. `git.exe` sits in <root>\cmd or <root>\mingw64\bin, so the root is up to two levels above it.
export function findGitBash(environment: Environment, fileExists: FileExists): string | undefined {
  const candidateRoots: string[] = [];

  for (const directory of (environment.PATH ?? "").split(";").filter((entry) => entry !== "")) {
    if (!fileExists(path.win32.join(directory, GIT_EXECUTABLE_NAME))) {
      continue;
    }
    let ancestor = directory;
    for (let level = 0; level < GIT_ROOT_SEARCH_LEVELS; level++) {
      candidateRoots.push(ancestor);
      ancestor = path.win32.dirname(ancestor);
    }
  }

  for (const programFilesVar of PROGRAM_FILES_ENV_VARS) {
    const programFilesDirectory = environment[programFilesVar];
    if (programFilesDirectory) {
      candidateRoots.push(path.win32.join(programFilesDirectory, "Git"));
    }
  }
  if (environment.LOCALAPPDATA) {
    candidateRoots.push(path.win32.join(environment.LOCALAPPDATA, "Programs", "Git"));
  }

  for (const root of candidateRoots) {
    const bashPath = path.win32.join(root, GIT_BASH_RELATIVE_PATH);
    if (fileExists(bashPath)) {
      return bashPath;
    }
  }
  return undefined;
}

// The shell that runs `-l -i -c "<command>"`. Undefined on Windows when Git Bash is not installed.
export function resolveLoginShell(platform: NodeJS.Platform, environment: Environment, fileExists: FileExists): string | undefined {
  if (platform === "win32") {
    return findGitBash(environment, fileExists);
  }
  return environment.SHELL ?? POSIX_FALLBACK_SHELL;
}

// On Windows `claude` is `claude.exe` (or `.cmd`), so PATH is searched with each PATHEXT extension.
export function executableNames(binaryName: string, platform: NodeJS.Platform, environment: Environment): string[] {
  if (platform !== "win32" || path.win32.extname(binaryName) !== "") {
    return [binaryName];
  }
  const extensions = (environment.PATHEXT ?? DEFAULT_WINDOWS_EXECUTABLE_EXTENSIONS).split(";").filter((extension) => extension !== "");
  return extensions.map((extension) => `${binaryName}${extension.toLowerCase()}`);
}

// Git Bash prints POSIX paths (/c/Users/...). Node needs the Windows form, so cygpath converts it.
export function loginShellLookupCommand(binaryName: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? `cygpath -w "$(command -v ${binaryName})"` : `command -v ${binaryName}`;
}
