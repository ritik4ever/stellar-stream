import { useEffect } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import type { BatchClaimState } from "../hooks/useClaimBatch";

interface ClaimBatchModalProps {
  state: BatchClaimState;
  streamCount: number;
  onConfirm: () => void;
  onClose: () => void;
}

export function ClaimBatchModal({
  state,
  streamCount,
  onConfirm,
  onClose,
}: ClaimBatchModalProps) {
  const panelRef = useFocusTrap<HTMLDivElement>(true);
  const isClaiming = state.phase === "claiming";
  const isComplete = state.phase === "complete";

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isClaiming) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isClaiming, onClose]);

  const claimableEntries = Object.entries(state.claimableByStreamId || {});
  const claimableStreamsCount = claimableEntries.filter(([, amount]) => amount > 0).length;
  const isZeroClaimable = state.totalClaimable <= 0;
  const isPartialClaim = !isZeroClaimable && claimableStreamsCount < streamCount && streamCount > 1;

  const hasFailure = Boolean(state.error || (isComplete && state.failures.length > 0));
  const failureMessage = state.error || (state.failures.length > 0 ? state.failures[0].message : "");

  const handleRetry = () => {
    if (isClaiming) return;
    onConfirm();
  };

  const summaryLabel = `Claim ${state.totalClaimable.toFixed(4)} ${state.assetLabel} across ${streamCount} stream${streamCount !== 1 ? "s" : ""}`;

  const a11yAnnouncement = (() => {
    if (state.phase === "fetching") return "Loading claimable amounts.";
    if (isClaiming) return `Claiming ${state.progress.current} of ${state.progress.total} streams.`;
    if (isComplete) return `Batch claim complete. ${state.successCount} of ${state.progress.total} claims succeeded.`;
    if (state.error) return `Error during claim: ${state.error}`;
    if (state.phase === "ready") return `Claim preview ready: ${summaryLabel}`;
    return "";
  })();

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isClaiming) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="claim-batch-title"
        aria-describedby="claim-batch-summary"
        tabIndex={-1}
      >
        {/* Screen Reader Live Region Announcer */}
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
          data-testid="claim-a11y-announcer"
        >
          {a11yAnnouncement}
        </div>

        <h2 id="claim-batch-title">Batch claim</h2>

        {state.phase === "fetching" && (
          <p className="muted" role="status">
            Loading claimable amounts…
          </p>
        )}

        {(state.phase === "ready" || isClaiming || isComplete) && (
          <>
            <p id="claim-batch-summary" data-testid="claim-preview-summary">{summaryLabel}</p>

            {state.phase === "ready" && isZeroClaimable && (
              <div
                className="boundary-notice boundary-notice--zero"
                role="status"
                data-testid="claim-preview-zero-notice"
                style={{
                  padding: "0.75rem 1rem",
                  backgroundColor: "#fef3c7",
                  border: "1px solid #fde68a",
                  borderRadius: "8px",
                  color: "#92400e",
                  fontSize: "0.875rem",
                  marginBottom: "0.75rem",
                }}
              >
                <strong>No claimable balance.</strong> All selected streams currently have zero claimable balance. Funds will become available as streams vest.
              </div>
            )}

            {state.phase === "ready" && isPartialClaim && (
              <div
                className="boundary-notice boundary-notice--partial"
                role="status"
                data-testid="claim-preview-partial-notice"
                style={{
                  padding: "0.75rem 1rem",
                  backgroundColor: "#eff6ff",
                  border: "1px solid #bfdbfe",
                  borderRadius: "8px",
                  color: "#1e40af",
                  fontSize: "0.875rem",
                  marginBottom: "0.75rem",
                }}
              >
                <strong>Partial claim available.</strong> Only {claimableStreamsCount} of {streamCount} streams have vested funds ready to claim ({state.totalClaimable.toFixed(4)} {state.assetLabel}).
              </div>
            )}

            {isClaiming && (
              <p className="muted" role="status" aria-live="polite">
                Claiming {state.progress.current} of {state.progress.total}
              </p>
            )}

            {isComplete && !hasFailure && (
              <div role="status" aria-live="polite">
                <p>
                  {state.successCount} of {state.progress.total} claim
                  {state.progress.total !== 1 ? "s" : ""} succeeded.
                </p>
              </div>
            )}

            {hasFailure && (
              <div
                className="claim-recovery-box"
                role="alert"
                data-testid="claim-error-recovery"
                style={{
                  padding: "0.75rem 1rem",
                  backgroundColor: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: "8px",
                  color: "#991b1b",
                  marginBottom: "0.75rem",
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>
                  {failureMessage.toLowerCase().includes("reject") || failureMessage.toLowerCase().includes("decline")
                    ? "Wallet Signature Rejected"
                    : "Transaction Failed"}
                </div>
                <p style={{ margin: 0, fontSize: "0.875rem" }} data-testid="claim-error-message">
                  {failureMessage}
                </p>
                <p style={{ margin: "0.5rem 0 0", fontSize: "0.8rem", color: "#7f1d1d" }}>
                  Your claim input is preserved. Verify your wallet connection and click below to retry safely.
                </p>
                {state.failures.length > 1 && (
                  <ul className="claim-batch-failures" style={{ marginTop: "0.5rem", fontSize: "0.8rem" }}>
                    {state.failures.map((f) => (
                      <li key={f.streamId}>
                        Stream {f.streamId}: {f.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}

        <div className="modal-actions">
          {hasFailure && !isClaiming ? (
            <>
              <button
                type="button"
                className="btn-ghost"
                onClick={onClose}
                data-testid="claim-cancel-btn"
                style={{ minHeight: "44px", minWidth: "44px" }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleRetry}
                data-testid="claim-retry-btn"
                disabled={isClaiming}
                style={{ minHeight: "44px", minWidth: "44px" }}
              >
                Retry claim
              </button>
            </>
          ) : (
            <>
              {state.phase === "ready" && (
                <>
                  <button type="button" className="btn-ghost" onClick={onClose} data-testid="claim-cancel-btn">
                    Cancel
                  </button>
                  {isZeroClaimable ? (
                    <button
                      type="button"
                      className="btn-primary"
                      disabled
                      aria-disabled="true"
                      data-testid="claim-confirm-btn"
                      style={{ opacity: 0.6, cursor: "not-allowed" }}
                    >
                      Nothing to claim
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={onConfirm}
                      data-testid="claim-confirm-btn"
                    >
                      {isPartialClaim ? "Confirm partial claim" : "Confirm claim"}
                    </button>
                  )}
                </>
              )}
              {isClaiming && (
                <button type="button" className="btn-primary" disabled aria-busy="true">
                  Claiming…
                </button>
              )}
              {isComplete && (
                <button type="button" className="btn-primary" onClick={onClose} data-testid="claim-close-btn">
                  Close
                </button>
              )}
              {state.phase === "fetching" && (
                <button type="button" className="btn-ghost" onClick={onClose} data-testid="claim-cancel-btn">
                  Cancel
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
