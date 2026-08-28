import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getStream } from "../services/api";
import { Stream } from "../types/stream";
import { useNow } from "../hooks/useNow";
import { computeLiveProgress } from "../utils/streamClock";
import { formatAmount, formatDuration, truncateAddress } from "../utils/format";

const STATUS_LABELS: Record<Stream["progress"]["status"], string> = {
  active: "Active",
  scheduled: "Scheduled",
  paused: "Paused",
  completed: "Completed",
  canceled: "Canceled",
};

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

/**
 * Public stream view (route: /stream/:streamId).
 *
 * Shows a stream's progress, live vesting clock, and status to anyone with
 * the share link — no wallet required. Sensitive data (full sender/recipient
 * addresses, event history, on-chain metadata) is intentionally not shown.
 */
export function PublicStreamView() {
  const { streamId } = useParams<{ streamId: string }>();
  const [stream, setStream] = useState<Stream | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(1000);

  useEffect(() => {
    if (!streamId) return;
    let active = true;
    setLoading(true);
    setError(null);
    setStream(null);

    getStream(streamId)
      .then((s) => {
        if (active) setStream(s);
      })
      .catch((err: unknown) => {
        if (!active) return;
        const msg = err instanceof Error ? err.message : "Failed to load stream.";
        setError(
          msg.toLowerCase().includes("not found")
            ? "This stream could not be found. It may have been deleted or the link may be wrong."
            : msg,
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [streamId]);

  if (loading) {
    return (
      <div className="card recipient-dashboard-card">
        <h2 className="recipient-dashboard-title">Stream Status</h2>
        <div className="activity-feed">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton skeleton-item" style={{ height: "60px" }} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card recipient-dashboard-card">
        <h2 className="recipient-dashboard-title">Stream Status</h2>
        <div className="activity-error">
          <span style={{ fontSize: "2rem", display: "block", marginBottom: "0.5rem" }}>
            🔍
          </span>
          <h3>Stream Not Found</h3>
          <p className="muted">{error}</p>
          <Link className="btn-ghost" to="/" style={{ display: "inline-block", marginTop: "0.75rem" }}>
            Back to StellarStream
          </Link>
        </div>
      </div>
    );
  }

  if (!stream) return null;

  const live = computeLiveProgress(stream, now);
  const isScheduled = live.status === "scheduled";
  const isLive = live.status === "active";
  const pct = Math.min(100, Math.max(0, live.percentComplete));

  return (
    <div className="card recipient-dashboard-card public-stream">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <h2 className="recipient-dashboard-title" style={{ marginBottom: 0 }}>
          Stream Status
        </h2>
        <span className={statusClass(live.status)}>{STATUS_LABELS[live.status]}</span>
      </div>
      <p className="muted recipient-dashboard-subtitle">
        Live public view — no wallet required.
      </p>

      {/* Progress */}
      <section className="recipient-dashboard-section">
        <div
          className="drawer-progress-header"
          style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}
        >
          <strong className="drawer-progress-pct" style={{ fontSize: "1.6rem" }}>
            {Math.round(pct)}%
          </strong>
          <span className="muted">
            {formatAmount(live.vestedAmount)} / {formatAmount(stream.totalAmount)}{" "}
            {stream.assetCode} vested
          </span>
        </div>
        <div
          className="progress-bar"
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Stream progress"
        >
          <div style={{ width: `${pct}%` }} />
        </div>
      </section>

      {/* Vesting clock */}
      <section className="recipient-dashboard-section public-clock">
        {isScheduled ? (
          <div className="public-clock__row">
            <span className="muted">Starts in</span>
            <strong>{formatDuration(live.remainingSeconds)}</strong>
          </div>
        ) : isLive ? (
          <>
            <div className="public-clock__row">
              <span className="muted">Elapsed</span>
              <strong>{formatDuration(live.elapsedSeconds)}</strong>
            </div>
            <div className="public-clock__row">
              <span className="muted">Remaining</span>
              <strong>{formatDuration(live.remainingSeconds)}</strong>
            </div>
          </>
        ) : (
          <div className="public-clock__row">
            <span className="muted">Stream ended</span>
            <strong>{STATUS_LABELS[live.status]}</strong>
          </div>
        )}
      </section>

      {/* Key metrics */}
      <dl className="drawer-dl">
        <div className="drawer-dl__row">
          <dt>Asset</dt>
          <dd>{stream.assetCode}</dd>
        </div>
        <div className="drawer-dl__row">
          <dt>Total Amount</dt>
          <dd>
            {formatAmount(stream.totalAmount)} {stream.assetCode}
          </dd>
        </div>
        {live.ratePerSecond > 0 && (
          <div className="drawer-dl__row">
            <dt>Rate</dt>
            <dd>
              {formatAmount(live.ratePerSecond)} {stream.assetCode}/s
            </dd>
          </div>
        )}
        <div className="drawer-dl__row">
          <dt>Sender</dt>
          <dd>
            <span className="truncate-address">{truncateAddress(stream.sender)}</span>
          </dd>
        </div>
        <div className="drawer-dl__row">
          <dt>Recipient</dt>
          <dd>
            <span className="truncate-address">{truncateAddress(stream.recipient)}</span>
          </dd>
        </div>
      </dl>

      <footer className="public-stream__footer">
        <span className="muted">
          Live public view ·{" "}
          <Link to="/">Powered by StellarStream</Link>
        </span>
      </footer>
    </div>
  );
}
