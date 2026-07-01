import { useCallback, useEffect, useState } from "react";
import { listRecipientStreams, StreamEvent } from "../services/api";
import { Stream } from "../types/stream";
import { CopyableAddress } from "./CopyableAddress";
import { useClaimStream, ClaimState } from "../hooks/useClaimStream";
import { useClaimBatch, type BatchClaimInput } from "../hooks/useClaimBatch";
import { ClaimBatchModal } from "./ClaimBatchModal";
import { ClaimResult } from "../services/soroban";

interface RecipientDashboardProps {
  /** Connected wallet address (recipient account). When null, user must connect. */
  recipientAddress: string | null;
}

// ---------------------------------------------------------------------------
// Toast notification (lightweight, no external dep)
// ---------------------------------------------------------------------------

interface ToastProps {
  message: string;
  type: "success" | "error";
  actionHref?: string;
  actionLabel?: string;
  onDismiss: () => void;
}

function Toast({ message, type, actionHref, actionLabel, onDismiss }: ToastProps) {
  return (
    <div
      className={`claim-toast claim-toast--${type}`}
      role="status"
      aria-live="polite"
    >
      <span className="claim-toast__icon" aria-hidden="true">
        {type === "success" ? "✓" : "✕"}
      </span>
      <span className="claim-toast__msg">{message}</span>
      {actionHref && actionLabel && (
        <a
          className="claim-toast__link"
          href={actionHref}
          target="_blank"
          rel="noreferrer"
        >
          {actionLabel}
        </a>
      )}
      <button
        type="button"
        className="claim-toast__dismiss"
        aria-label="Dismiss notification"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Claim button — shows idle / pending / confirmed / failed states
// ---------------------------------------------------------------------------

interface ClaimButtonProps {
  streamId: string;
  claimableAmount: number;
  assetCode: string;
  claimState: ClaimState;
  walletConnected: boolean;
  onClaim: () => void;
}

function ClaimButton({
  streamId,
  claimableAmount,
  assetCode,
  claimState,
  walletConnected,
  onClaim,
}: ClaimButtonProps) {
  const isThisStream = claimState.streamId === streamId;
  const isPending = isThisStream && claimState.status === "pending";
  const isConfirmed = isThisStream && claimState.status === "confirmed";
  const isFailed = isThisStream && claimState.status === "failed";
  const disabled = !walletConnected || isPending || claimableAmount <= 0;

  let label = `Claim ${claimableAmount} ${assetCode}`;
  if (!walletConnected) label = "Connect wallet";
  if (isPending) label = "Claiming…";
  if (isConfirmed) label = "Claimed ✓";

  return (
    <button
      type="button"
      className={`btn-claim${isPending ? " btn-claim--pending" : ""}${isConfirmed ? " btn-claim--confirmed" : ""}${isFailed ? " btn-claim--failed" : ""}`}
      disabled={disabled}
      aria-busy={isPending}
      aria-label={`Claim ${claimableAmount} ${assetCode} from stream ${streamId}`}
      onClick={onClaim}
    >
      {isPending && (
        <span className="btn-claim__spinner" aria-hidden="true" />
      )}
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusClass(status: Stream["progress"]["status"]): string {
  const map: Record<string, string> = {
    active: "badge badge-active",
    scheduled: "badge badge-scheduled",
    completed: "badge badge-completed",
    canceled: "badge badge-canceled",
    paused: "badge badge-paused",
  };
  return map[status] ?? "badge";
}

function getStellarExpertTxUrl(txHash: string): string {
  return `https://stellar.expert/explorer/testnet/tx/${txHash}`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RecipientDashboard({ recipientAddress }: RecipientDashboardProps) {
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
    actionHref?: string;
    actionLabel?: string;
  } | null>(null);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [pendingBatchInputs, setPendingBatchInputs] = useState<BatchClaimInput[]>([]);

  // Auto-dismiss toast after 5 s
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const refreshStreams = useCallback(async () => {
    if (!recipientAddress) return;
    try {
      const data = await listRecipientStreams(recipientAddress);
      setStreams(data);
    } catch {
      // Non-fatal refresh failure — keep stale data
    }
  }, [recipientAddress]);

  /**
   * On successful on-chain claim:
   * 1. Refresh stream list so vested/remaining amounts are up-to-date.
   * 2. Show success toast.
   * The history parameter is available for callers that want to reconcile
   * event logs — here we surface it via the toast message.
   */
  const handleClaimSuccess = useCallback(
    async (streamId: string, result: ClaimResult, _history: StreamEvent[]) => {
      await refreshStreams();
      setToast({
        message: `Successfully claimed ${result.claimedAmount} ${result.assetCode} from stream ${streamId}. Transaction hash: ${result.txHash}`,
        type: "success",
        actionHref: getStellarExpertTxUrl(result.txHash),
        actionLabel: "View on Stellar Expert",
      });
    },
    [refreshStreams],
  );

  const handleBatchClaimSuccess = useCallback(
    async (streamId: string, result: ClaimResult, _history: StreamEvent[]) => {
      await refreshStreams();
      setToast({
        message: `Successfully claimed ${result.claimedAmount} ${result.assetCode} from stream ${streamId}. Transaction hash: ${result.txHash}`,
        type: "success",
        actionHref: getStellarExpertTxUrl(result.txHash),
        actionLabel: "View on Stellar Expert",
      });
    },
    [refreshStreams],
  );

  const {
    state: batchState,
    fetchClaimable,
    executeBatch,
    reset: resetBatch,
    isClaiming: isBatchClaiming,
  } = useClaimBatch(handleBatchClaimSuccess);

  const handleClaimFailure = useCallback((_streamId: string, message: string) => {
    setToast({ message, type: "error" });
  }, []);

  const { claimState, claim, isPending } = useClaimStream(
    handleClaimSuccess,
    handleClaimFailure,
  );

  // Load streams on mount / address change
  useEffect(() => {
    if (!recipientAddress) {
      setLoading(false);
      setStreams([]);
      setError(null);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    listRecipientStreams(recipientAddress)
      .then((data) => {
        if (!active) return;
        setStreams(data);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load streams.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [recipientAddress]);

  // ── Not connected ──────────────────────────────────────────────────────────
  if (!recipientAddress) {
    return (
      <div className="card recipient-dashboard-card">
        <h2 className="recipient-dashboard-title">Recipient Dashboard</h2>
        <div className="activity-empty">
          <span className="activity-empty-icon">🔌</span>
          <p>Wallet Not Connected</p>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            Connect your wallet to see streams where you are the recipient.
          </p>
        </div>
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="card recipient-dashboard-card">
        <h2 className="recipient-dashboard-title">Recipient Dashboard</h2>
        <div className="activity-feed">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton skeleton-item" style={{ height: "80px" }} />
          ))}
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="card recipient-dashboard-card">
        <h2 className="recipient-dashboard-title">Recipient Dashboard</h2>
        <div className="activity-error">
          <span style={{ fontSize: "2rem", display: "block", marginBottom: "0.5rem" }}>⚠️</span>
          <h3>Dashboard Load Failed</h3>
          <p className="muted">{error}</p>
        </div>
      </div>
    );
  }

  const activeStreams = streams.filter(
    (s) => s.progress.status === "active" || s.progress.status === "scheduled",
  );
  const completedStreams = streams.filter(
    (s) => s.progress.status === "completed" || s.progress.status === "canceled",
  );

  const totalClaimable = activeStreams.reduce(
    (sum, s) => sum + s.progress.vestedAmount,
    0,
  );
  const totalClaimed = completedStreams.reduce(
    (sum, s) => sum + s.progress.vestedAmount,
    0,
  );

  // ── Empty ──────────────────────────────────────────────────────────────────
  if (streams.length === 0) {
    return (
      <div className="card recipient-dashboard-card">
        <h2 className="recipient-dashboard-title">Recipient Dashboard</h2>
        <div className="activity-empty">
          <span className="activity-empty-icon">🌊</span>
          <p>No Streams Found</p>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            You have no active or completed streams as a recipient yet.
          </p>
        </div>
      </div>
    );
  }

  // ── Main view ──────────────────────────────────────────────────────────────
  return (
    <div className="recipient-dashboard">
      {/* Toast notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          actionHref={toast.actionHref}
          actionLabel={toast.actionLabel}
          onDismiss={() => setToast(null)}
        />
      )}

      {batchModalOpen && (
        <ClaimBatchModal
          state={batchState}
          streamCount={pendingBatchInputs.length}
          onConfirm={async () => {
            if (!recipientAddress) return;
            const claimable = pendingBatchInputs
              .map((input) => ({
                ...input,
                amount: batchState.claimableByStreamId[input.streamId] ?? 0,
              }))
              .filter((input) => input.amount > 0);
            await executeBatch(claimable, recipientAddress);
          }}
          onClose={() => {
            setBatchModalOpen(false);
            resetBatch();
            setPendingBatchInputs([]);
          }}
        />
      )}

      <div className="card recipient-dashboard-card">
        <h2 className="recipient-dashboard-title">Recipient Dashboard</h2>
        <p className="muted recipient-dashboard-subtitle">
          Streams where you are the recipient. Only your streams are shown.
        </p>

        <section className="recipient-dashboard-metrics">
          <article className="metric-card">
            <span>Active streams</span>
            <strong>{activeStreams.length}</strong>
          </article>
          <article className="metric-card">
            <span>Claimable</span>
            <strong>{Number(totalClaimable.toFixed(2))}</strong>
          </article>
          <article className="metric-card">
            <span>Completed streams</span>
            <strong>{completedStreams.length}</strong>
          </article>
          <article className="metric-card">
            <span>Claimed (completed)</span>
            <strong>{Number(totalClaimed.toFixed(2))}</strong>
          </article>
        </section>

        {activeStreams.length > 0 && (
          <section className="recipient-dashboard-section">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "0.75rem",
              }}
            >
              <h3 className="recipient-dashboard-section-title" style={{ margin: 0 }}>
                Active streams
              </h3>
              {activeStreams.length > 1 && recipientAddress && (
                <button
                  type="button"
                  className="btn-claim"
                  disabled={isPending || isBatchClaiming}
                  onClick={async () => {
                    const inputs: BatchClaimInput[] = activeStreams.map((s) => ({
                      streamId: s.id,
                      amount: s.progress.vestedAmount,
                      assetCode: s.assetCode,
                    }));
                    setPendingBatchInputs(inputs);
                    setBatchModalOpen(true);
                    try {
                      await fetchClaimable(inputs);
                    } catch (err) {
                      setBatchModalOpen(false);
                      setToast({
                        message:
                          err instanceof Error
                            ? err.message
                            : "Failed to load claimable amounts.",
                        type: "error",
                      });
                    }
                  }}
                >
                  Claim all
                </button>
              )}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>From</th>
                    <th>Asset</th>
                    <th>Claimable</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th>Progress</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {activeStreams.map((stream) => (
                    <tr key={stream.id}>
                      <td>
                        <CopyableAddress address={stream.sender} truncationMode="end" />
                      </td>
                      <td>{stream.assetCode}</td>
                      <td>
                        <strong>
                          {stream.progress.vestedAmount} {stream.assetCode}
                        </strong>
                      </td>
                      <td>
                        {stream.totalAmount} {stream.assetCode}
                      </td>
                      <td>
                        <span className={statusClass(stream.progress.status)}>
                          {stream.progress.status}
                        </span>
                      </td>
                      <td>
                        <div className="progress-copy">
                          <strong>{stream.progress.percentComplete}%</strong>
                        </div>
                        <div className="progress-bar" aria-hidden>
                          <div
                            style={{
                              width: `${Math.min(stream.progress.percentComplete, 100)}%`,
                            }}
                          />
                        </div>
                      </td>
                      <td>
                        <ClaimButton
                          streamId={stream.id}
                          claimableAmount={stream.progress.vestedAmount}
                          assetCode={stream.assetCode}
                          claimState={claimState}
                          walletConnected={Boolean(recipientAddress)}
                          onClaim={() =>
                            claim({
                              streamId: stream.id,
                              recipientAddress: recipientAddress,
                              amount: stream.progress.vestedAmount,
                              assetCode: stream.assetCode,
                            })
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {completedStreams.length > 0 && (
          <section className="recipient-dashboard-section">
            <h3 className="recipient-dashboard-section-title">Completed streams</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>From</th>
                    <th>Asset</th>
                    <th>Claimed</th>
                    <th>Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {completedStreams.map((stream) => (
                    <tr key={stream.id}>
                      <td>
                        <CopyableAddress address={stream.sender} truncationMode="end" />
                      </td>
                      <td>{stream.assetCode}</td>
                      <td>
                        <strong>
                          {stream.progress.vestedAmount} {stream.assetCode}
                        </strong>
                      </td>
                      <td>{stream.totalAmount} {stream.assetCode}</td>
                      <td>
                        <span className={statusClass(stream.progress.status)}>
                          {stream.progress.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Global pending indicator — shown when any claim is in-flight */}
        {(isPending || isBatchClaiming) && (
          <div className="claim-pending-banner" role="status" aria-live="polite">
            <span className="btn-claim__spinner" aria-hidden="true" />
            {isBatchClaiming && batchState.progress.total > 0
              ? `Claiming ${batchState.progress.current} of ${batchState.progress.total}…`
              : "Waiting for on-chain confirmation…"}
          </div>
        )}
      </div>
    </div>
  );
}
