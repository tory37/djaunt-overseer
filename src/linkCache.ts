import * as fs from "fs";
import * as path from "path";
import { LinkScanCacheEntry } from "./linkCandidates";
import { JudgeCacheEntry } from "./linkJudge";

const CACHE_SCHEMA_VERSION = 1;
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
  return loadVersionedCache<LinkCacheEntries>(cacheFile);
}

export function saveLinkCache(cacheFile: string, entries: LinkCacheEntries): Promise<void> {
  return saveVersionedCache(cacheFile, entries);
}

export function loadJudgeCache(cacheFile: string): Promise<JudgeCacheEntries> {
  return loadVersionedCache<JudgeCacheEntries>(cacheFile);
}

export function saveJudgeCache(cacheFile: string, entries: JudgeCacheEntries): Promise<void> {
  return saveVersionedCache(cacheFile, entries);
}

async function loadVersionedCache<Entries>(cacheFile: string): Promise<Entries> {
  try {
    const cacheFileContent = JSON.parse(await fs.promises.readFile(cacheFile, "utf8")) as VersionedCacheFile<Entries>;
    return cacheFileContent.version === CACHE_SCHEMA_VERSION ? cacheFileContent.entries : ({} as Entries);
  } catch {
    return {} as Entries;
  }
}

async function saveVersionedCache<Entries>(cacheFile: string, entries: Entries): Promise<void> {
  await fs.promises.mkdir(path.dirname(cacheFile), { recursive: true });
  const cacheFileContent: VersionedCacheFile<Entries> = { version: CACHE_SCHEMA_VERSION, entries };
  const temporaryFile = `${cacheFile}.${process.pid}.tmp`;
  await fs.promises.writeFile(temporaryFile, JSON.stringify(cacheFileContent));
  await fs.promises.rename(temporaryFile, cacheFile);
}
