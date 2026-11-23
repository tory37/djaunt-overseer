import { describe, expect, it } from "vitest";
import { executableNames, findGitBash, loginShellLookupCommand, resolveLoginShell } from "../../src/loginShell";

function filesThatExist(...filePaths: string[]): (filePath: string) => boolean {
  const existing = new Set(filePaths);
  return (filePath) => existing.has(filePath);
}

describe("findGitBash", () => {
  it("finds bash from git.exe in <root>\\cmd", () => {
    const fileExists = filesThatExist("A:\\Program Files\\Git\\cmd\\git.exe", "A:\\Program Files\\Git\\bin\\bash.exe");
    const environment = { PATH: "C:\\Windows\\System32;A:\\Program Files\\Git\\cmd" };
    expect(findGitBash(environment, fileExists)).toBe("A:\\Program Files\\Git\\bin\\bash.exe");
  });

  it("finds bash from git.exe in <root>\\mingw64\\bin", () => {
    const fileExists = filesThatExist("D:\\Git\\mingw64\\bin\\git.exe", "D:\\Git\\bin\\bash.exe");
    expect(findGitBash({ PATH: "D:\\Git\\mingw64\\bin" }, fileExists)).toBe("D:\\Git\\bin\\bash.exe");
  });

  it("never picks the WSL launcher in System32", () => {
    const fileExists = filesThatExist("C:\\Windows\\System32\\bash.exe");
    expect(findGitBash({ PATH: "C:\\Windows\\System32" }, fileExists)).toBeUndefined();
  });

  it("falls back to the default Git install folders", () => {
    const fileExists = filesThatExist("C:\\Program Files\\Git\\bin\\bash.exe");
    expect(findGitBash({ PATH: "", ProgramFiles: "C:\\Program Files" }, fileExists)).toBe("C:\\Program Files\\Git\\bin\\bash.exe");
  });

  it("finds a per-user install", () => {
    const fileExists = filesThatExist("C:\\Users\\me\\AppData\\Local\\Programs\\Git\\bin\\bash.exe");
    expect(findGitBash({ LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" }, fileExists)).toBe(
      "C:\\Users\\me\\AppData\\Local\\Programs\\Git\\bin\\bash.exe",
    );
  });

  it("returns undefined when Git is not installed", () => {
    expect(findGitBash({ PATH: "C:\\Windows" }, filesThatExist())).toBeUndefined();
  });
});

describe("resolveLoginShell", () => {
  it("uses SHELL on macOS and Linux", () => {
    expect(resolveLoginShell("darwin", { SHELL: "/bin/bash" }, filesThatExist())).toBe("/bin/bash");
  });

  it("falls back to zsh on macOS and Linux", () => {
    expect(resolveLoginShell("linux", {}, filesThatExist())).toBe("/bin/zsh");
  });

  it("ignores SHELL on Windows and uses Git Bash", () => {
    const fileExists = filesThatExist("A:\\Program Files\\Git\\cmd\\git.exe", "A:\\Program Files\\Git\\bin\\bash.exe");
    const environment = { SHELL: "/bin/zsh", PATH: "A:\\Program Files\\Git\\cmd" };
    expect(resolveLoginShell("win32", environment, fileExists)).toBe("A:\\Program Files\\Git\\bin\\bash.exe");
  });

  it("is undefined on Windows without Git Bash", () => {
    expect(resolveLoginShell("win32", { PATH: "C:\\Windows" }, filesThatExist())).toBeUndefined();
  });
});

describe("executableNames", () => {
  it("is the bare name on macOS and Linux", () => {
    expect(executableNames("claude", "darwin", { PATHEXT: ".EXE" })).toEqual(["claude"]);
  });

  it("tries each PATHEXT extension on Windows", () => {
    expect(executableNames("claude", "win32", { PATHEXT: ".COM;.EXE;.CMD" })).toEqual(["claude.com", "claude.exe", "claude.cmd"]);
  });

  it("uses the default extensions when PATHEXT is unset", () => {
    expect(executableNames("gh", "win32", {})).toEqual(["gh.com", "gh.exe", "gh.bat", "gh.cmd"]);
  });

  it("keeps a name that already has an extension", () => {
    expect(executableNames("claude.exe", "win32", {})).toEqual(["claude.exe"]);
  });
});

describe("loginShellLookupCommand", () => {
  it("converts the path to Windows form on Windows", () => {
    expect(loginShellLookupCommand("claude", "win32")).toBe('cygpath -w "$(command -v claude)"');
  });

  it("is plain command -v elsewhere", () => {
    expect(loginShellLookupCommand("claude", "darwin")).toBe("command -v claude");
  });
});
