import { describe, expect, it } from "vitest";
import { KeyValueStore, Registry, userGroupRef } from "../../src/registry";

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
});
