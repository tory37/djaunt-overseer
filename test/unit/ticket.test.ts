import { describe, expect, it } from "vitest";
import { extractTicketKey } from "../../src/ticket";

describe("extractTicketKey", () => {
  it.each([
    [{ title: "PROJ-2567 login timeout" }, "PROJ-2567"],
    [{ title: "OPS 2829 Ready to Ship" }, "OPS-2829"],
    [{ title: "Fix worktree issue on OPS-4410" }, "OPS-4410"],
    [{ title: "no key here", gitBranch: "fix/proj-2567-login-timeout" }, "PROJ-2567"],
    [{ gitBranch: "PROJ-2179-looping" }, "PROJ-2179"],
    [{ title: "plain", gitBranch: "main", firstPrompt: "/djt-bug PROJ-2668 login loop" }, "PROJ-2668"],
  ])("finds the key in %o", (sources, expectedKey) => {
    expect(extractTicketKey(sources)).toBe(expectedKey);
  });

  it("prefers the title over the branch", () => {
    expect(extractTicketKey({ title: "OPS-1 thing", gitBranch: "fix/proj-2-other" })).toBe("OPS-1");
  });

  it.each([
    [{ title: "Convert to UTF-8 and ISO 8601 dates" }],
    [{ title: "Review PR 6016 comments" }],
    [{ title: "Memguard memory warning", gitBranch: "main" }],
    [{ gitBranch: "feature/login" }],
    [{ gitBranch: "main-2" }],
  ])("ignores lookalikes in %o", (sources) => {
    expect(extractTicketKey(sources)).toBeUndefined();
  });
});
