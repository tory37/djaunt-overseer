import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { KeyValueStore } from "../../src/registry";
import { StoredStatusCache } from "../../src/statusCache";
import { StatusConfig } from "../../src/statusConfig";
import { StatusIconWriter } from "../../src/statusIcons";

function memoryStore(): KeyValueStore {
  const values = new Map<string, unknown>();
  return {
    get: <Value>(key: string) => values.get(key) as Value | undefined,
    update: async (key: string, value: unknown) => {
      values.set(key, value);
    },
  };
}

describe("StatusConfig", () => {
  it("adds a project once, enabled, and only ever adds statuses", async () => {
    const statusConfig = new StatusConfig(memoryStore());

    expect(await statusConfig.noteProject("CR", "CR-1")).toBe(true);
    expect(await statusConfig.noteProject("CR", "CR-2")).toBe(false);
    await statusConfig.addStatuses("CR", ["Open", "Closed"]);
    await statusConfig.addStatuses("CR", ["Closed", "Released"]);
    await statusConfig.addStatuses("NOPE", ["Open"]);

    expect(statusConfig.projects()).toEqual([
      { key: "CR", isEnabled: true, statuses: ["Open", "Closed", "Released"], sampleTicketKey: "CR-1" },
    ]);
  });

  it("treats an unknown project as enabled and remembers a disabled one", async () => {
    const statusConfig = new StatusConfig(memoryStore());
    expect(statusConfig.isProjectEnabled("ASSMNT")).toBe(true);

    await statusConfig.noteProject("ASSMNT", "ASSMNT-1");
    await statusConfig.setProjectEnabled("ASSMNT", false);

    expect(statusConfig.isProjectEnabled("ASSMNT")).toBe(false);
  });

  it("keeps colors per project and status, and resets each section", async () => {
    const statusConfig = new StatusConfig(memoryStore());
    const defaultDone = statusConfig.jiraColor("CR", "Done");
    let changeCount = 0;
    statusConfig.onDidChange(() => changeCount++);

    await statusConfig.setJiraColor("ASSMNT", "Done", "#112233");
    await statusConfig.setPrColor("merged", "#445566");

    expect(statusConfig.jiraColor("ASSMNT", "Done")).toBe("#112233");
    expect(statusConfig.jiraColor("CR", "Done")).toBe(defaultDone);
    expect(statusConfig.prColor("merged")).toBe("#445566");
    expect(changeCount).toBe(2);

    await statusConfig.resetJiraColors();
    await statusConfig.resetPrColors();
    expect(statusConfig.jiraColor("ASSMNT", "Done")).toBe(defaultDone);
    expect(statusConfig.prColor("merged")).not.toBe("#445566");
  });
});

describe("StatusIconWriter", () => {
  it("writes one SVG per glyph and color, and refuses a non-hex color", () => {
    const iconDir = fs.mkdtempSync(path.join(os.tmpdir(), "overseer-icons-"));
    try {
      const iconWriter = new StatusIconWriter(iconDir);
      const iconFile = iconWriter.iconFile("ticket", "#A371F7");

      expect(iconFile).toBe(path.join(iconDir, "ticket-a371f7.svg"));
      expect(fs.readFileSync(iconFile!, "utf8")).toContain('stroke="#A371F7"');
      expect(iconWriter.iconFile("ticket", 'red" onload="x')).toBeUndefined();
    } finally {
      fs.rmSync(iconDir, { recursive: true, force: true });
    }
  });
});

describe("StoredStatusCache", () => {
  const dayMs = 24 * 60 * 60_000;

  it("round-trips statuses and skips failed lookups", async () => {
    const store = memoryStore();
    const statusCache = new StoredStatusCache(store);
    await statusCache.save(
      new Map([
        ["ticket:CR-1", { status: { text: "Closed", colorKey: "Closed" }, fetchedAtMs: 1_000 }],
        ["ticket:CR-2", { status: undefined, fetchedAtMs: 1_000 }],
      ]),
      1_000,
    );

    expect([...new StoredStatusCache(store).load(2_000)]).toEqual([
      ["ticket:CR-1", { status: { text: "Closed", colorKey: "Closed" }, fetchedAtMs: 1_000 }],
    ]);
  });

  it("keeps a newer entry from another window and drops entries past 30 days", async () => {
    const store = memoryStore();
    await store.update("overseer.linkStatusCache", {
      "ticket:CR-1": { text: "Done", colorKey: "Done", fetchedAtMs: 5_000 },
      "ticket:OLD-1": { text: "Open", colorKey: "Open", fetchedAtMs: 0 },
      "ticket:BAD-1": { text: 3 },
    });
    const statusCache = new StoredStatusCache(store);
    const nowMs = 31 * dayMs;
    await statusCache.save(
      new Map([["ticket:CR-1", { status: { text: "Open", colorKey: "Open" }, fetchedAtMs: 4_000 }]]),
      5_000,
    );

    expect(statusCache.load(5_000).get("ticket:CR-1")?.status?.text).toBe("Done");
    expect([...statusCache.load(nowMs).keys()]).toEqual([]);
  });
});
