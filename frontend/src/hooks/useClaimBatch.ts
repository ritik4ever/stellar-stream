import { useState, useRef, useCallback } from "react";
import { claimStream, ClaimResult } from "../services/soroban";
import type { StreamEvent } from "../services/api";

// ── Types ──────────────────────────────────────────────────────────────────

export type BatchClaimStatus = "idle" | "claiming" | "complete" | "aborted";

export interface BatchItemResult {
  streamId: string;
  status: "confirmed" | "failed";
  error?: string;
  result?: ClaimResult;
}

export interface BatchClaimInput {
  streamId: string;
  recipientAddress: string;
  amount: number;
}

export interface BatchClaimState {
  status: BatchClaimStatus;
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  results: BatchItemResult[];
}

// ── Hook ───────────────────────────────────────────────────────────────────

/**
 * Manages the lifecycle of claiming multiple streams in sequence.
 *
 * Usage:
 * ```tsx
 * const { batchState, claimAll } = useClaimBatch(onItemResult);
 *
 * <button disabled={batchState.status === "claiming"} onClick={() => claimAll(items)}>
 *   Claim {items.length} streams
 * </button>
 *
 * {batchState.status === "claiming" && (
 *   <progress value={batchState.completed} max={batchState.total} />
 * )}
 * ```
 *
 * Streams are claimed sequentially (Soroban requires one tx at a time per source account).
 * Partial failures are collected; the batch continues through remaining streams.
 */
export function useClaimBatch(
  onSuccess?: (streamId: string, result: ClaimResult, history: StreamEvent[]) => void,
  onFailure?: (streamId: string, message: string) => void,
) {
  const [batchState, setBatchState] = useState<BatchClaimState>({
    status: "idle",
    total: 0,
    completed: 0,
    succeeded: 0,
    failed: 0,
    results: [],
  });

  const abortRef = useRef(false);
  const batchIdRef = useRef(0);

  const claimAll = useCallback(
    async (items: BatchClaimInput[]) => {
      if (items.length === 0) return;

      const batchId = ++batchIdRef.current;
      abortRef.current = false;

      setBatchState({
        status: "claiming",
        total: items.length,
        completed: 0,
        succeeded: 0,
        failed: 0,
        results: [],
      });

      const results: BatchItemResult[] = [];

      for (let i = 0; i < items.length; i++) {
        // Check for abort
        if (abortRef.current || batchIdRef.current !== batchId) break;
        const { streamId, recipientAddress, amount } = items[i];
        try {
          const { result, history } = await claimStream(
            streamId,
            recipientAddress,
            amount,
          );

          if (batchIdRef.current !== batchId) break;

          results.push({ streamId, status: "confirmed", result });
          await onSuccess?.(streamId, result, history);
          setBatchState((prev) => ({
            ...prev,
            completed: i + 1,
            succeeded: prev.succeeded + 1,
            results: [...results],
          }));
        } catch (err) {
          if (batchIdRef.current !== batchId) break;

          const message =
            err instanceof Error
              ? err.message
              : "Claim failed. Please try again.";

          results.push({ streamId, status: "failed", error: message });
          onFailure?.(streamId, message);
          setBatchState((prev) => ({
            ...prev,
            completed: i + 1,
            failed: prev.failed + 1,
            results: [...results],
          }));
        }
      }

      if (batchIdRef.current === batchId) {
        setBatchState((prev) => ({
          ...prev,
          status: "complete",
        }));
      }
    },
    [onSuccess, onFailure],
  );

  const abort = useCallback(() => {
    abortRef.current = true;
    setBatchState((prev) => ({
      ...prev,
      status: "aborted",
    }));
  }, []);

  const reset = useCallback(() => {
    setBatchState({
      status: "idle",
      total: 0,
      completed: 0,
      succeeded: 0,
      failed: 0,
      results: [],
    });
  }, []);

  return {
    batchState,
    claimAll,
    abort,
    reset,
    isClaiming: batchState.status === "claiming",
  };
}
