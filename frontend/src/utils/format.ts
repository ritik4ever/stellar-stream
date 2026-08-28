/**
 * format.ts
 *
 * Shared display helpers for public/embed views: truncated addresses,
 * amount formatting, and human-readable durations.
 */

/** Shortens a Stellar address for display: first 8 + … + last 4 chars. */
export function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 8)}…${address.slice(-4)}`;
}

/** Formats an amount with thousands separators (up to 2 decimals). */
export function formatAmount(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * Formats a duration in seconds as a compact human-readable string,
 * e.g. `45s`, `12m 30s`, `3h 5m`, `2d 4h`.
 */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}
