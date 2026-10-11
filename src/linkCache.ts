import * as fs from "fs";
import * as path from "path";
import { LinkScanCacheEntry } from "./linkCandidates";

const CACHE_SCHEMA_VERSION = 1;
const CACHE_FILE_NAME = "session-links.json";

export type LinkCacheEntries = Record<string, LinkScanCacheEntry>;

interface LinkCacheFile {
  version: number;
  entries: LinkCacheEntries;
}

export function linkCacheFilePath(storageDir: string): string {
  return path.join(storageDir, CACHE_FILE_NAME);
}

export async function loadLinkCache(cacheFile: string): Promise<LinkCacheEntries> {
  try {
    const cacheFileContent = JSON.parse(await fs.promises.readFile(cacheFile, "utf8")) as LinkCacheFile;
    return cacheFileContent.version === CACHE_SCHEMA_VERSION ? cacheFileContent.entries : {};
  } catch {
    return {};
  }
}

export async function saveLinkCache(cacheFile: string, entries: LinkCacheEntries): Promise<void> {
  await fs.promises.mkdir(path.dirname(cacheFile), { recursive: true });
  const cacheFileContent: LinkCacheFile = { version: CACHE_SCHEMA_VERSION, entries };
  const temporaryFile = `${cacheFile}.${process.pid}.tmp`;
  await fs.promises.writeFile(temporaryFile, JSON.stringify(cacheFileContent));
  await fs.promises.rename(temporaryFile, cacheFile);
}
