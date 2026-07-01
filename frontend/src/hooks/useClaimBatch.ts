import { useCallback, useRef, useState } from "react";
import { claimStream, getClaimableBatch, ClaimResult } from "../services/soroban";
import type { StreamEvent } from "../services/api";

export type BatchClaimPhase = "idle" | "fetching" | "ready" | "claiming" | "complete";

export interface BatchClaimFailure {
  streamId: string;
  message: string;
}

export interface BatchClaimState {
  phase: BatchClaimPhase;
  claimableByStreamId: Record<string, number>;
  totalClaimable: number;
  assetLabel: string;
  progress: { current: number; total: number };
  failures: BatchClaimFailure[];
  successCount: number;
  error: string | null;
}

export interface BatchClaimInput {
  streamId: string;
  amount: number;
  assetCode: string;
}

const initialState: BatchClaimState = {
  phase: "idle",
  claimableByStreamId: {},
  totalClaimable: 0,
  assetLabel: "XLM",
  progress: { current: 0, total: 0 },
  failures: [],
  successCount: 0,
  error: null,
};

/**
 * Batch claim hook: fetches claimable amounts via get_claimable_batch simulation,
 * then signs and submits each claim transaction sequentially.
 */
export function useClaimBatch(
  onSuccess: (streamId: string, result: ClaimResult, history: StreamEvent[]) => void,
) {
  const [state, setState] = useState<BatchClaimState>(initialState);
  const runIdRef = useRef(0);

  const reset = useCallback(() => {
    runIdRef.current += 1;
    setState(initialState);
  }, []);

  const fetchClaimable = useCallback(
    async (inputs: BatchClaimInput[]): Promise<BatchClaimInput[]> => {
      const streamIds = inputs.map((i) => i.streamId);
      if (streamIds.length === 0) {
        return [];
      }

      const runId = ++runIdRef.current;
      setState((s) => ({ ...s, phase: "fetching", error: null }));

      try {
        const { amounts } = await getClaimableBatch(streamIds);
        if (runIdRef.current !== runId) return [];

        const claimable = inputs
          .map((input) => ({
            ...input,
            amount: amounts[input.streamId] ?? 0,
          }))
          .filter((input) => input.amount > 0);

        const totalClaimable = claimable.reduce((sum, i) => sum + i.amount, 0);
        const assetCodes = new Set(claimable.map((i) => i.assetCode));
        const assetLabel =
          assetCodes.size === 1 ? [...assetCodes][0] : "tokens";

        setState({
          phase: "ready",
          claimableByStreamId: Object.fromEntries(
            claimable.map((i) => [i.streamId, i.amount]),
          ),
          totalClaimable,
          assetLabel,
          progress: { current: 0, total: claimable.length },
          failures: [],
          successCount: 0,
          error: null,
        });

        return claimable;
      } catch (err) {
        if (runIdRef.current !== runId) return [];
        const message =
          err instanceof Error ? err.message : "Failed to fetch claimable amounts.";
        setState((s) => ({ ...s, phase: "idle", error: message }));
        throw err;
      }
    },
    [],
  );

  const executeBatch = useCallback(
    async (claimable: BatchClaimInput[], recipientAddress: string) => {
      if (claimable.length === 0) return;

      const runId = ++runIdRef.current;
      const failures: BatchClaimFailure[] = [];
      let successCount = 0;

      setState((s) => ({
        ...s,
        phase: "claiming",
        progress: { current: 0, total: claimable.length },
        failures: [],
        successCount: 0,
      }));

      for (let i = 0; i < claimable.length; i++) {
        if (runIdRef.current !== runId) return;

        const { streamId, amount, assetCode } = claimable[i];
        setState((s) => ({
          ...s,
          progress: { current: i + 1, total: claimable.length },
        }));

        try {
          const { result, history } = await claimStream(
            streamId,
            recipientAddress,
            amount,
            assetCode,
          );
          successCount++;
          await onSuccess(streamId, result, history);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Claim failed. Please try again.";
          failures.push({ streamId, message });
        }
      }

      if (runIdRef.current !== runId) return;

      setState((s) => ({
        ...s,
        phase: "complete",
        failures,
        successCount,
        progress: { current: claimable.length, total: claimable.length },
      }));
    },
    [onSuccess],
  );

  return {
    state,
    fetchClaimable,
    executeBatch,
    reset,
    isClaiming: state.phase === "claiming",
  };
}
