import * as fs from "fs";
import * as path from "path";
import { IndexCacheEntries } from "./indexer";

const CACHE_SCHEMA_VERSION = 4;
const CACHE_FILE_NAME = "session-index.json";

interface IndexCacheFile {
  version: number;
  entries: IndexCacheEntries;
}

export function cacheFilePath(storageDir: string): string {
  return path.join(storageDir, CACHE_FILE_NAME);
}

export async function loadIndexCache(cacheFile: string): Promise<IndexCacheEntries> {
  try {
    const cacheFileContent = JSON.parse(await fs.promises.readFile(cacheFile, "utf8")) as IndexCacheFile;
    return cacheFileContent.version === CACHE_SCHEMA_VERSION ? cacheFileContent.entries : {};
  } catch {
    return {};
  }
}

export async function saveIndexCache(cacheFile: string, entries: IndexCacheEntries): Promise<void> {
  await fs.promises.mkdir(path.dirname(cacheFile), { recursive: true });
  const cacheFileContent: IndexCacheFile = { version: CACHE_SCHEMA_VERSION, entries };
  const temporaryFile = `${cacheFile}.${process.pid}.tmp`;
  await fs.promises.writeFile(temporaryFile, JSON.stringify(cacheFileContent));
  await fs.promises.rename(temporaryFile, cacheFile);
}
