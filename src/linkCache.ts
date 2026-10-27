import * as fs from "fs";
import * as path from "path";
import { LinkScanCacheEntry } from "./linkCandidates";

// Bump the scan version when the scanner changes, so saved scans rerun from the start.
const SCAN_CACHE_SCHEMA_VERSION = 4;
const CACHE_FILE_NAME = "session-links.json";

export type LinkCacheEntries = Record<string, LinkScanCacheEntry>;

interface VersionedCacheFile<Entries> {
  version: number;
  entries: Entries;
}

export function linkCacheFilePath(storageDir: string): string {
  return path.join(storageDir, CACHE_FILE_NAME);
}

export function loadLinkCache(cacheFile: string): Promise<LinkCacheEntries> {
  return loadVersionedCache<LinkCacheEntries>(cacheFile, SCAN_CACHE_SCHEMA_VERSION);
}

export function saveLinkCache(cacheFile: string, entries: LinkCacheEntries): Promise<void> {
  return saveVersionedCache(cacheFile, entries, SCAN_CACHE_SCHEMA_VERSION);
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
