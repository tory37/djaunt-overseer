import { LinkStatus } from "./linkStatus";
import { KeyValueStore } from "./registry";

const STATUS_CACHE_KEY = "overseer.linkStatusCache";
const MAX_STORED_STATUS_AGE_MS = 30 * 24 * 60 * 60_000;

export interface StatusCacheEntry {
  status: LinkStatus | undefined;
  fetchedAtMs: number;
}

interface StoredStatus {
  text: string;
  colorKey: string;
  fetchedAtMs: number;
}

// Keeps the last known statuses across reloads, so rows show their color before the first fetch ends.
export class StoredStatusCache {
  constructor(private readonly store: KeyValueStore) {}

  load(nowMs: number): Map<string, StatusCacheEntry> {
    const loadedEntries = new Map<string, StatusCacheEntry>();
    for (const [cacheKey, storedStatus] of Object.entries(this.storedStatuses(nowMs))) {
      loadedEntries.set(cacheKey, {
        status: { text: storedStatus.text, colorKey: storedStatus.colorKey },
        fetchedAtMs: storedStatus.fetchedAtMs,
      });
    }
    return loadedEntries;
  }

  // Other windows write the same key, so their newer entries are kept.
  async save(entries: Map<string, StatusCacheEntry>, nowMs: number): Promise<void> {
    const mergedStatuses = this.storedStatuses(nowMs);
    for (const [cacheKey, entry] of entries) {
      const storedStatus = mergedStatuses[cacheKey];
      const isNewerThanStored = storedStatus === undefined || entry.fetchedAtMs >= storedStatus.fetchedAtMs;
      if (entry.status !== undefined && isNewerThanStored) {
        mergedStatuses[cacheKey] = { ...entry.status, fetchedAtMs: entry.fetchedAtMs };
      }
    }
    await this.store.update(STATUS_CACHE_KEY, mergedStatuses);
  }

  private storedStatuses(nowMs: number): Record<string, StoredStatus> {
    const rawStatuses = this.store.get<Record<string, unknown>>(STATUS_CACHE_KEY) ?? {};
    const validStatuses: Record<string, StoredStatus> = {};
    for (const [cacheKey, rawStatus] of Object.entries(rawStatuses)) {
      if (isStoredStatus(rawStatus) && nowMs - rawStatus.fetchedAtMs <= MAX_STORED_STATUS_AGE_MS) {
        validStatuses[cacheKey] = rawStatus;
      }
    }
    return validStatuses;
  }
}

function isStoredStatus(value: unknown): value is StoredStatus {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<StoredStatus>;
  return (
    typeof candidate.text === "string" &&
    typeof candidate.colorKey === "string" &&
    typeof candidate.fetchedAtMs === "number"
  );
}
