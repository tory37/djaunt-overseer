import * as fs from "fs";
import * as path from "path";

// Longer than the worst pass, a diff call plus its retry at two minutes each, so a slow pass keeps its lock.
export const ANALYSIS_LOCK_STALE_MS = 5 * 60_000;

export interface AnalysisLockHolder {
  pid: number;
  lockedAt: number;
}

export type ReleaseAnalysisLock = () => Promise<void>;

export function analysisLockFile(analysisFile: string): string {
  return path.join(path.dirname(analysisFile), `${path.basename(analysisFile, ".json")}.lock`);
}

export function parseLockHolder(lockText: string): AnalysisLockHolder | undefined {
  try {
    const fields = JSON.parse(lockText) as Partial<AnalysisLockHolder> | null;
    if (typeof fields?.pid === "number" && typeof fields.lockedAt === "number") {
      return { pid: fields.pid, lockedAt: fields.lockedAt };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

// An unreadable lock counts as stale, or a crash mid-write would block the session for good.
export function isStaleLock(holder: AnalysisLockHolder | undefined, now: number, isProcessAlive: (pid: number) => boolean): boolean {
  return holder === undefined || now - holder.lockedAt > ANALYSIS_LOCK_STALE_MS || !isProcessAlive(holder.pid);
}

// Undefined means another window holds a fresh lock. The exclusive create makes two windows racing for it get one winner.
export async function tryAcquireAnalysisLock(lockFile: string, now: number = Date.now()): Promise<ReleaseAnalysisLock | undefined> {
  await fs.promises.mkdir(path.dirname(lockFile), { recursive: true });
  const holder: AnalysisLockHolder = { pid: process.pid, lockedAt: now };
  if (await createExclusive(lockFile, JSON.stringify(holder))) {
    return releaseFor(lockFile, holder);
  }
  const lockText = await fs.promises.readFile(lockFile, "utf8").catch(() => "");
  if (!isStaleLock(parseLockHolder(lockText), now, isProcessAlive)) {
    return undefined;
  }
  await fs.promises.unlink(lockFile).catch(() => undefined);
  return (await createExclusive(lockFile, JSON.stringify(holder))) ? releaseFor(lockFile, holder) : undefined;
}

async function createExclusive(file: string, contents: string): Promise<boolean> {
  try {
    await fs.promises.writeFile(file, contents, { flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }
    throw error;
  }
}

// Removes the lock only while it is still ours, so a window that took over a stale lock keeps it.
function releaseFor(lockFile: string, holder: AnalysisLockHolder): ReleaseAnalysisLock {
  return async () => {
    const currentHolder = parseLockHolder(await fs.promises.readFile(lockFile, "utf8").catch(() => ""));
    if (currentHolder?.pid === holder.pid && currentHolder.lockedAt === holder.lockedAt) {
      await fs.promises.unlink(lockFile).catch(() => undefined);
    }
  };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
