import { useEffect, useRef, useState } from "react";
import { Stream } from "../types/stream";

const TICK_MS = 100;

export interface LiveVestingState {
  /** Tokens vesting per second at the current rate (0 when not actively streaming). */
  ratePerSecond: number;
  /** Smoothly interpolated "vested so far" value, refreshed ~10x/sec while active. */
  totalVested: number;
  /** Currently claimable amount — mirrors totalVested; the server settles the exact
   *  amount at claim time, this is purely a live display estimate. */
  claimable: number;
  /** False when paused/scheduled/completed/canceled — value is frozen, not ticking. */
  isLive: boolean;
}

/**
 * Drives a smooth, client-side "vesting clock" for the stream detail page.
 *
 * Between server snapshots (initial fetch / websocket pushes), this hook
 * extrapolates the vested amount forward using the stream's linear
 * ratePerSecond, re-rendering at ~10fps (every 100ms) via requestAnimationFrame
 * for a jank-free counter. Whenever a fresh `stream` snapshot arrives (new
 * vestedAmount from the server) the extrapolation re-anchors to it, so drift
 * never accumulates. When the stream isn't "active" it freezes on the last
 * known value.
 */
export function useLiveVesting(stream: Stream | null): LiveVestingState {
  const [, forceTick] = useState(0);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
  const snapshotRef = useRef<{ vestedAmount: number; capturedAtMs: number } | null>(null);

  const isActive = stream?.progress.status === "active";
  const snapshotVestedAmount = stream?.progress.vestedAmount;

  // Re-anchor the extrapolation base whenever we get a fresh server value
  // (drawer open, refetch, or a websocket progress push).
  useEffect(() => {
    if (!stream) {
      snapshotRef.current = null;
      return;
    }
    snapshotRef.current = {
      vestedAmount: stream.progress.vestedAmount,
      capturedAtMs: Date.now(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream?.id, snapshotVestedAmount]);

  useEffect(() => {
    if (!isActive) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      return;
    }

    const loop = (now: number) => {
      if (now - lastFrameRef.current >= TICK_MS) {
        lastFrameRef.current = now;
        forceTick((t) => t + 1);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [isActive]);

  if (!stream) {
    return { ratePerSecond: 0, totalVested: 0, claimable: 0, isLive: false };
  }

  if (!isActive) {
    return {
      ratePerSecond: 0,
      totalVested: stream.progress.vestedAmount,
      claimable: stream.progress.vestedAmount,
      isLive: false,
    };
  }

  const snapshot = snapshotRef.current;
  const elapsedSinceSnapshot = snapshot
    ? Math.max(0, (Date.now() - snapshot.capturedAtMs) / 1000)
    : 0;
  const extrapolated =
    (snapshot?.vestedAmount ?? stream.progress.vestedAmount) +
    stream.progress.ratePerSecond * elapsedSinceSnapshot;
  const totalVested = Math.min(extrapolated, stream.totalAmount);

  return {
    ratePerSecond: stream.progress.ratePerSecond,
    totalVested,
    claimable: totalVested,
    isLive: true,
  };
}