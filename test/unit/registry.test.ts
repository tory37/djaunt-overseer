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
