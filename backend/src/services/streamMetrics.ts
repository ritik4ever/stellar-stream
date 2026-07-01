import { getDb } from "./db";

export interface StreamMetrics {
  total_streams: number;
  active_streams: number;
  total_vested_usdc: number;
  total_vested_xlm: number;
  streams_completed_today: number;
}

const CACHE_TTL_MS = 60_000;
let cachedMetrics: StreamMetrics | null = null;
let cacheExpiresAt = 0;

const VESTED_AMOUNT_SQL = `
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
`;

export function getStreamMetrics(): StreamMetrics {
  const now = Date.now();
  if (cachedMetrics && now < cacheExpiresAt) {
    return cachedMetrics;
  }

  const db = getDb();
  const nowSec = Math.floor(now / 1000);
  const todayStartSec = Math.floor(
    Date.UTC(
      new Date(now).getUTCFullYear(),
      new Date(now).getUTCMonth(),
      new Date(now).getUTCDate(),
    ) / 1000,
  );

  const row = db
    .prepare(
      `
    SELECT
      COUNT(*)                                                      AS total_streams,
      COUNT(CASE
        WHEN canceled_at IS NULL
         AND completed_at IS NULL
         AND paused_at IS NULL
         AND start_at <= :now
         AND (start_at + duration_seconds + paused_duration) > :now
        THEN 1 END)                                                 AS active_streams,
      COALESCE(SUM(
        CASE WHEN UPPER(asset_code) = 'USDC' THEN ${VESTED_AMOUNT_SQL} ELSE 0 END
      ), 0)                                                         AS total_vested_usdc,
      COALESCE(SUM(
        CASE WHEN UPPER(asset_code) = 'XLM' THEN ${VESTED_AMOUNT_SQL} ELSE 0 END
      ), 0)                                                         AS total_vested_xlm,
      COUNT(CASE
        WHEN completed_at IS NOT NULL
         AND completed_at >= :todayStart
        THEN 1 END)                                                 AS streams_completed_today
    FROM streams
  `,
    )
    .get({ now: nowSec, todayStart: todayStartSec }) as StreamMetrics;

  cachedMetrics = {
    total_streams: row.total_streams,
    active_streams: row.active_streams,
    total_vested_usdc: Math.round(row.total_vested_usdc * 100) / 100,
    total_vested_xlm: Math.round(row.total_vested_xlm * 100) / 100,
    streams_completed_today: row.streams_completed_today,
  };
  cacheExpiresAt = now + CACHE_TTL_MS;

  return cachedMetrics;
}

/** Exposed for testing and cache invalidation after stream mutations. */
export function resetStreamMetricsCache(): void {
  cachedMetrics = null;
  cacheExpiresAt = 0;
}
