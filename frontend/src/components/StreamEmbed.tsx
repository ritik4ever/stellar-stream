import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
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
 * Standalone embed widget (route: /embed/:streamId).
 *
 * Designed to be rendered inside a third-party cross-origin iframe
 * (e.g. 300x200): it is fully self-contained, never touches
 * `window.parent`, and shows only public information (progress, vesting
 * clock, status, truncated addresses). Served by the frontend origin
 * without frame-blocking headers so embedding works cross-origin.
 */
export function StreamEmbed() {
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
        setError(
          err instanceof Error ? err.message : "Failed to load stream.",
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
      <div className="stream-embed" aria-busy="true" aria-label="Loading stream">
        <span className="skeleton" style={{ height: "0.9rem", width: "60%" }} />
        <span className="skeleton" style={{ height: "7px", width: "100%" }} />
        <span className="skeleton" style={{ height: "0.8rem", width: "80%" }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="stream-embed stream-embed--error" role="alert">
        <span aria-hidden="true">⚠️</span>
        <p>Stream unavailable</p>
        <span className="muted">{error}</span>
      </div>
    );
  }

  if (!stream) return null;

  const live = computeLiveProgress(stream, now);
  const pct = Math.min(100, Math.max(0, live.percentComplete));
  const isScheduled = live.status === "scheduled";
  const isLive = live.status === "active";

  return (
    <div className="stream-embed" aria-label={`Stream ${streamId} status`}>
      <header className="stream-embed__header">
        <span className="stream-embed__brand">StellarStream</span>
        <span className={statusClass(live.status)}>{STATUS_LABELS[live.status]}</span>
      </header>

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

      <div className="stream-embed__percent">
        <strong>{Math.round(pct)}%</strong>
        <span className="muted">
          {formatAmount(live.vestedAmount)} / {formatAmount(stream.totalAmount)}{" "}
          {stream.assetCode}
        </span>
      </div>

      <div className="stream-embed__clock">
        {isScheduled ? (
          <>
            <span className="muted">Starts in</span>
            <strong>{formatDuration(live.remainingSeconds)}</strong>
          </>
        ) : isLive ? (
          <>
            <span className="muted">Remaining</span>
            <strong>{formatDuration(live.remainingSeconds)}</strong>
          </>
        ) : (
          <span className="muted">Status: {STATUS_LABELS[live.status]}</span>
        )}
      </div>

      <footer className="stream-embed__footer">
        <span className="truncate-address" title={`Sender ${truncateAddress(stream.sender)}`}>
          {truncateAddress(stream.sender)}
        </span>
        <span aria-hidden="true">→</span>
        <span className="truncate-address" title={`Recipient ${truncateAddress(stream.recipient)}`}>
          {truncateAddress(stream.recipient)}
        </span>
      </footer>
    </div>
  );
}
