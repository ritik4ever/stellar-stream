import { getDb } from "./db";
import { OnChainPlatformStats, getOnChainPlatformStats } from "./onChainAnalytics";

export interface StreamStats {
  total_streams: number;
  active_streams: number;
  completed_streams: number;
  canceled_streams: number;
  total_vested: number;
  avg_duration_seconds: number;
  unique_senders: number;
  unique_recipients: number;
}

export interface GlobalStats {
  total: number;
  active: number;
  scheduled: number;
  paused: number;
  completed: number;
  canceled: number;
  totalVested: number;
  totalAmount: number;
  uniqueSenders: number;
  uniqueRecipients: number;
  localStreamCount: number;
  onChainStreamCount: number | null;
  onChainStats?: OnChainPlatformStats;
}

const CACHE_TTL_MS = 30_000;
let cachedStreamStats: StreamStats | null = null;
let cachedGlobalStats: GlobalStats | null = null;
let cacheExpiresAt = 0;

export function getStreamStats(): StreamStats {
  const now = Date.now();
  if (cachedStreamStats && now < cacheExpiresAt) {
    return cachedStreamStats;
  }

  const db = getDb();
  const nowSec = Math.floor(now / 1000);

  const row = db.prepare(`
    SELECT
      COUNT(*)                                                      AS total_streams,
      COUNT(CASE
        WHEN canceled_at IS NULL
         AND completed_at IS NULL
         AND paused_at IS NULL
         AND start_at <= :now
         AND (start_at + duration_seconds + paused_duration) > :now
        THEN 1 END)                                                 AS active_streams,
      COUNT(CASE WHEN completed_at IS NOT NULL THEN 1 END)          AS completed_streams,
      COUNT(CASE WHEN canceled_at  IS NOT NULL THEN 1 END)          AS canceled_streams,
      COALESCE(SUM(
        CASE
          WHEN canceled_at IS NULL AND completed_at IS NULL
               AND start_at <= :now
          THEN
            CAST(
              total_amount * MIN(
                CASE WHEN paused_at IS NOT NULL THEN paused_at - start_at ELSE :now - start_at END,
                CAST(duration_seconds AS REAL)
              )
              / CAST(duration_seconds AS REAL)
            AS REAL)
          WHEN completed_at IS NOT NULL
          THEN total_amount
          ELSE 0
        END
      ), 0)                                                         AS total_vested,
      COALESCE(AVG(duration_seconds), 0)                            AS avg_duration_seconds,
      COUNT(DISTINCT sender)                                        AS unique_senders,
      COUNT(DISTINCT recipient)                                     AS unique_recipients
    FROM streams
  `).get({ now: nowSec }) as StreamStats;

  cachedStreamStats = {
    total_streams:       row.total_streams,
    active_streams:      row.active_streams,
    completed_streams:   row.completed_streams,
    canceled_streams:    row.canceled_streams,
    total_vested:        Math.round(row.total_vested * 100) / 100,
    avg_duration_seconds: Math.round(row.avg_duration_seconds),
    unique_senders:      row.unique_senders,
    unique_recipients:   row.unique_recipients,
  };
  cacheExpiresAt = now + CACHE_TTL_MS;

  return cachedStreamStats;
}

export function getGlobalStats(): GlobalStats {
  const now = Date.now();
  if (cachedGlobalStats && now < cacheExpiresAt) {
    return cachedGlobalStats;
  }

  const db = getDb();
  const nowSec = Math.floor(now / 1000);

  const row = db.prepare(`
    SELECT
      COUNT(*)                                                      AS total,
      COUNT(CASE
        WHEN canceled_at IS NULL
         AND completed_at IS NULL
         AND paused_at IS NULL
         AND start_at <= :now
         AND (start_at + duration_seconds + paused_duration) > :now
        THEN 1 END)                                                 AS active,
      COUNT(CASE
        WHEN canceled_at IS NULL
         AND completed_at IS NULL
         AND paused_at IS NULL
         AND start_at > :now
        THEN 1 END)                                                 AS scheduled,
      COUNT(CASE
        WHEN canceled_at IS NULL
         AND completed_at IS NULL
         AND paused_at IS NOT NULL
        THEN 1 END)                                                 AS paused,
      COUNT(CASE WHEN completed_at IS NOT NULL THEN 1 END)          AS completed,
      COUNT(CASE WHEN canceled_at  IS NOT NULL THEN 1 END)          AS canceled,
      COALESCE(SUM(
        CASE
          WHEN canceled_at IS NULL AND completed_at IS NULL
               AND start_at <= :now
          THEN
            CAST(
              total_amount * MIN(
                CASE WHEN paused_at IS NOT NULL THEN paused_at - start_at ELSE :now - start_at END,
                CAST(duration_seconds AS REAL)
              )
              / CAST(duration_seconds AS REAL)
            AS REAL)
          WHEN completed_at IS NOT NULL
          THEN total_amount
          ELSE 0
        END
      ), 0)                                                         AS totalVested,
      COALESCE(SUM(total_amount), 0)                                AS totalAmount,
      COUNT(DISTINCT sender)                                        AS uniqueSenders,
      COUNT(DISTINCT recipient)                                     AS uniqueRecipients
    FROM streams
  `).get({ now: nowSec }) as {
    total: number;
    active: number;
    scheduled: number;
    paused: number;
    completed: number;
    canceled: number;
    totalVested: number;
    totalAmount: number;
    uniqueSenders: number;
    uniqueRecipients: number;
  };

  cachedGlobalStats = {
    total: row.total,
    active: row.active,
    scheduled: row.scheduled,
    paused: row.paused,
    completed: row.completed,
    canceled: row.canceled,
    totalVested: Math.round(row.totalVested * 100) / 100,
    totalAmount: Math.round(row.totalAmount * 100) / 100,
    uniqueSenders: row.uniqueSenders,
    uniqueRecipients: row.uniqueRecipients,
    localStreamCount: row.total,
    onChainStreamCount: null,
  };
  cacheExpiresAt = now + CACHE_TTL_MS;

  return cachedGlobalStats as GlobalStats;
}

/** Exposed for testing — resets the in-memory cache. */
export function resetStatsCache(): void {
  cachedStreamStats = null;
  cachedGlobalStats = null;
  cacheExpiresAt = 0;
}

/**
 * Fetch on-chain platform statistics from the Soroban contract.
 * This provides an authoritative view of platform-wide analytics directly from the blockchain.
 *
 * @param contractAddress - The Soroban contract address
 * @param rpcUrl - The Soroban RPC endpoint URL
 * @returns Promise<OnChainPlatformStats> - Platform stats from the contract
 */
export async function fetchOnChainStats(
  contractAddress: string,
  rpcUrl: string
): Promise<OnChainPlatformStats | null> {
  try {
    return await getOnChainPlatformStats(contractAddress, rpcUrl);
  } catch (error) {
    console.warn("Failed to fetch on-chain stats, continuing with local stats only:", error);
    return null;
  }
}
