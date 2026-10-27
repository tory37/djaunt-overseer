import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ANALYSIS_LOCK_STALE_MS, analysisLockFile, isStaleLock, parseLockHolder, tryAcquireAnalysisLock } from "../../src/analysisLock";

const NOW = 1_800_000_000_000;
const DEAD_PID = 2 ** 22 + 12345;
const isAlive = () => true;

describe("isStaleLock", () => {
  it("keeps a fresh lock held by a live process", () => {
    expect(isStaleLock({ pid: 1, lockedAt: NOW - 1000 }, NOW, isAlive)).toBe(false);
  });

  it("treats an old lock as stale", () => {
    expect(isStaleLock({ pid: 1, lockedAt: NOW - ANALYSIS_LOCK_STALE_MS - 1 }, NOW, isAlive)).toBe(true);
  });

  it("treats a lock held by a dead process as stale", () => {
    expect(isStaleLock({ pid: 1, lockedAt: NOW }, NOW, () => false)).toBe(true);
  });

  it("treats an unreadable lock as stale", () => {
    expect(isStaleLock(parseLockHolder("{not json"), NOW, isAlive)).toBe(true);
  });
});

describe("tryAcquireAnalysisLock", () => {
  let analysisDir: string;
  let lockFile: string;

  beforeEach(() => {
    analysisDir = fs.mkdtempSync(path.join(os.tmpdir(), "overseer-lock-"));
    lockFile = analysisLockFile(path.join(analysisDir, "session-1.json"));
  });

  afterEach(() => fs.rmSync(analysisDir, { recursive: true, force: true }));

  it("puts the lock beside the analysis file", () => {
    expect(lockFile).toBe(path.join(analysisDir, "session-1.lock"));
  });

  it("gives the lock to one caller and frees it on release", async () => {
    const release = await tryAcquireAnalysisLock(lockFile, NOW);
    expect(release).toBeDefined();
    expect(parseLockHolder(fs.readFileSync(lockFile, "utf8"))).toEqual({ pid: process.pid, lockedAt: NOW });
    expect(await tryAcquireAnalysisLock(lockFile, NOW)).toBeUndefined();
    await release?.();
    expect(fs.existsSync(lockFile)).toBe(false);
  });

  it("takes over a lock left by a dead process", async () => {
    fs.writeFileSync(lockFile, JSON.stringify({ pid: DEAD_PID, lockedAt: NOW }));
    const release = await tryAcquireAnalysisLock(lockFile, NOW);
    expect(release).toBeDefined();
    await release?.();
  });

  it("leaves a lock alone on release once another holder took it over", async () => {
    const release = await tryAcquireAnalysisLock(lockFile, NOW);
    const takenOverLock = JSON.stringify({ pid: process.pid, lockedAt: NOW + 1 });
    fs.writeFileSync(lockFile, takenOverLock);
    await release?.();
    expect(fs.readFileSync(lockFile, "utf8")).toBe(takenOverLock);
  });
});
