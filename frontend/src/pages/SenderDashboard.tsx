import { useEffect, useRef, useMemo, useState, useCallback } from "react";
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
  const [isRetryingLoad, setIsRetryingLoad] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    stream: Stream;
    action: "pause" | "resume" | "cancel";
  } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // A11Y: refs for modal focus management
  const modalPanelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  // A11Y: live region for status-change announcements (polite, non-interruptive)
  const liveRegionRef = useRef<HTMLDivElement>(null);

  const senderAddress = wallet?.address ?? null;

  // A11Y: Move focus into the modal when it opens; restore focus when it closes.
  useEffect(() => {
    if (confirmAction) {
      // Store the element that triggered the modal so we can return focus to it.
      triggerRef.current = document.activeElement as HTMLElement;
      // Defer so the panel is in the DOM before we focus it.
      setTimeout(() => {
        const panel = modalPanelRef.current;
        if (!panel) return;
        const firstFocusable = panel.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        firstFocusable?.focus();
      }, 0);
    } else {
      // Modal closed — restore focus to the original trigger element.
      triggerRef.current?.focus();
      triggerRef.current = null;
    }
  }, [confirmAction]);

  // A11Y: Escape key closes the modal; focus-trap keeps Tab inside the panel.
  useEffect(() => {
    if (!confirmAction) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setConfirmAction(null);
        setActionError(null);
        return;
      }
      if (e.key !== "Tab") return;
      const panel = modalPanelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [confirmAction]);

  // A11Y: Announce action outcomes to screen readers via the polite live region.
  const announce = useCallback((message: string) => {
    const el = liveRegionRef.current;
    if (!el) return;
    // Clear and re-set so repeated announcements are picked up.
    el.textContent = "";
    requestAnimationFrame(() => {
      el.textContent = message;
    });
  }, []);

  const loadStreams = useCallback(async (isRetry = false) => {
    if (!senderAddress) {
      setLoading(false);
      setStreams([]);
      setError(null);
      return;
    }

    if (isRetry) {
      setIsRetryingLoad(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const result = await listStreams({ sender: senderAddress });
      setStreams(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load streams.");
    } finally {
      setLoading(false);
      setIsRetryingLoad(false);
    }
  }, [senderAddress]);

  useEffect(() => {
    let active = true;
    loadStreams();

    const interval = setInterval(async () => {
      if (!senderAddress || !active) return;
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
  }, [senderAddress, loadStreams]);

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
    setActionError(null);
    try {
      if (action === "pause") await pauseStream(stream.id);
      else if (action === "resume") await resumeStream(stream.id);
      else await cancelStream(stream.id);

      const result = await listStreams({ sender: senderAddress! });
      setStreams(result.data);
      setConfirmAction(null);
      announce(`Stream ${stream.id} ${action}d successfully.`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : `Failed to ${action} stream.`);
      announce(`Failed to ${action} stream. ${err instanceof Error ? err.message : ""}`);
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

  if (loading && !isRetryingLoad) {
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
        <div className="activity-error" role="alert">
          <span style={{ fontSize: "2rem", display: "block", marginBottom: "0.5rem" }} aria-hidden="true">
            ⚠️
          </span>
          <h3>Dashboard Load Failed</h3>
          <p className="muted">{error}</p>
          <button
            type="button"
            className="retry-btn"
            onClick={() => void loadStreams(true)}
            disabled={loading || isRetryingLoad}
            aria-busy={loading || isRetryingLoad}
          >
            {loading || isRetryingLoad ? "Retrying…" : "Retry"}
          </button>
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
        {/* A11Y: Provide full address in aria-label so screen readers announce the complete value */}
        <span
          className="truncate-address"
          title={stream.recipient}
          aria-label={`Recipient: ${stream.recipient}`}
        >
          {stream.recipient.slice(0, 8)}…{stream.recipient.slice(-4)}
        </span>
      </td>
      <td>{stream.assetCode}</td>
      <td className="cell-amount">
        <strong>
          {stream.totalAmount} {stream.assetCode}
        </strong>
      </td>
      <td>
        {/* A11Y: status is text content — readable by SR; badge styling is decorative */}
        <span className={statusClass(stream.progress.status)}>
          {stream.progress.status}
        </span>
      </td>
      <td>
        {/* A11Y: Announce percentage progress as text; visual bar is aria-hidden */}
        <div
          className="progress-copy"
          aria-label={`${stream.progress.percentComplete}% complete`}
        >
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
              aria-label={`Pause stream to ${stream.recipient.slice(0, 8)}…${stream.recipient.slice(-4)}`}
              onClick={() => setConfirmAction({ stream, action: "pause" })}
            >
              Pause
            </button>
          )}
          {stream.progress.status === "paused" && (
            <button
              type="button"
              className="btn-ghost"
              aria-label={`Resume stream to ${stream.recipient.slice(0, 8)}…${stream.recipient.slice(-4)}`}
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
              aria-label={`Cancel stream to ${stream.recipient.slice(0, 8)}…${stream.recipient.slice(-4)}`}
              onClick={() => setConfirmAction({ stream, action: "cancel" })}
            >
              Cancel
            </button>
          )}
        </div>
      </td>
    </tr>
  );

  const renderTable = (title: string, rows: Stream[], tableId: string) => (
    <section
      className="recipient-dashboard-section"
      style={{ marginTop: "2rem" }}
      aria-labelledby={`${tableId}-heading`}
    >
      <h3 id={`${tableId}-heading`} className="recipient-dashboard-section-title">{title}</h3>
      <div
        className="table-wrap"
        style={{
          maxHeight: "480px",
          overflowY: "auto",
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
        }}
      >
        <table aria-labelledby={`${tableId}-heading`}>
          <thead>
            <tr>
              <th scope="col">To</th>
              <th scope="col">Asset</th>
              <th scope="col">Total</th>
              <th scope="col">Status</th>
              <th scope="col">Progress</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>{rows.map(renderStreamRow)}</tbody>
        </table>
      </div>
    </section>
  );

  return (
    <div className="recipient-dashboard">
      {/* A11Y: Polite live region — announces stream action outcomes without interrupting the user */}
      <div
        ref={liveRegionRef}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />
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

      {activeStreams.length > 0 && renderTable("Active", activeStreams, "streams-active")}
      {scheduledStreams.length > 0 && renderTable("Scheduled", scheduledStreams, "streams-scheduled")}
      {completedStreams.length > 0 && renderTable("Completed", completedStreams, "streams-completed")}
      {canceledStreams.length > 0 && renderTable("Canceled", canceledStreams, "streams-canceled")}

      {confirmAction && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setConfirmAction(null);
              setActionError(null);
            }
          }}
        >
          <div
            ref={modalPanelRef}
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
          >
            <div className="modal-header">
              <h3 id="confirm-dialog-title" className="modal-title">
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
                onClick={() => {
                  setConfirmAction(null);
                  setActionError(null);
                }}
              >
                ✕
              </button>
            </div>
            <p className="modal-stream-hint" style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>
              Are you sure you want to {confirmAction.action} stream{" "}
              <strong>#{confirmAction.stream.id}</strong>?
            </p>
            {actionError && (
              <div className="api-error-box" role="alert" style={{ marginBottom: "1rem" }}>
                <div className="api-error-box__title">Action Failed</div>
                <div className="api-error-box__hint">{actionError}</div>
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setConfirmAction(null);
                  setActionError(null);
                }}
                disabled={actionBusy}
              >
                Close
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => runAction(confirmAction.stream, confirmAction.action)}
                disabled={actionBusy}
                aria-busy={actionBusy}
              >
                {actionBusy ? "Working…" : actionError ? "Retry" : "Confirm"}
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
