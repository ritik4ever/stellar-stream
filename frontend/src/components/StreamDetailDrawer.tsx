import { useEffect, useRef, useState, useCallback } from "react";
import { Stream } from "../types/stream";
import { StreamEvent, getStream, getStreamHistory } from "../services/api";
import { CopyableAddress } from "./CopyableAddress";
import { CliffMarker } from "./CliffMarker";

const STELLAR_EXPERT_BASE = "https://stellar.expert/explorer/testnet/tx";

/**
 * Renders a transaction hash as a truncated, clickable link to Stellar Expert.
 * Shows first 8 + last 8 characters with the full hash in a tooltip.
 */
export function TxHashLink({ txHash }: { txHash: string }) {
  const truncated = `${txHash.slice(0, 8)}…${txHash.slice(-8)}`;
  return (
    <a
      href={`${STELLAR_EXPERT_BASE}/${txHash}`}
      target="_blank"
      rel="noopener noreferrer"
      title={txHash}
      className="tx-hash-link"
      aria-label={`View transaction ${txHash} on Stellar Expert`}
    >
      <code>{truncated}</code>
    </a>
  );
}

interface StreamDetailDrawerProps {
  streamId: string;
  /** Called when the drawer should close */
  onClose: () => void;
  /** Called when cancel action is triggered from the drawer */
  onCancel?: (streamId: string) => Promise<void>;
  /** Called when pause action is triggered from the drawer */
  onPause?: (streamId: string) => Promise<void>;
  /** Called when resume action is triggered from the drawer */
  onResume?: (streamId: string) => Promise<void>;
  /**
   * Sign an arbitrary action payload before mutating actions.
   * Receives { action, streamId, timestamp } and returns the signature.
   * When not provided the action buttons are not shown.
   */
  signAction?: (payload: Record<string, unknown>) => Promise<string>;
  /** The connected wallet address — used to gate sender-only actions */
  walletAddress?: string | null;
}

function formatTs(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString();
}

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

function eventIcon(type: StreamEvent["eventType"]): string {
  const icons: Record<string, string> = {
    created: "✦",
    claimed: "↓",
    canceled: "✕",
    start_time_updated: "✎",
    paused: "⏸",
    resumed: "▶",
  };
  return icons[type] ?? "•";
}

function eventLabel(type: StreamEvent["eventType"]): string {
  const labels: Record<string, string> = {
    created: "Stream created",
    claimed: "Tokens claimed",
    canceled: "Stream canceled",
    start_time_updated: "Start time updated",
    paused: "Stream paused",
    resumed: "Stream resumed",
  };
  return labels[type] ?? type;
}

/** Skeleton block for loading state */
function Skeleton({ width = "100%", height = "1rem" }: { width?: string; height?: string }) {
  return (
    <span
      className="skeleton"
      style={{ width, height, display: "block" }}
      aria-hidden="true"
    />
  );
}

export function StreamDetailDrawer({
  streamId,
  onClose,
  onCancel,
  onPause,
  onResume,
  signAction,
  walletAddress,
}: StreamDetailDrawerProps) {
  const [stream, setStream] = useState<Stream | null>(null);
  const [history, setHistory] = useState<StreamEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [pausing, setPausing] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Abort controller to avoid race conditions on rapid open/close
  const abortRef = useRef<AbortController | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const fetchData = useCallback(async (id: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);
    setStream(null);
    setHistory([]);

    try {
      const [s, h] = await Promise.all([getStream(id), getStreamHistory(id)]);
      if (ctrl.signal.aborted) return;
      setStream(s);
      setHistory(h);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      const msg = err instanceof Error ? err.message : "Failed to load stream.";
      setError(msg.toLowerCase().includes("not found")
        ? `Stream "${id}" could not be found. It may have been deleted.`
        : msg);
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, []);

  // Fetch whenever streamId changes
  useEffect(() => {
    fetchData(streamId);
    return () => { abortRef.current?.abort(); };
  }, [streamId, fetchData]);

  // Auto-focus close button when drawer opens
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // Trap focus inside drawer and close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = document.getElementById("stream-detail-panel");
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
        e.preventDefault();
        (e.shiftKey ? last : first)?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleCancel() {
    if (!stream || !onCancel) return;
    setCanceling(true);
    setCancelError(null);
    try {
      await onCancel(stream.id);
      await fetchData(stream.id);
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : "Cancel failed.");
    } finally {
      setCanceling(false);
    }
  }

  async function handlePause() {
    if (!stream || !onPause || !signAction) return;
    setPausing(true);
    setActionError(null);
    try {
      await signAction({ action: "pause", streamId: stream.id, timestamp: Date.now() });
      await onPause(stream.id);
      await fetchData(stream.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Pause failed.");
    } finally {
      setPausing(false);
    }
  }

  async function handleResume() {
    if (!stream || !onResume || !signAction) return;
    setResuming(true);
    setActionError(null);
    try {
      await signAction({ action: "resume", streamId: stream.id, timestamp: Date.now() });
      await onResume(stream.id);
      await fetchData(stream.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Resume failed.");
    } finally {
      setResuming(false);
    }
  }

  const isFinalised = stream
    ? stream.progress.status === "completed" || stream.progress.status === "canceled"
    : false;

  // Sender-only action gate: wallet must be connected and match stream sender
  const isSender =
    !!walletAddress &&
    !!stream &&
    walletAddress === stream.sender;

  const showPause =
    isSender &&
    !!onPause &&
    !!signAction &&
    stream?.progress.status === "active";

  const showResume =
    isSender &&
    !!onResume &&
    !!signAction &&
    stream?.progress.status === "paused";

  const hasActions = !!onCancel || showPause || showResume;

  return (
    <div
      className="drawer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Stream detail: ${streamId}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <aside
        id="stream-detail-panel"
        className="drawer-panel"
        data-testid="visual-stream-detail"
        aria-labelledby="drawer-title"
      >
        {/* Header */}
        <div className="drawer-header">
          <h2 id="drawer-title" className="drawer-title">
            Stream Detail
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            className="modal-close"
            aria-label="Close stream detail"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="drawer-body">
          {/* Error state */}
          {error && !loading && (
            <div className="drawer-error" role="alert">
              <span className="drawer-error__icon" aria-hidden="true">⚠</span>
              <div>
                <p className="drawer-error__msg">{error}</p>
                <button
                  type="button"
                  className="retry-btn"
                  onClick={() => fetchData(streamId)}
                  style={{ marginTop: "0.5rem" }}
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {/* Loading skeleton */}
          {loading && (
            <div className="drawer-skeleton" aria-label="Loading stream details" aria-busy="true">
              <Skeleton height="1.2rem" width="60%" />
              <Skeleton height="0.9rem" width="40%" />
              <Skeleton height="0.9rem" width="80%" />
              <Skeleton height="0.9rem" width="70%" />
              <Skeleton height="7px" />
              <Skeleton height="60px" />
              <Skeleton height="60px" />
            </div>
          )}

          {/* Content */}
          {!loading && !error && stream && (
            <>
              {/* Metadata section */}
              <section className="drawer-section" aria-labelledby="drawer-meta-heading">
                <h3 id="drawer-meta-heading" className="drawer-section-title">Metadata</h3>
                <dl className="drawer-dl">
                  <div className="drawer-dl__row">
                    <dt>Stream ID</dt>
                    <dd><code className="drawer-code">{stream.id}</code></dd>
                  </div>
                  <div className="drawer-dl__row">
                    <dt>Status</dt>
                    <dd><span className={statusClass(stream.progress.status)}>{stream.progress.status}</span></dd>
                  </div>
                  <div className="drawer-dl__row">
                    <dt>Asset</dt>
                    <dd>{stream.totalAmount} {stream.assetCode}</dd>
                  </div>
                  <div className="drawer-dl__row">
                    <dt>Sender</dt>
                    <dd><CopyableAddress address={stream.sender} truncationMode="end" /></dd>
                  </div>
                  <div className="drawer-dl__row">
                    <dt>Recipient</dt>
                    <dd><CopyableAddress address={stream.recipient} truncationMode="end" /></dd>
                  </div>
                  <div className="drawer-dl__row">
                    <dt>Created</dt>
                    <dd>{formatTs(stream.createdAt)}</dd>
                  </div>
                  <div className="drawer-dl__row">
                    <dt>Start</dt>
                    <dd>{formatTs(stream.startAt)}</dd>
                  </div>
                  {stream.cliffSeconds != null && stream.cliffSeconds > 0 && (
                    <div className="drawer-dl__row">
                      <dt>Cliff Period</dt>
                      <dd>{(stream.cliffSeconds / 86400).toFixed(1)} days ({stream.cliffSeconds}s)</dd>
                    </div>
                  )}
                  {stream.canceledAt && (
                    <div className="drawer-dl__row">
                      <dt>Canceled</dt>
                      <dd>{formatTs(stream.canceledAt)}</dd>
                    </div>
                  )}
                </dl>
              </section>

              {/* On-chain metadata */}
              {stream.metadata && Object.keys(stream.metadata).length > 0 && (
                <section className="drawer-section" aria-labelledby="drawer-onchain-meta-heading">
                  <h3 id="drawer-onchain-meta-heading" className="drawer-section-title">On-chain Metadata</h3>
                  <table className="drawer-metadata-table" aria-label="Stream metadata">
                    <thead>
                      <tr>
                        <th>Key</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(stream.metadata).map(([key, value]) => (
                        <tr key={key}>
                          <td><code className="drawer-code">{key}</code></td>
                          <td>{value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              {/* Progress section */}
              <section className="drawer-section" aria-labelledby="drawer-progress-heading">
                <h3 id="drawer-progress-heading" className="drawer-section-title">Progress</h3>
                <div className="drawer-progress-header">
                  <span className="drawer-progress-pct">{stream.progress.percentComplete}%</span>
                  <span className="muted">
                    {stream.progress.vestedAmount} / {stream.totalAmount} {stream.assetCode} vested
                  </span>
                </div>
                <div style={{ position: "relative", padding: "0.5rem 0" }}>
                  {stream.cliffSeconds != null && stream.cliffSeconds > 0 && (
                    <CliffMarker
                      startAt={stream.startAt}
                      cliffSeconds={stream.cliffSeconds}
                      durationSeconds={stream.durationSeconds}
                      now={Math.floor(Date.now() / 1000)}
                    />
                  )}
                  <div
                    className="progress-bar"
                    role="progressbar"
                    aria-valuenow={stream.progress.percentComplete}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Stream progress"
                  >
                    <div style={{ width: `${Math.min(stream.progress.percentComplete, 100)}%` }} />
                  </div>
                </div>
                <dl className="drawer-dl" style={{ marginTop: "0.75rem" }}>
                  <div className="drawer-dl__row">
                    <dt>Rate</dt>
                    <dd>{stream.progress.ratePerSecond} {stream.assetCode}/s</dd>
                  </div>
                  <div className="drawer-dl__row">
                    <dt>Elapsed</dt>
                    <dd>{stream.progress.elapsedSeconds}s</dd>
                  </div>
                  <div className="drawer-dl__row">
                    <dt>Remaining</dt>
                    <dd>{stream.progress.remainingAmount} {stream.assetCode}</dd>
                  </div>
                </dl>
              </section>

              {/* Actions */}
              {hasActions && (
                <section className="drawer-section" aria-labelledby="drawer-actions-heading">
                  <h3 id="drawer-actions-heading" className="drawer-section-title">Actions</h3>

                  {cancelError && (
                    <p className="drawer-cancel-error" role="alert">{cancelError}</p>
                  )}
                  {actionError && (
                    <p className="drawer-cancel-error" role="alert">{actionError}</p>
                  )}

                  <div className="action-cell">
                    {/* Pause — active streams, sender only */}
                    {showPause && (
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={pausing}
                        onClick={handlePause}
                        aria-busy={pausing}
                      >
                        {pausing ? "Pausing…" : "⏸ Pause"}
                      </button>
                    )}

                    {/* Resume — paused streams, sender only */}
                    {showResume && (
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={resuming}
                        onClick={handleResume}
                        aria-busy={resuming}
                      >
                        {resuming ? "Resuming…" : "▶ Resume"}
                      </button>
                    )}

                    {/* Cancel */}
                    {onCancel && (
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={isFinalised || canceling}
                        onClick={handleCancel}
                        aria-busy={canceling}
                      >
                        {canceling ? "Canceling…" : "Cancel Stream"}
                      </button>
                    )}
                  </div>
                </section>
              )}

              {/* Event history */}
              <section className="drawer-section" aria-labelledby="drawer-history-heading">
                <h3 id="drawer-history-heading" className="drawer-section-title">Event History</h3>
                {history.length === 0 ? (
                  <div className="activity-empty" role="status">
                    <span className="activity-empty-icon" aria-hidden="true">📭</span>
                    <p>No events yet.</p>
                  </div>
                ) : (
                  <ol className="activity-feed drawer-history-list" aria-label="Event history">
                    {history.map((evt) => (
                      <li key={evt.id} className="activity-item">
                        <span className="activity-icon" aria-hidden="true">{eventIcon(evt.eventType)}</span>
                        <div className="activity-content">
                          <p className="activity-title">{eventLabel(evt.eventType)}</p>
                          <div className="activity-meta">
                            <time dateTime={new Date(evt.timestamp * 1000).toISOString()}>
                              {formatTs(evt.timestamp)}
                            </time>
                            {evt.actor && <span>· {evt.actor}</span>}
                            {evt.amount != null && (
                              <span>· {evt.amount} tokens</span>
                            )}
                            {evt.txHash && (
                              <span>· <TxHashLink txHash={evt.txHash} /></span>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
