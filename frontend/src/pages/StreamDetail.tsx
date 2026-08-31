import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { CopyableAddress } from "../components/CopyableAddress";
import { CliffMarker } from "../components/CliffMarker";
import { TxHashLink } from "../components/StreamDetailDrawer";
import { useClaimStream } from "../hooks/useClaimStream";
import { useToast } from "../hooks/useToast";
import {
  cancelStream,
  getStream,
  getStreamHistory,
  pauseStream,
  resumeStream,
  type StreamEvent,
} from "../services/api";
import type { Stream } from "../types/stream";
import { FreighterState } from "../hooks/useFreighter";

interface StreamDetailPageProps {
  wallet?: FreighterState;
}

function formatTs(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString();
}

function formatDuration(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (parts.length === 0) parts.push(`${totalSeconds}s`);
  return parts.join(" ");
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
    cliff_reached: "🏁",
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
    cliff_reached: "Cliff reached",
  };
  return labels[type] ?? type;
}

function Skeleton({ width = "100%", height = "1rem" }: { width?: string; height?: string }) {
  return (
    <span
      className="skeleton"
      style={{ width, height, display: "block" }}
      aria-hidden="true"
    />
  );
}

export function StreamDetailPage({ wallet }: StreamDetailPageProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [stream, setStream] = useState<Stream | null>(null);
  const [history, setHistory] = useState<StreamEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [canceling, setCanceling] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const walletAddress = wallet?.address ?? null;
  const signAction = wallet?.signAction;

  const isSender = !!walletAddress && !!stream && walletAddress === stream.sender;
  const isRecipient = !!walletAddress && !!stream && walletAddress === stream.recipient;
  const isFinalised =
    stream?.progress.status === "completed" || stream?.progress.status === "canceled";

  const showClaim =
    isRecipient &&
    stream?.progress.status !== "canceled" &&
    stream?.progress.vestedAmount > 0;

  const showPause = isSender && stream?.progress.status === "active";
  const showResume = isSender && stream?.progress.status === "paused";
  const showCancel = isSender && !isFinalised;

  const fetchData = useCallback(async (streamId: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);
    setStream(null);
    setHistory([]);

    try {
      const [s, h] = await Promise.all([getStream(streamId), getStreamHistory(streamId)]);
      if (ctrl.signal.aborted) return;
      setStream(s);
      setHistory(h);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      const msg = err instanceof Error ? err.message : "Failed to load stream.";
      setError(
        msg.toLowerCase().includes("not found")
          ? `Stream "${streamId}" could not be found. It may have been deleted.`
          : msg,
      );
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (id) fetchData(id);
    return () => {
      abortRef.current?.abort();
    };
  }, [id, fetchData]);

  const handleClaimSuccess = useCallback(
    () => {
      showToast("Tokens claimed successfully", "success");
      if (id) fetchData(id);
    },
    [id, fetchData, showToast],
  );

  const handleClaimFailure = useCallback(
    (_streamId: string, message: string) => {
      showToast(message, "error");
    },
    [showToast],
  );

  const { claimState, claim } = useClaimStream(handleClaimSuccess, handleClaimFailure);

  async function handleCancel() {
    if (!stream) return;
    setCanceling(true);
    setActionError(null);
    try {
      await cancelStream(stream.id);
      showToast("Stream canceled", "info");
      await fetchData(stream.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Cancel failed.";
      setActionError(msg);
      showToast(msg, "error");
    } finally {
      setCanceling(false);
    }
  }

  async function handlePause() {
    if (!stream) return;
    setPausing(true);
    setActionError(null);
    try {
      if (signAction) {
        await signAction({ action: "pause", streamId: stream.id, timestamp: Date.now() });
      }
      await pauseStream(stream.id);
      showToast("Stream paused", "info");
      await fetchData(stream.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Pause failed.";
      setActionError(msg);
      showToast(msg, "error");
    } finally {
      setPausing(false);
    }
  }

  async function handleResume() {
    if (!stream) return;
    setResuming(true);
    setActionError(null);
    try {
      if (signAction) {
        await signAction({ action: "resume", streamId: stream.id, timestamp: Date.now() });
      }
      await resumeStream(stream.id);
      showToast("Stream resumed", "success");
      await fetchData(stream.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Resume failed.";
      setActionError(msg);
      showToast(msg, "error");
    } finally {
      setResuming(false);
    }
  }

  async function handleClaim() {
    if (!stream || !isRecipient) return;
    await claim({
      streamId: stream.id,
      recipientAddress: walletAddress!,
      amount: stream.progress.vestedAmount,
      assetCode: stream.assetCode,
    });
  }

  const now = Math.floor(Date.now() / 1000);
  const vestingEnd = stream ? stream.startAt + stream.durationSeconds + (stream.pausedDuration ?? 0) : 0;
  const totalDuration = stream ? stream.durationSeconds : 1;

  return (
    <div className="stream-detail-page">
      {/* Header */}
      <div className="stream-detail-header">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => navigate(-1)}
        >
          ← Back
        </button>
        <h1 className="stream-detail-title">Stream Detail</h1>
        {stream && (
          <div className="stream-detail-header-meta">
            <span className={statusClass(stream.progress.status)}>
              {stream.progress.status}
            </span>
            <code className="stream-detail-id">#{stream.id}</code>
          </div>
        )}
      </div>

      {/* Error */}
      {error && !loading && (
        <div className="error-banner" role="alert">
          <em className="error-banner__icon" aria-hidden="true">⚠</em>
          <span>{error}</span>
          <button type="button" className="retry-btn" onClick={() => id && fetchData(id)}>
            Retry
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="stream-detail-loading" aria-busy="true">
          <Skeleton height="1.5rem" width="40%" />
          <Skeleton height="1rem" width="70%" />
          <Skeleton height="1rem" width="55%" />
          <Skeleton height="7px" />
          <Skeleton height="80px" />
          <Skeleton height="120px" />
        </div>
      )}

      {/* Content */}
      {!loading && !error && stream && (
        <div className="stream-detail-panels">
          {/* Stream Metrics */}
          <section className="card stream-detail-panel" aria-labelledby="metrics-heading">
            <h2 id="metrics-heading" className="stream-detail-panel-title">Stream Metrics</h2>
            <dl className="stream-detail-dl">
              <div className="stream-detail-dl__row">
                <dt>Asset</dt>
                <dd>{stream.assetCode}</dd>
              </div>
              <div className="stream-detail-dl__row">
                <dt>Total Amount</dt>
                <dd>{stream.totalAmount} {stream.assetCode}</dd>
              </div>
              <div className="stream-detail-dl__row">
                <dt>Rate</dt>
                <dd>{stream.progress.ratePerSecond} {stream.assetCode}/s</dd>
              </div>
              <div className="stream-detail-dl__row">
                <dt>Elapsed</dt>
                <dd>{formatDuration(stream.progress.elapsedSeconds)}</dd>
              </div>
              <div className="stream-detail-dl__row">
                <dt>Remaining</dt>
                <dd>{stream.progress.remainingAmount} {stream.assetCode}</dd>
              </div>
              <div className="stream-detail-dl__row">
                <dt>Created</dt>
                <dd>{formatTs(stream.createdAt)}</dd>
              </div>
            </dl>
          </section>

          {/* Vesting Clock */}
          <section className="card stream-detail-panel" aria-labelledby="vesting-heading">
            <h2 id="vesting-heading" className="stream-detail-panel-title">Vesting Clock</h2>
            <dl className="stream-detail-dl">
              <div className="stream-detail-dl__row">
                <dt>Start</dt>
                <dd>{formatTs(stream.startAt)}</dd>
              </div>
              <div className="stream-detail-dl__row">
                <dt>End</dt>
                <dd>{formatTs(vestingEnd)}</dd>
              </div>
              <div className="stream-detail-dl__row">
                <dt>Duration</dt>
                <dd>{formatDuration(totalDuration)}</dd>
              </div>
              {stream.cliffSeconds != null && stream.cliffSeconds > 0 && (
                <div className="stream-detail-dl__row">
                  <dt>Cliff</dt>
                  <dd>{(stream.cliffSeconds / 86400).toFixed(1)} days ({stream.cliffSeconds}s)</dd>
                </div>
              )}
              {(stream.pausedDuration ?? 0) > 0 && (
                <div className="stream-detail-dl__row">
                  <dt>Paused Duration</dt>
                  <dd>{formatDuration(stream.pausedDuration!)}</dd>
                </div>
              )}
              {stream.canceledAt && (
                <div className="stream-detail-dl__row">
                  <dt>Canceled</dt>
                  <dd>{formatTs(stream.canceledAt)}</dd>
                </div>
              )}
            </dl>
            <div className="stream-detail-clock">
              <div className="stream-detail-clock-visual">
                <div
                  className="stream-detail-clock-hand"
                  style={{
                    transform: `rotate(${Math.min(stream.progress.percentComplete, 100) * 3.6}deg)`,
                  }}
                />
                <span className="stream-detail-clock-pct">
                  {stream.progress.percentComplete}%
                </span>
              </div>
              <div className="stream-detail-clock-info">
                <span>{stream.progress.vestedAmount} / {stream.totalAmount} {stream.assetCode}</span>
                <span className="muted">vested</span>
              </div>
            </div>
          </section>

          {/* Progress Bar */}
          <section className="card stream-detail-panel stream-detail-panel--wide" aria-labelledby="progress-heading">
            <h2 id="progress-heading" className="stream-detail-panel-title">Progress</h2>
            <div className="stream-detail-progress">
              <span className="stream-detail-progress-pct">{stream.progress.percentComplete}%</span>
              <span className="muted">
                {stream.progress.vestedAmount} / {stream.totalAmount} {stream.assetCode} vested
              </span>
            </div>
            <div style={{ position: "relative", padding: "0.75rem 0" }}>
              {stream.cliffSeconds != null && stream.cliffSeconds > 0 && (
                <CliffMarker
                  startAt={stream.startAt}
                  cliffSeconds={stream.cliffSeconds}
                  durationSeconds={stream.durationSeconds}
                  now={now}
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
            {/* Sender / Recipient addresses */}
            <dl className="stream-detail-dl" style={{ marginTop: "0.75rem" }}>
              <div className="stream-detail-dl__row">
                <dt>Sender</dt>
                <dd><CopyableAddress address={stream.sender} truncationMode="end" /></dd>
              </div>
              <div className="stream-detail-dl__row">
                <dt>Recipient</dt>
                <dd><CopyableAddress address={stream.recipient} truncationMode="end" /></dd>
              </div>
            </dl>
          </section>

          {/* Actions */}
          {(showClaim || showPause || showResume || showCancel) && (
            <section className="card stream-detail-panel" aria-labelledby="actions-heading">
              <h2 id="actions-heading" className="stream-detail-panel-title">Actions</h2>

              {actionError && (
                <div className="error-banner" role="alert" style={{ marginBottom: "0.75rem" }}>
                  <em className="error-banner__icon" aria-hidden="true">⚠</em>
                  <span>{actionError}</span>
                </div>
              )}

              <div className="action-cell">
                {showClaim && (
                  <button
                    type="button"
                    className="btn-claim"
                    disabled={claimState.status === "pending"}
                    onClick={handleClaim}
                    aria-busy={claimState.status === "pending"}
                  >
                    {claimState.status === "pending" ? (
                      <>
                        <span className="btn-claim__spinner" aria-hidden="true" />
                        Claiming…
                      </>
                    ) : claimState.status === "confirmed" ? (
                      "Claimed ✓"
                    ) : (
                      `Claim ${stream.progress.vestedAmount} ${stream.assetCode}`
                    )}
                  </button>
                )}

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

                {showCancel && (
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={canceling}
                    onClick={handleCancel}
                    aria-busy={canceling}
                  >
                    {canceling ? "Canceling…" : "Cancel Stream"}
                  </button>
                )}
              </div>
            </section>
          )}

          {/* On-chain Metadata */}
          {stream.metadata && Object.keys(stream.metadata).length > 0 && (
            <section className="card stream-detail-panel stream-detail-panel--wide" aria-labelledby="metadata-heading">
              <h2 id="metadata-heading" className="stream-detail-panel-title">On-chain Metadata</h2>
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

          {/* Event Timeline */}
          <section className="card stream-detail-panel stream-detail-panel--wide" aria-labelledby="timeline-heading">
            <h2 id="timeline-heading" className="stream-detail-panel-title">Event Timeline</h2>
            {history.length === 0 ? (
              <div className="activity-empty" role="status">
                <span className="activity-empty-icon" aria-hidden="true">📭</span>
                <p>No events yet.</p>
              </div>
            ) : (
              <ol className="activity-feed" aria-label="Event timeline">
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

          {/* Claim History */}
          <section className="card stream-detail-panel stream-detail-panel--wide" aria-labelledby="claim-heading">
            <h2 id="claim-heading" className="stream-detail-panel-title">Claim History</h2>
            {history.filter((e) => e.eventType === "claimed").length === 0 ? (
              <div className="activity-empty" role="status">
                <span className="activity-empty-icon" aria-hidden="true">💸</span>
                <p>No claims made yet.</p>
              </div>
            ) : (
              <ol className="activity-feed" aria-label="Claim history">
                {history
                  .filter((e) => e.eventType === "claimed")
                  .map((evt) => (
                    <li key={evt.id} className="activity-item">
                      <span className="activity-icon" aria-hidden="true">↓</span>
                      <div className="activity-content">
                        <p className="activity-title">Tokens claimed</p>
                        <div className="activity-meta">
                          <time dateTime={new Date(evt.timestamp * 1000).toISOString()}>
                            {formatTs(evt.timestamp)}
                          </time>
                          {evt.amount != null && (
                            <span>· {evt.amount} {stream.assetCode}</span>
                          )}
                          {evt.actor && (
                            <span>· <CopyableAddress address={evt.actor} truncationMode="end" /></span>
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

          {/* Deep-link */}
          <section className="card stream-detail-panel stream-detail-panel--wide" aria-labelledby="deeplink-heading">
            <h2 id="deeplink-heading" className="stream-detail-panel-title">Share</h2>
            <div className="stream-detail-share">
              <code className="stream-detail-share-url">
                {window.location.href}
              </code>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href);
                  showToast("Link copied to clipboard", "success");
                }}
              >
                Copy Link
              </button>
            </div>
          </section>
        </div>
      )}

      {/* No wallet notice */}
      {!walletAddress && !loading && stream && (
        <div className="wallet-required-notice" style={{ marginTop: "1rem" }}>
          Connect a wallet to see action buttons (claim, cancel, pause/resume).
        </div>
      )}
    </div>
  );
}
