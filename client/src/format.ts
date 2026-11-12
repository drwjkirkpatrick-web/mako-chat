// Pure display helpers — no SDK, no React, fully testable.

/**
 * Human-friendly byte size: 512 B, 2.0 KB, 5.0 MB, 3.0 GB.
 * WHY one decimal below 10 and none above: "9.9 MB" reads; "47.0 MB" doesn't.
 */
export function humanSize(bytes?: number): string {
  if (bytes === undefined || bytes === null || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}
