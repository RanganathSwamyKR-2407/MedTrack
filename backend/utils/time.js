/**
 * Parses SQLite UTC timestamps ('YYYY-MM-DD HH:MM:SS') or ISO-8601 strings consistently into epoch ms.
 */
export function parseUtcMs(timestamp) {
  if (!timestamp) return NaN;
  if (timestamp instanceof Date) return timestamp.getTime();
  const str = String(timestamp).trim();
  if (!str) return NaN;
  // Convert 'YYYY-MM-DD HH:MM:SS' -> 'YYYY-MM-DDTHH:MM:SSZ'
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(str)) {
    return Date.parse(str.replace(" ", "T") + "Z");
  }
  // If ISO without timezone offset/Z, treat as UTC
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(str)) {
    return Date.parse(`${str}Z`);
  }
  return Date.parse(str);
}

export function ageSecondsFromNow(timestamp) {
  const ms = parseUtcMs(timestamp);
  if (!Number.isFinite(ms)) return Infinity;
  return (Date.now() - ms) / 1000;
}
