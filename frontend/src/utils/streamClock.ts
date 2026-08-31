/**
 * streamClock.ts
 *
 * Pure helper that derives a live "vesting clock" from a stream's fields and
 * the current unix time. Used by the public stream view and the embed widget
 * so progress bars tick forward in real time without extra API calls.
 */

import { Stream } from "../types/stream";

export interface LiveProgress {
  status: Stream["progress"]["status"];
  /** Amount vested at `nowSeconds` (live for active streams). */
  vestedAmount: number;
  /** Amount still to vest (live for active streams). */
  remainingAmount: number;
  /** Percent complete, 0–100 (live for active streams). */
  percentComplete: number;
  /** Seconds elapsed since start (live for active streams). */
  elapsedSeconds: number;
  /** Seconds remaining until fully vested, or until start for scheduled. */
  remainingSeconds: number;
  ratePerSecond: number;
}

/**
 * Computes live progress for a stream at a given point in time.
 *
 * - `active`: vested amount and elapsed time are recomputed from
 *   `startAt`, `pausedDuration`, and `ratePerSecond`, so the clock ticks.
 * - `scheduled`: shows a live countdown until `startAt`.
 * - `paused` / `completed` / `canceled`: frozen snapshot from the API's
 *   `progress` field.
 *
 * @param stream - The stream to evaluate.
 * @param nowSeconds - Current unix time in seconds (injectable for tests).
 */
export function computeLiveProgress(
  stream: Stream,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): LiveProgress {
  const {
    status,
    ratePerSecond,
    vestedAmount,
    remainingAmount,
    percentComplete,
    elapsedSeconds,
  } = stream.progress;
  const { totalAmount, startAt, durationSeconds } = stream;
  const pausedDuration = stream.pausedDuration ?? 0;

  if (status === "scheduled") {
    return {
      status,
      vestedAmount: 0,
      remainingAmount: totalAmount,
      percentComplete: 0,
      elapsedSeconds: 0,
      remainingSeconds: Math.max(0, startAt - nowSeconds),
      ratePerSecond,
    };
  }

  if (status === "active") {
    const elapsed = Math.max(0, nowSeconds - startAt - pausedDuration);
    const vested = Math.min(totalAmount, elapsed * ratePerSecond);
    const remaining = Math.max(0, totalAmount - vested);
    const pct =
      totalAmount > 0 ? Math.min(100, (vested / totalAmount) * 100) : 0;
    const remainingSeconds =
      ratePerSecond > 0
        ? remaining / ratePerSecond
        : Math.max(
            0,
            startAt + durationSeconds + pausedDuration - nowSeconds,
          );

    return {
      status,
      vestedAmount: vested,
      remainingAmount: remaining,
      percentComplete: pct,
      elapsedSeconds: elapsed,
      remainingSeconds,
      ratePerSecond,
    };
  }

  // paused / completed / canceled → frozen snapshot from the API
  return {
    status,
    vestedAmount,
    remainingAmount,
    percentComplete,
    elapsedSeconds,
    remainingSeconds:
      ratePerSecond > 0 ? remainingAmount / ratePerSecond : 0,
    ratePerSecond,
  };
}
