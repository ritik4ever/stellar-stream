import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFreighter, type FreighterState } from "../hooks/useFreighter";
import { listStreams, pauseStream, resumeStream, cancelStream } from "../services/api";
import { Stream } from "../types/stream";

export interface SenderDashboardPageProps {
  wallet?: FreighterState;
}

/**
 * Sender dashboard page at /my-streams.
 *
 * Requires a connected wallet. Shows all outgoing streams (active, scheduled,
 * completed, canceled), a summary of total streaming / vested / claimed, and
 * quick actions (pause, resume, cancel) per stream.
 */
export function SenderDashboard({ wallet: propWallet }: SenderDashboardPageProps) {
  const walletFromHook = useFreighter();
  const wallet = propWallet || walletFromHook;
  const navigate = useNavigate();

  const [streams, setStreams] = useState<Stream[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    stream: Stream;
    action: "pause" | "resume" | "cancel";
  } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const senderAddress = wallet?.address ?? null;

  useEffect(() => {
    if (!senderAddress) {
      setLoading(false);
      setStreams([]);
      setError(null);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        const result = await listStreams({ sender: senderAddress });
        if (active) setStreams(result.data);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load streams.");
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    load();

    const interval = setInterval(async () => {
      try {
        const result = await listStreams({ sender: senderAddress });
        if (active) setStreams(result.data);
      } catch {
        // Silent fail on polling
      }
    }, 5000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [senderAddress]);

  const summary = useMemo(() => {
    let totalStreaming = 0;
    let totalVested = 0;
    let totalClaimed = 0;

    streams.forEach((stream) => {
      if (stream.progress.status === "active" || stream.progress.status === "scheduled") {
        totalStreaming += stream.totalAmount;
      }
      totalVested += stream.progress.vestedAmount;
      if (stream.progress.status === "completed") {
        totalClaimed += stream.progress.vestedAmount;
      }
    });

    return { totalStreaming, totalVested, totalClaimed };
  }, [streams]);

  const activeStreams = useMemo(
    () => streams.filter((s) => s.progress.status === "active"),
    [streams]
  );
  const scheduledStreams = useMemo(
    () => streams.filter((s) => s.progress.status === "scheduled"),
    [streams]
  );
  const completedStreams = useMemo(
    () => streams.filter((s) => s.progress.status === "completed"),
    [streams]
  );
  const canceledStreams = useMemo(
    () => streams.filter((s) => s.progress.status === "canceled"),
    [streams]
  );

  const runAction = async (stream: Stream, action: "pause" | "resume" | "cancel") => {
    setActionBusy(true);
    try {
      if (action === "pause") await pauseStream(stream.id);
      else if (action === "resume") await resumeStream(stream.id);
      else await cancelStream(stream.id);

      const result = await listStreams({ sender: senderAddress! });
      setStreams(result.data);
      setConfirmAction(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} stream.`);
    } finally {
      setActionBusy(false);
    }
  };

  if (!senderAddress) {
    return (
      <div className="card recipient-dashboard-card">
        <h2 className="recipient-dashboard-title">My Streams</h2>
        <div className="activity-empty">
          <span className="activity-empty-icon">🔌</span>
          <p>Wallet Not Connected</p>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            Connect your wallet to view your outgoing streams.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="card recipient-dashboard-card">
        <h2 className="recipient-dashboard-title">My Streams</h2>
        <div className="activity-feed">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="skeleton skeleton-item"
              style={{ height: "80px" }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card recipient-dashboard-card">
        <h2 className="recipient-dashboard-title">My Streams</h2>
        <div className="activity-error">
          <span style={{ fontSize: "2rem", display: "block", marginBottom: "0.5rem" }}>
            ⚠️
          </span>
          <h3>Dashboard Load Failed</h3>
          <p className="muted">{error}</p>
        </div>
      </div>
    );
  }

  if (streams.length === 0) {
    return (
      <div className="card recipient-dashboard-card">
        <h2 className="recipient-dashboard-title">My Streams</h2>
        <div className="activity-empty">
          <span className="activity-empty-icon">📤</span>
          <p>No Streams Found</p>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            You haven't created any streams yet.
          </p>
          <button
            type="button"
            className="btn-primary"
            style={{ marginTop: "1rem" }}
            onClick={() => navigate("/")}
          >
            Create a Stream
          </button>
        </div>
      </div>
    );
  }

  const renderStreamRow = (stream: Stream) => (
    <tr key={stream.id}>
      <td>
        <span className="truncate-address">
          {stream.recipient.slice(0, 8)}…{stream.recipient.slice(-4)}
        </span>
      </td>
      <td>{stream.assetCode}</td>
      <td>
        <strong>
          {stream.totalAmount} {stream.assetCode}
        </strong>
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
        <div className="action-cell">
          {stream.progress.status === "active" && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setConfirmAction({ stream, action: "pause" })}
            >
              Pause
            </button>
          )}
          {stream.progress.status === "paused" && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setConfirmAction({ stream, action: "resume" })}
            >
              Resume
            </button>
          )}
          {(stream.progress.status === "active" ||
            stream.progress.status === "paused" ||
            stream.progress.status === "scheduled") && (
            <button
              type="button"
              className="btn-ghost"
              style={{ color: "var(--color-error)" }}
              onClick={() => setConfirmAction({ stream, action: "cancel" })}
            >
              Cancel
            </button>
          )}
        </div>
      </td>
    </tr>
  );

  const renderTable = (title: string, rows: Stream[]) => (
    <section className="recipient-dashboard-section" style={{ marginTop: "2rem" }}>
      <h3 className="recipient-dashboard-section-title">{title}</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>To</th>
              <th>Asset</th>
              <th>Total</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>{rows.map(renderStreamRow)}</tbody>
        </table>
      </div>
    </section>
  );

  return (
    <div className="recipient-dashboard">
      <div className="card recipient-dashboard-card">
        <h2 className="recipient-dashboard-title">My Streams</h2>
        <p className="muted recipient-dashboard-subtitle">
          View all your outgoing streams and manage them.
        </p>

        <section className="recipient-dashboard-metrics">
          <article className="metric-card">
            <span>Total Streaming</span>
            <strong>{summary.totalStreaming.toLocaleString()}</strong>
          </article>
          <article className="metric-card">
            <span>Total Vested</span>
            <strong>{summary.totalVested.toLocaleString()}</strong>
          </article>
          <article className="metric-card">
            <span>Total Claimed</span>
            <strong>{summary.totalClaimed.toLocaleString()}</strong>
          </article>
        </section>
      </div>

      {activeStreams.length > 0 && renderTable("Active", activeStreams)}
      {scheduledStreams.length > 0 && renderTable("Scheduled", scheduledStreams)}
      {completedStreams.length > 0 && renderTable("Completed", completedStreams)}
      {canceledStreams.length > 0 && renderTable("Canceled", canceledStreams)}

      {confirmAction && (
        <div
          className="modal-backdrop"
          aria-hidden="false"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmAction(null);
          }}
        >
          <div className="modal-panel" role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3 className="modal-title">
                {confirmAction.action === "pause"
                  ? "Pause stream?"
                  : confirmAction.action === "resume"
                    ? "Resume stream?"
                    : "Cancel stream?"}
              </h3>
              <button
                type="button"
                className="modal-close"
                aria-label="Close confirmation dialog"
                onClick={() => setConfirmAction(null)}
              >
                ✕
              </button>
            </div>
            <p className="modal-stream-hint">
              Are you sure you want to {confirmAction.action} stream{" "}
              <strong>#{confirmAction.stream.id}</strong>?
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setConfirmAction(null)}
                disabled={actionBusy}
              >
                Close
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => runAction(confirmAction.stream, confirmAction.action)}
                disabled={actionBusy}
              >
                {actionBusy ? "Working…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function statusClass(status: Stream["progress"]["status"]): string {
  switch (status) {
    case "active":
      return "badge badge-active";
    case "scheduled":
      return "badge badge-scheduled";
    case "completed":
      return "badge badge-completed";
    case "canceled":
      return "badge badge-canceled";
    case "paused":
      return "badge badge-paused";
    default:
      return "badge";
  }
}
