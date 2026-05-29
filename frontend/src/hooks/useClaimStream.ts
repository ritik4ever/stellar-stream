import { useState, useRef, useCallback } from "react";
import { claimStream, ClaimResult } from "../services/soroban";
import type { StreamEvent } from "../services/api";

// ── Types ──────────────────────────────────────────────────────────────────

export type ClaimStatus = "idle" | "pending" | "confirmed" | "failed";

export interface ClaimState {
  /** ID of the stream currently being claimed (null when idle). */
  streamId: string | null;
  status: ClaimStatus;
  /** Error message when status === "failed". */
  error: string | null;
}

export interface ClaimInput {
  streamId: string;
  recipientAddress: string;
  /** Claimable amount shown in the UI (informational; contract enforces the real amount). */
  amount: number;
}

// ── Hook ───────────────────────────────────────────────────────────────────

/**
 * Manages the lifecycle of a single on-chain claim operation.
 *
 * Usage:
 * ```tsx
 * const { claimState, claim, isPending } = useClaimStream(onSuccess, onFailure);
 *
 * <button disabled={claimState.status === "pending"} onClick={() => claim({ streamId, recipientAddress, amount })}>
 *   Claim
 * </button>
 * ```
 *
 * Only one claim can be in-flight at a time. Concurrent claims are rejected
 * until the current one resolves.
 */
export function useClaimStream(
  onSuccess: (streamId: string, result: ClaimResult, history: StreamEvent[]) => void | Promise<void>,
  onFailure: (streamId: string, message: string) => void,
) {
  const [claimState, setClaimState] = useState<ClaimState>({
    streamId: null,
    status: "idle",
    error: null,
  });

  // Monotonic claim ID prevents stale async callbacks from updating state.
  const claimIdRef = useRef(0);
  const inFlightRef = useRef(false);

  const claim = useCallback(
    async ({ streamId, recipientAddress, amount }: ClaimInput) => {
      // Block concurrent claims
      if (inFlightRef.current) return;

      // Early return for zero amount to prevent unnecessary API calls
      if (amount === 0) return;

      inFlightRef.current = true;
      const claimId = ++claimIdRef.current;

      setClaimState({ streamId, status: "pending", error: null });

      try {
        const { result, history } = await claimStream(
          streamId,
          recipientAddress,
          amount,
        );

        // Guard against stale callbacks from superseded claims
        if (claimIdRef.current !== claimId) return;

        setClaimState({ streamId, status: "confirmed", error: null });
        await onSuccess(streamId, result, history);

        // Reset to idle after a short delay so the "Claimed ✓" label is visible
        setTimeout(() => {
          if (claimIdRef.current === claimId) {
            setClaimState({ streamId: null, status: "idle", error: null });
          }
        }, 2000);
      } catch (err) {
        if (claimIdRef.current !== claimId) return;

        const message =
          err instanceof Error ? err.message : "Claim failed. Please try again.";

        setClaimState({ streamId, status: "failed", error: message });
        onFailure(streamId, message);
      } finally {
        if (claimIdRef.current === claimId) {
          inFlightRef.current = false;
        }
      }
    },
    [onSuccess, onFailure],
  );

  return {
    claimState,
    claim,
    isPending: claimState.status === "pending",
  };
}
