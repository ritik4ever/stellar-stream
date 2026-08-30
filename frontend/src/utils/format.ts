/**
 * format.ts
 *
 * Locale-aware formatting helpers for token amounts, durations, and
 * Stellar addresses. Used anywhere the UI needs to present raw numbers
 * or addresses in a human-readable way.
 */

// ── Token amounts ────────────────────────────────────────────────────────

/** Decimal precision for supported assets. XLM uses 7 stroops decimals, USDC uses 6. */
export const ASSET_DECIMALS: Record<string, number> = {
  XLM: 7,
  USDC: 6,
};

/**
 * Formats a token amount for display, applying the asset's known decimal
 * precision (falling back to the explicit `decimals` argument, then 7).
 *
 * @param amount - Amount as a number or numeric string (whole units, not stroops).
 * @param assetOrDecimals - Asset code (e.g. "XLM", "USDC") or a raw decimals count.
 * @param locale - Optional BCP 47 locale tag; defaults to the runtime locale.
 */
export function formatTokenAmount(
  amount: number | string,
  assetOrDecimals: string | number = 7,
  locale?: string
): string {
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(value)) return "—";

  const decimals =
    typeof assetOrDecimals === "number"
      ? assetOrDecimals
      : ASSET_DECIMALS[assetOrDecimals.toUpperCase()] ?? 7;

  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(value);
}

// ── Durations ─────────────────────────────────────────────────────────────

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE;
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;

/**
 * Formats a duration in seconds as a short human-readable string, e.g.
 * "2h 30m", "3 days", "45s". Picks the two most significant units.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds === 0) return "0s";

  const days = Math.floor(seconds / SECONDS_PER_DAY);
  const hours = Math.floor((seconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
  const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const secs = Math.floor(seconds % SECONDS_PER_MINUTE);

  if (days > 0) {
    return hours > 0 ? `${days} day${days === 1 ? "" : "s"} ${hours}h` : `${days} day${days === 1 ? "" : "s"}`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
  }
  return `${secs}s`;
}

// ── Addresses ─────────────────────────────────────────────────────────────

/**
 * Truncates a Stellar address (or any long identifier) to
 * `GABC...XYZ` form for compact display. Returns the input unchanged
 * if it's already short enough.
 */
export function formatAddress(address: string, prefixLen = 4, suffixLen = 4): string {
  if (!address) return "";
  if (address.length <= prefixLen + suffixLen + 3) return address;
  return `${address.slice(0, prefixLen)}...${address.slice(-suffixLen)}`;
}
