const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export function formatAge(timestampMs: number, nowMs = Date.now()): string {
  const elapsedMs = Math.max(0, nowMs - timestampMs);
  if (elapsedMs < MS_PER_MINUTE) {
    return "just now";
  }
  if (elapsedMs < MS_PER_HOUR) {
    return `${Math.floor(elapsedMs / MS_PER_MINUTE)}m ago`;
  }
  if (elapsedMs < MS_PER_DAY) {
    return `${Math.floor(elapsedMs / MS_PER_HOUR)}h ago`;
  }
  return `${Math.floor(elapsedMs / MS_PER_DAY)}d ago`;
}
