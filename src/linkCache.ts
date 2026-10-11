import * as fs from "fs";
import * as path from "path";
import { LinkScanCacheEntry } from "./linkCandidates";
import { JudgeCacheEntry } from "./linkJudge";

// Bump the scan version when the scanner changes, so saved scans rerun from the start.
const SCAN_CACHE_SCHEMA_VERSION = 3;
const JUDGE_CACHE_SCHEMA_VERSION = 1;
const CACHE_FILE_NAME = "session-links.json";
const JUDGE_CACHE_FILE_NAME = "session-link-verdicts.json";

export type LinkCacheEntries = Record<string, LinkScanCacheEntry>;
export type JudgeCacheEntries = Record<string, JudgeCacheEntry>;

interface VersionedCacheFile<Entries> {
  version: number;
  entries: Entries;
}

export function linkCacheFilePath(storageDir: string): string {
  return path.join(storageDir, CACHE_FILE_NAME);
}

export function judgeCacheFilePath(storageDir: string): string {
  return path.join(storageDir, JUDGE_CACHE_FILE_NAME);
}

export function loadLinkCache(cacheFile: string): Promise<LinkCacheEntries> {
  return loadVersionedCache<LinkCacheEntries>(cacheFile, SCAN_CACHE_SCHEMA_VERSION);
}

export function saveLinkCache(cacheFile: string, entries: LinkCacheEntries): Promise<void> {
  return saveVersionedCache(cacheFile, entries, SCAN_CACHE_SCHEMA_VERSION);
}

export function loadJudgeCache(cacheFile: string): Promise<JudgeCacheEntries> {
  return loadVersionedCache<JudgeCacheEntries>(cacheFile, JUDGE_CACHE_SCHEMA_VERSION);
}

export function saveJudgeCache(cacheFile: string, entries: JudgeCacheEntries): Promise<void> {
  return saveVersionedCache(cacheFile, entries, JUDGE_CACHE_SCHEMA_VERSION);
}

export async function loadVersionedCache<Entries>(cacheFile: string, schemaVersion: number): Promise<Entries> {
  try {
    const cacheFileContent = JSON.parse(await fs.promises.readFile(cacheFile, "utf8")) as VersionedCacheFile<Entries>;
    return cacheFileContent.version === schemaVersion ? cacheFileContent.entries : ({} as Entries);
  } catch {
    return {} as Entries;
  }
}

export async function saveVersionedCache<Entries>(
  cacheFile: string,
  entries: Entries,
  schemaVersion: number,
): Promise<void> {
  await fs.promises.mkdir(path.dirname(cacheFile), { recursive: true });
  const cacheFileContent: VersionedCacheFile<Entries> = { version: schemaVersion, entries };
  const temporaryFile = `${cacheFile}.${process.pid}.tmp`;
  await fs.promises.writeFile(temporaryFile, JSON.stringify(cacheFileContent));
  await fs.promises.rename(temporaryFile, cacheFile);
}
