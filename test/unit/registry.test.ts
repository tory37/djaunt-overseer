import { describe, expect, it } from "vitest";
import { KeyValueStore, Registry, userGroupRef } from "../../src/registry";
import { EMPTY_WORKSPACE_SNAPSHOT } from "../../src/workspaces";

function memoryStore(): KeyValueStore {
  const values = new Map<string, unknown>();
  return {
    get: <Value>(key: string) => values.get(key) as Value | undefined,
    update: async (key: string, value: unknown) => {
      values.set(key, value);
    },
  };
}

describe("Registry", () => {
  it("copies only ticket marks to a new session and keeps the target's own marks", async () => {
    const registry = new Registry(memoryStore());
    await registry.setLinkMark("old", ["ticket:PROJ-1", "pr:9"], "pinned");
    await registry.setLinkMark("old", ["ticket:PROJ-2"], "removed");
    await registry.setLinkMark("new", ["ticket:PROJ-2"], "pinned");

    await registry.copyTicketMarks("old", "new");

    expect(registry.linkMarks("new")).toEqual({ "ticket:PROJ-1": "pinned", "ticket:PROJ-2": "pinned" });
    expect(registry.linkMarks("old")).toEqual({ "ticket:PROJ-1": "pinned", "pr:9": "pinned", "ticket:PROJ-2": "removed" });
  });

  it("sets and clears session statuses for several sessions at once", async () => {
    const registry = new Registry(memoryStore());

    await registry.setSessionStatus(["a", "b"], "triage");
    await registry.setSessionStatus(["b"], "in-progress");
    expect(registry.sessionStatusIds()).toEqual({ a: "triage", b: "in-progress" });
    await registry.setSessionStatus(["a"], undefined);
    expect(registry.sessionStatusIds()).toEqual({ b: "in-progress" });
  });

  it("keeps a status reason until the status changes or clears", async () => {
    const registry = new Registry(memoryStore());

    await registry.setSessionStatus(["a", "b"], "blocked", "waiting on the API key");
    expect(registry.sessionStatusReasons()).toEqual({ a: "waiting on the API key", b: "waiting on the API key" });
    await registry.setSessionStatus(["a"], "blocked", "");
    expect(registry.sessionStatusReasons()).toEqual({ b: "waiting on the API key" });
    await registry.setSessionStatus(["b"], "in-progress");
    expect(registry.sessionStatusReasons()).toEqual({});
    await registry.setSessionStatus(["a"], "blocked", "no access");
    await registry.setSessionStatus(["a"], undefined);
    expect(registry.sessionStatusReasons()).toEqual({});
  });

  it("keeps link marks per session and drops cleared ones", async () => {
    const registry = new Registry(memoryStore());

    await registry.setLinkMark("a", ["pr:acme/web/pull/1", "ticket:PROJ-5"], "pinned");
    await registry.setLinkMark("b", ["ticket:PROJ-5"], "removed");
    await registry.setLinkMark("a", ["pr:acme/web/pull/1"], undefined);

    expect(registry.linkMarks("a")).toEqual({ "ticket:PROJ-5": "pinned" });
    expect(registry.linkMarks("b")).toEqual({ "ticket:PROJ-5": "removed" });
    await registry.setLinkMark("b", ["ticket:PROJ-5"], undefined);
    expect(registry.linkMarks("b")).toEqual({});
  });

  it("keeps link order per session", async () => {
    const registry = new Registry(memoryStore());

    await registry.setLinkOrder("a", ["ticket:PROJ-5", "pr:acme/web/pull/1"]);
    await registry.setLinkOrder("b", ["pr:acme/web/pull/1"]);

    expect(registry.linkOrder("a")).toEqual(["ticket:PROJ-5", "pr:acme/web/pull/1"]);
    expect(registry.linkOrder("b")).toEqual(["pr:acme/web/pull/1"]);
    expect(registry.linkOrder("c")).toEqual([]);
  });

  it("remembers expanded sessions and collapsed groups, and forgets an unpinned session", async () => {
    const registry = new Registry(memoryStore());
    let changeCount = 0;
    registry.onDidChange(() => changeCount++);

    await registry.setSessionExpanded("a", true);
    await registry.setSessionExpanded("b", true);
    await registry.setSessionExpanded("b", false);
    await registry.setGroupCollapsed("user:g1", true);

    expect(registry.isSessionExpanded("a")).toBe(true);
    expect(registry.isSessionExpanded("b")).toBe(false);
    expect(registry.isGroupCollapsed("user:g1")).toBe(true);
    expect(changeCount).toBe(0);
    await registry.pin("a");
    await registry.unpin("a");
    expect(registry.isSessionExpanded("a")).toBe(false);
  });

  it("stores a terminal session with its shell pid and forgets it on unpin", async () => {
    const registry = new Registry(memoryStore());
    await registry.addTerminalSession("t", { cwd: "/repo", createdAtMs: 1 });
    await registry.setTerminalShellPid("t", 4242);
    await registry.setTerminalShellPid("missing", 1);

    expect(registry.terminalSessions()).toEqual({ t: { cwd: "/repo", createdAtMs: 1, shellPid: 4242 } });
    await registry.pin("t");
    await registry.unpin("t");
    expect(registry.terminalSessions()).toEqual({});
  });

  it("forgets every field of a deleted session and keeps the others", async () => {
    const registry = new Registry(memoryStore());
    for (const sessionId of ["a", "b"]) {
      await registry.pin(sessionId);
      await registry.setLabel(sessionId, `label ${sessionId}`);
      await registry.assign([sessionId], userGroupRef("g1"));
      await registry.setLinkMark(sessionId, ["ticket:PROJ-5"], "pinned");
      await registry.setLinkOrder(sessionId, ["ticket:PROJ-5"]);
      await registry.setSessionStatus([sessionId], "blocked", "why");
    }

    await registry.forgetSessions(["a"]);

    expect(registry.pinnedSessionIds()).toEqual(["b"]);
    expect(registry.labels()).toEqual({ b: "label b" });
    expect(registry.assignments()).toEqual({ b: userGroupRef("g1") });
    expect(registry.linkMarks("a")).toEqual({});
    expect(registry.linkOrder("a")).toEqual([]);
    expect(registry.sessionStatusIds()).toEqual({ b: "blocked" });
    expect(registry.sessionStatusReasons()).toEqual({ b: "why" });
  });

  it("pins once and unpins", async () => {
    const registry = new Registry(memoryStore());

    await registry.pin("a");
    await registry.pin("a");
    await registry.pin("b");
    await registry.unpin("a");

    expect(registry.pinnedSessionIds()).toEqual(["b"]);
  });

  it("drops assignments to a deleted group", async () => {
    const registry = new Registry(memoryStore());
    await registry.createGroup("Review queue", "g1");
    await registry.createGroup("Other", "g2");
    await registry.assign(["a"], userGroupRef("g1"));
    await registry.assign(["b"], userGroupRef("g2"));

    await registry.deleteGroup("g1");

    expect(registry.userGroups().map((group) => group.id)).toEqual(["g2"]);
    expect(registry.assignments()).toEqual({ b: userGroupRef("g2") });
  });

  it("renames a group in place", async () => {
    const registry = new Registry(memoryStore());
    await registry.createGroup("old", "g1");

    await registry.renameGroup("g1", "new");

    expect(registry.userGroups()).toEqual([{ id: "g1", name: "new" }]);
  });

  it("keeps a renamed auto group in its saved position", async () => {
    const registry = new Registry(memoryStore());
    await registry.setGroupOrder(["auto:CR-9", "ungrouped"]);

    await registry.replaceGroupRef("auto:CR-9", userGroupRef("g1"));

    expect(registry.groupOrder()).toEqual([userGroupRef("g1"), "ungrouped"]);
  });

  it("drops an unpinned session from the saved order", async () => {
    const registry = new Registry(memoryStore());
    await registry.setSessionOrder(["a", "b"]);

    await registry.unpin("a");

    expect(registry.sessionOrder()).toEqual(["b"]);
  });

  it("notifies listeners on every write", async () => {
    const registry = new Registry(memoryStore());
    let changeCount = 0;
    registry.onDidChange(() => changeCount++);

    await registry.pin("a");
    await registry.createGroup("x", "g1");

    expect(changeCount).toBe(2);
  });
  it("remembers which sessions ran Find Resources, and forgets one when it is unpinned", async () => {
    const registry = new Registry(memoryStore());
    await registry.pin("a");
    await registry.pin("b");
    await registry.markResourcesFound("a");
    await registry.markResourcesFound("a");
    await registry.markResourcesFound("b");

    expect(registry.resourceSessionIds()).toEqual(["a", "b"]);
    await registry.unpin("a");
    expect(registry.hasFoundResources("a")).toBe(false);
    expect(registry.hasFoundResources("b")).toBe(true);
  });

  describe("workspaces", () => {
    it("keeps a snapshot per workspace and drops it with the workspace", async () => {
      const registry = new Registry(memoryStore());
      await registry.createWorkspace("Work", "w1");
      const snapshot = { liveSessionIds: ["a"], openTerminalIds: ["t"], tabUris: ["file:///x.ts"], activeTabUri: undefined };
      await registry.setWorkspaceSnapshot("w1", snapshot);

      expect(registry.workspaceSnapshot("w1")).toEqual(snapshot);
      expect(registry.workspaceSnapshot("default")).toEqual(EMPTY_WORKSPACE_SNAPSHOT);
      await registry.deleteWorkspace("w1");
      expect(registry.workspaceSnapshot("w1")).toEqual(EMPTY_WORKSPACE_SNAPSHOT);
    });

    it("reads a snapshot saved before tabs were tracked as having no tabs", async () => {
      const store = memoryStore();
      await store.update("overseer.workspaceSnapshots", { w1: { liveSessionIds: ["a"], openTerminalIds: [] } });

      expect(new Registry(store).workspaceSnapshot("w1")).toEqual({ ...EMPTY_WORKSPACE_SNAPSHOT, liveSessionIds: ["a"] });
    });

    it("puts existing pins and groups in Default", async () => {
      const registry = new Registry(memoryStore());
      await registry.pin("a");
      await registry.createGroup("Review", "g1");

      expect(registry.workspaces()).toEqual([{ id: "default", name: "Default" }]);
      expect(registry.activeWorkspaceId()).toBe("default");
      expect(registry.pinnedSessionIdsInActiveWorkspace()).toEqual(["a"]);
      expect(registry.userGroupsInActiveWorkspace().map((group) => group.id)).toEqual(["g1"]);
    });

    it("shows only the active workspace's sessions and groups", async () => {
      const registry = new Registry(memoryStore());
      await registry.pin("home");
      await registry.createWorkspace("Work", "w1");
      await registry.setActiveWorkspace("w1");
      await registry.pin("job");
      await registry.createGroup("Sprint", "g1");

      expect(registry.pinnedSessionIdsInActiveWorkspace()).toEqual(["job"]);
      expect(registry.userGroupsInActiveWorkspace().map((group) => group.id)).toEqual(["g1"]);
      await registry.setActiveWorkspace("default");
      expect(registry.pinnedSessionIdsInActiveWorkspace()).toEqual(["home"]);
      expect(registry.userGroupsInActiveWorkspace()).toEqual([]);
    });

    it("moves an already pinned session into the workspace that pins it again", async () => {
      const registry = new Registry(memoryStore());
      await registry.pin("a");
      await registry.createWorkspace("Work", "w1");
      await registry.setActiveWorkspace("w1");

      await registry.pin("a");

      expect(registry.pinnedSessionIdsInActiveWorkspace()).toEqual(["a"]);
      expect(registry.pinnedSessionIds()).toEqual(["a"]);
    });

    it("moves a group along with its sessions", async () => {
      const registry = new Registry(memoryStore());
      await registry.pin("a");
      await registry.pin("b");
      await registry.createGroup("Sprint", "g1");
      await registry.assign(["a"], userGroupRef("g1"));
      await registry.createWorkspace("Work", "w1");

      await registry.moveGroupToWorkspace("g1", "w1");
      await registry.setActiveWorkspace("w1");

      expect(registry.pinnedSessionIdsInActiveWorkspace()).toEqual(["a"]);
      expect(registry.userGroupsInActiveWorkspace().map((group) => group.id)).toEqual(["g1"]);
    });

    it("sends a deleted workspace's members to Default and leaves it active", async () => {
      const registry = new Registry(memoryStore());
      await registry.createWorkspace("Work", "w1");
      await registry.setActiveWorkspace("w1");
      await registry.pin("a");
      await registry.createGroup("Sprint", "g1");

      await registry.deleteWorkspace("w1");

      expect(registry.activeWorkspaceId()).toBe("default");
      expect(registry.workspaces().map((workspace) => workspace.id)).toEqual(["default"]);
      expect(registry.pinnedSessionIdsInActiveWorkspace()).toEqual(["a"]);
      expect(registry.userGroupsInActiveWorkspace().map((group) => group.id)).toEqual(["g1"]);
    });

    it("never deletes Default, and keeps it first after a rename", async () => {
      const registry = new Registry(memoryStore());
      await registry.createWorkspace("Work", "w1");
      await registry.renameWorkspace("default", "Home");
      await registry.deleteWorkspace("default");

      expect(registry.workspaces()).toEqual([
        { id: "default", name: "Home" },
        { id: "w1", name: "Work" },
      ]);
    });

    it("forgets the workspace of an unpinned session", async () => {
      const registry = new Registry(memoryStore());
      await registry.createWorkspace("Work", "w1");
      await registry.setActiveWorkspace("w1");
      await registry.pin("a");
      await registry.unpin("a");
      await registry.setActiveWorkspace("default");

      await registry.pin("a");

      expect(registry.pinnedSessionIdsInActiveWorkspace()).toEqual(["a"]);
    });
  });

  it("moves a row to the session that replaced it, keeping its place and settings", async () => {
    const registry = new Registry(memoryStore());
    await registry.createWorkspace("Work", "work");
    await registry.setActiveWorkspace("work");
    await registry.pin("before");
    await registry.pin("old");
    await registry.pin("after");
    await registry.setSessionOrder(["before", "old", "after"]);
    await registry.setLabel("old", "My task");
    await registry.assign(["old"], userGroupRef("g1"));
    await registry.setSessionStatus(["old"], "blocked", "waiting on review");
    await registry.setSessionExpanded("old", true);
    await registry.setLinkMark("old", ["pr:1"], "pinned");
    await registry.setWorkspaceSnapshot("default", { ...EMPTY_WORKSPACE_SNAPSHOT, liveSessionIds: ["old"] });

    await registry.moveSession("old", "new");

    expect(registry.pinnedSessionIds()).toEqual(["before", "new", "after"]);
    expect(registry.sessionOrder()).toEqual(["before", "new", "after"]);
    expect(registry.labels()).toEqual({ new: "My task" });
    expect(registry.assignments()).toEqual({ new: userGroupRef("g1") });
    expect(registry.sessionStatusIds()).toEqual({ new: "blocked" });
    expect(registry.sessionStatusReasons()).toEqual({ new: "waiting on review" });
    expect(registry.pinnedSessionIdsInWorkspace("work")).toEqual(["before", "new", "after"]);
    expect(registry.isSessionExpanded("new")).toBe(true);
    expect(registry.isSessionExpanded("old")).toBe(false);
    expect(registry.linkMarks("old")).toEqual({ "pr:1": "pinned" });
    expect(registry.workspaceSnapshot("default").liveSessionIds).toEqual(["new"]);
  });

  it("keeps a Default row in Default when it moves", async () => {
    const registry = new Registry(memoryStore());
    await registry.pin("old");
    await registry.createWorkspace("Work", "work");
    await registry.setActiveWorkspace("work");

    await registry.moveSession("old", "new");

    expect(registry.pinnedSessionIdsInWorkspace("default")).toEqual(["new"]);
  });

  it("drops the old row when the new session already has one", async () => {
    const registry = new Registry(memoryStore());
    await registry.pin("old");
    await registry.pin("new");
    await registry.setLabel("old", "Old name");
    await registry.setLabel("new", "New name");

    await registry.moveSession("old", "new");

    expect(registry.pinnedSessionIds()).toEqual(["new"]);
    expect(registry.labels()["new"]).toBe("New name");
  });

  it("ignores a session that has no row", async () => {
    const registry = new Registry(memoryStore());
    await registry.pin("other");

    await registry.moveSession("old", "new");

    expect(registry.pinnedSessionIds()).toEqual(["other"]);
  });
});

