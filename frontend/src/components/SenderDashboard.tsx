import { useEffect, useState, useMemo, useCallback } from "react";
import {
  listStreams,
  cancelStream,
  createStream,
  getSenderEvents,
  StreamEvent,
} from "../services/api";
import { Stream, CreateStreamPayload } from "../types/stream";
import { CreateStreamForm } from "./CreateStreamForm";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface SenderDashboardProps {
  /** Connected wallet address (sender account). When null, user must connect. */
  senderAddress: string | null;
  /** Callback to open the edit start time modal */
  onEditStartTime: (stream: Stream) => void;
  /** Optional callback to trigger wallet reconnect */
  onReconnect?: () => void;
}

export interface SenderDashboardActionError {
  title: string;
  message: string;
  action: "cancel" | "bulk_cancel" | "refresh";
  streamId?: string;
}

/**
 * Returns the CSS class for a stream status badge.
 * @param status - The progress status of the stream.
 * @returns A string containing the CSS classes.
 */
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

/**
 * Returns a color for a stream status in charts
 */
function statusColor(status: Stream["progress"]["status"]): string {
  switch (status) {
    case "active":
      return "#10b981";
    case "scheduled":
      return "#f59e0b";
    case "completed":
      return "#3b82f6";
    case "canceled":
      return "#ef4444";
    case "paused":
      return "#8b5cf6";
    default:
      return "#6b7280";
  }
}

/**
 * Formats a timestamp to a readable date/time string
 */
function formatEventTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Returns a human-readable label for an event type
 */
function getEventLabel(
  eventType: StreamEvent["eventType"],
  amount?: number,
  assetCode?: string
): string {
  switch (eventType) {
    case "created":
      return `Stream created${amount ? ` (${amount} ${assetCode})` : ""}`;
    case "claimed":
      return `Claimed ${amount} ${assetCode}`;
    case "canceled":
      return "Stream canceled";
    case "paused":
      return "Stream paused";
    case "resumed":
      return "Stream resumed";
    case "start_time_updated":
      return "Start time updated";
    default:
      return eventType;
  }
}

/**
 * Dashboard for users who are sending streams.
 * Displays active/scheduled streams, analytics, recent activity, and a creation form.
 *
 * @param props - The component props.
 * @returns The rendered SenderDashboard component.
 */
export function SenderDashboard({
  senderAddress,
  onEditStartTime,
  onReconnect,
}: SenderDashboardProps) {
  const [streams, setStreams] = useState<Stream[]>([]);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRetryingLoad, setIsRetryingLoad] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<SenderDashboardActionError | null>(null);
  const [cancelingStreamId, setCancelingStreamId] = useState<string | null>(null);
  const [isBulkCanceling, setIsBulkCanceling] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [selectedStreamForBulkCancel, setSelectedStreamForBulkCancel] =
    useState<Set<string>>(new Set());

  const loadStreams = useCallback(async (isRetry = false) => {
    if (!senderAddress) {
      setLoading(false);
      setStreams([]);
      setEvents([]);
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

      // Fetch events in background
      setEventsLoading(true);
      const recentEvents = await getSenderEvents(senderAddress);
      setEvents(recentEvents);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load streams.");
    } finally {
      setLoading(false);
      setIsRetryingLoad(false);
      setEventsLoading(false);
    }
  }, [senderAddress]);

  useEffect(() => {
    let active = true;
    loadStreams();

    // Poll every 5 seconds to keep metrics and progress fresh
    const interval = setInterval(async () => {
      if (!senderAddress || !active) return;
      try {
        const result = await listStreams({ sender: senderAddress });
        if (active) {
          setStreams(result.data);

          // Also refresh events
          const recentEvents = await getSenderEvents(senderAddress);
          if (active) {
            setEvents(recentEvents);
          }
        }
      } catch {
        // Silent fail on polling
      }
    }, 5000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [senderAddress, loadStreams]);

  // Compute analytics
  const stats = useMemo(() => {
    const statusCounts: Record<string, number> = {
      active: 0,
      scheduled: 0,
      completed: 0,
      canceled: 0,
      paused: 0,
    };

    let totalAmount = 0;
    const assetAmounts: Record<string, number> = {};

    streams.forEach((stream) => {
      statusCounts[stream.progress.status] =
        (statusCounts[stream.progress.status] || 0) + 1;
      totalAmount += stream.totalAmount;
      assetAmounts[stream.assetCode] =
        (assetAmounts[stream.assetCode] || 0) + stream.totalAmount;
    });

    return {
      totalStreams: streams.length,
      totalAmount,
      assetAmounts,
      statusCounts,
      activeStreams: streams.filter((s) => s.progress.status === "active"),
      scheduledStreams: streams.filter((s) => s.progress.status === "scheduled"),
      completedStreams: streams.filter(
        (s) =>
          s.progress.status === "completed" || s.progress.status === "canceled"
      ),
      pausedStreams: streams.filter((s) => s.progress.status === "paused"),
    };
  }, [streams]);

  // Chart data for streams by status
  const chartData = useMemo(() => {
    const { statusCounts } = stats;
    return [
      { name: "Scheduled", value: statusCounts.scheduled },
      { name: "Active", value: statusCounts.active },
      { name: "Paused", value: statusCounts.paused },
      { name: "Completed", value: statusCounts.completed },
      { name: "Canceled", value: statusCounts.canceled },
    ].filter((item) => item.value > 0);
  }, [stats]);

  /**
   * Handles the creation of a new stream.
   * Ensures the dashboard is refreshed before closing the form.
   * If post-creation refresh fails with a recoverable error, closes form and presents
   * retry without re-submitting creation to avoid duplicate transactions.
   *
   * @param payload - The data for the new stream.
   */
  const handleCreate = async (payload: CreateStreamPayload) => {
    setCreateError(null);
    try {
      await createStream(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create stream.";
      setCreateError(msg);
      throw err;
    }

    // On-chain stream creation succeeded. Close form to prevent duplicate submissions.
    setShowCreateForm(false);

    try {
      const data = await listStreams({ sender: senderAddress! });
      setStreams(data.data);
    } catch (refreshErr) {
      setActionError({
        title: "Refresh Pending",
        message:
          "Stream was created successfully, but refreshing the dashboard failed. Click Retry to view your updated streams.",
        action: "refresh",
      });
    }
  };

  /**
   * Prompts for confirmation and cancels a stream if the user agrees.
   * Prevents duplicate requests with in-flight guards and displays actionable retry on failure.
   *
   * @param id - The unique identifier of the stream to cancel.
   */
  const handleCancel = async (id: string) => {
    if (cancelingStreamId !== null || isBulkCanceling) return;

    if (!window.confirm("Are you sure you want to cancel this stream?"))
      return;

    setCancelingStreamId(id);
    setActionError(null);
    try {
      await cancelStream(id);
      const result = await listStreams({ sender: senderAddress! });
      setStreams(result.data);

      // Refresh events
      const recentEvents = await getSenderEvents(senderAddress!);
      setEvents(recentEvents);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to cancel stream";
      setActionError({
        title: "Cancellation Failed",
        message: msg,
        action: "cancel",
        streamId: id,
      });
    } finally {
      setCancelingStreamId(null);
    }
  };

  /**
   * Handles bulk cancellation of selected streams.
   * Preserves uncancelled / failed streams in the selection set for actionable retry.
   * Prevents duplicate in-flight bulk requests.
   */
  const handleBulkCancel = async () => {
    if (isBulkCanceling || cancelingStreamId !== null) return;

    const selectedIds = Array.from(selectedStreamForBulkCancel);
    if (selectedIds.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to cancel ${selectedIds.length} stream(s)?`
    );
    if (!confirmed) return;

    setIsBulkCanceling(true);
    setActionError(null);

    const failedIds: string[] = [];
    let lastErrorMsg = "";

    for (const id of selectedIds) {
      try {
        await cancelStream(id);
      } catch (err) {
        failedIds.push(id);
        lastErrorMsg = err instanceof Error ? err.message : "Failed to cancel stream";
      }
    }

    try {
      const result = await listStreams({ sender: senderAddress! });
      setStreams(result.data);
      const recentEvents = await getSenderEvents(senderAddress!);
      setEvents(recentEvents);
    } catch (e) {
      // Non-fatal list refresh error
    }

    if (failedIds.length > 0) {
      // Preserve safe input: retain failed IDs in selection for actionable retry
      setSelectedStreamForBulkCancel(new Set(failedIds));
      setActionError({
        title: "Bulk Cancellation Failed",
        message: `${failedIds.length} of ${selectedIds.length} stream(s) could not be canceled: ${lastErrorMsg}`,
        action: "bulk_cancel",
      });
    } else {
      setSelectedStreamForBulkCancel(new Set());
    }

    setIsBulkCanceling(false);
  };

  if (!senderAddress) {
    return (
      <div className="card recipient-dashboard-card">
        <h2 className="recipient-dashboard-title">Sender Dashboard</h2>
        <div className="activity-empty">
          <span className="activity-empty-icon">🔌</span>
          <p>Wallet Not Connected</p>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            Connect your wallet to see streams where you are the sender.
          </p>
          {onReconnect && (
            <button
              type="button"
              className="btn-primary"
              style={{ marginTop: "1rem" }}
              onClick={onReconnect}
            >
              Connect Wallet
            </button>
          )}
        </div>
      </div>
    );
  }

  if (loading && !isRetryingLoad) {
    return (
      <div className="card recipient-dashboard-card">
        <h2 className="recipient-dashboard-title">Sender Dashboard</h2>
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
        <h2 className="recipient-dashboard-title">Sender Dashboard</h2>
        <div className="activity-error" role="alert">
          <span style={{ fontSize: "2rem", display: "block", marginBottom: "0.5rem" }} aria-hidden="true">
            ⚠️
          </span>
          <h3>Dashboard Load Failed</h3>
          <p className="muted">{error}</p>
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", marginTop: "1rem" }}>
            <button
              type="button"
              className="retry-btn"
              onClick={() => void loadStreams(true)}
              disabled={loading || isRetryingLoad}
              aria-busy={loading || isRetryingLoad}
            >
              {loading || isRetryingLoad ? "Retrying…" : "Retry"}
            </button>
            {onReconnect && (
              <button
                type="button"
                className="btn-ghost"
                onClick={onReconnect}
                style={{ padding: "0.4rem 1rem", fontSize: "0.85rem" }}
              >
                Reconnect Wallet
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (streams.length === 0 && !showCreateForm) {
    return (
      <div className="card recipient-dashboard-card">
        <h2 className="recipient-dashboard-title">Sender Dashboard</h2>
        <div className="activity-empty">
          <span className="activity-empty-icon">📤</span>
          <p>No Streams Found</p>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            You have no active or completed streams as a sender yet.
          </p>
          <button
            type="button"
            className="btn-primary"
            style={{ marginTop: "1rem" }}
            onClick={() => setShowCreateForm(true)}
          >
            Create your first stream
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="recipient-dashboard">
      <div className="card recipient-dashboard-card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "0.5rem",
          }}
        >
          <h2
            className="recipient-dashboard-title"
            style={{ marginBottom: 0 }}
          >
            Sender Dashboard
          </h2>
          <button
            type="button"
            className={showCreateForm ? "btn-ghost" : "btn-primary"}
            onClick={() => setShowCreateForm(!showCreateForm)}
          >
            {showCreateForm ? "Back to Dashboard" : "Create Stream"}
          </button>
        </div>
        <p className="muted recipient-dashboard-subtitle">
          View your outgoing streams, analytics, and recent activity.
        </p>

        {actionError && (
          <div className="api-error-box" role="alert" style={{ marginTop: "1rem", marginBottom: "1rem" }}>
            <div className="api-error-box__title">
              <span className="api-error-box__icon" aria-hidden="true">⚠️</span>
              {actionError.title}
            </div>
            <div className="api-error-box__hint">{actionError.message}</div>
            <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
              {actionError.action === "cancel" && actionError.streamId && (
                <button
                  type="button"
                  className="retry-btn"
                  onClick={() => void handleCancel(actionError.streamId!)}
                  disabled={cancelingStreamId !== null || isBulkCanceling}
                  aria-busy={cancelingStreamId === actionError.streamId}
                >
                  {cancelingStreamId === actionError.streamId ? "Retrying…" : "Retry Cancel"}
                </button>
              )}
              {actionError.action === "bulk_cancel" && (
                <button
                  type="button"
                  className="retry-btn"
                  onClick={() => void handleBulkCancel()}
                  disabled={isBulkCanceling || cancelingStreamId !== null}
                  aria-busy={isBulkCanceling}
                >
                  {isBulkCanceling ? "Retrying…" : "Retry Bulk Cancel"}
                </button>
              )}
              {actionError.action === "refresh" && (
                <button
                  type="button"
                  className="retry-btn"
                  onClick={() => void loadStreams(true)}
                  disabled={loading || isRetryingLoad}
                  aria-busy={loading || isRetryingLoad}
                >
                  {loading || isRetryingLoad ? "Retrying…" : "Retry Refresh"}
                </button>
              )}
              <button
                type="button"
                className="btn-ghost"
                style={{ padding: "0.4rem 0.8rem", fontSize: "0.85rem" }}
                onClick={() => setActionError(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {showCreateForm ? (
          <section style={{ marginTop: "1.5rem" }}>
            <CreateStreamForm
              onCreate={handleCreate}
              apiError={createError}
              walletAddress={senderAddress}
            />
          </section>
        ) : (
          <>
            {/* Stats Cards Section */}
            <section className="recipient-dashboard-metrics">
              <article className="metric-card">
                <span>Total Streams Created</span>
                <strong>{stats.totalStreams}</strong>
              </article>
              <article className="metric-card">
                <span>Total Amount Streamed</span>
                <strong>
                  {stats.totalAmount.toLocaleString("en-US", {
                    maximumFractionDigits: 2,
                  })}
                </strong>
              </article>
              <article className="metric-card">
                <span>Active Streams</span>
                <strong>{stats.activeStreams.length}</strong>
              </article>
              <article className="metric-card">
                <span>Completed/Canceled</span>
                <strong>{stats.completedStreams.length}</strong>
              </article>
            </section>

            {/* Asset Breakdown */}
            {Object.entries(stats.assetAmounts).length > 0 && (
              <section className="recipient-dashboard-metrics">
                {Object.entries(stats.assetAmounts).map(([asset, amount]) => (
                  <article className="metric-card" key={asset}>
                    <span>Total {asset}</span>
                    <strong>
                      {Number(amount.toFixed(2)).toLocaleString("en-US")}
                    </strong>
                  </article>
                ))}
              </section>
            )}

            {/* Bar Chart: Streams by Status */}
            {chartData.length > 0 && (
              <section
                className="recipient-dashboard-section"
                style={{ marginTop: "2rem" }}
              >
                <h3 className="recipient-dashboard-section-title">
                  Streams by Status
                </h3>
                <div style={{ width: "100%", height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="value" fill="#3b82f6" radius={[8, 8, 0, 0]}>
                        {chartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={statusColor(
                            (["Scheduled", "Active", "Paused", "Completed", "Canceled"][index] as Stream["progress"]["status"])
                          )} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}

            {/* Quick Action Buttons */}
            {stats.activeStreams.length > 0 && (
              <section
                className="recipient-dashboard-section"
                style={{ marginTop: "2rem" }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: "1rem",
                    alignItems: "center",
                  }}
                >
                  <h3 className="recipient-dashboard-section-title">
                    Quick Actions
                  </h3>
                  {selectedStreamForBulkCancel.size > 0 && (
                    <button
                      type="button"
                      className="btn-primary"
                      style={{
                        backgroundColor: "#ef4444",
                        padding: "0.5rem 1rem",
                        fontSize: "0.875rem",
                        marginLeft: "auto",
                      }}
                      onClick={handleBulkCancel}
                      disabled={isBulkCanceling || cancelingStreamId !== null}
                      aria-busy={isBulkCanceling}
                    >
                      {isBulkCanceling
                        ? `Canceling (${selectedStreamForBulkCancel.size})…`
                        : `Bulk Cancel (${selectedStreamForBulkCancel.size})`}
                    </button>
                  )}
                </div>
              </section>
            )}

            {/* Recent Activity Feed */}
            {events.length > 0 && (
              <section
                className="recipient-dashboard-section"
                style={{ marginTop: "2rem" }}
              >
                <h3 className="recipient-dashboard-section-title">
                  Recent Activity
                </h3>
                <div className="activity-feed">
                  {events.map((event) => (
                    <div
                      key={event.id}
                      className="activity-item"
                      style={{
                        padding: "1rem",
                        borderBottom: "1px solid #e5e7eb",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <p style={{ margin: "0 0 0.25rem 0", fontWeight: 500 }}>
                          {getEventLabel(
                            event.eventType,
                            event.amount,
                            event.metadata?.assetCode
                          )}
                        </p>
                        <p style={{ margin: 0, fontSize: "0.875rem", color: "#6b7280" }}>
                          Stream: {event.streamId.slice(0, 8)}…{event.streamId.slice(-4)}
                        </p>
                      </div>
                      <p
                        style={{
                          margin: 0,
                          fontSize: "0.875rem",
                          color: "#9ca3af",
                          textAlign: "right",
                        }}
                      >
                        {formatEventTime(event.timestamp)}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Active & Scheduled Streams Table */}
            {(stats.activeStreams.length > 0 ||
              stats.scheduledStreams.length > 0) && (
              <section
                className="recipient-dashboard-section"
                style={{ marginTop: "2rem" }}
              >
                <h3 className="recipient-dashboard-section-title">
                  Active & Scheduled
                </h3>
                <div className="table-wrap" style={{ maxHeight: "480px", overflowY: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>
                          <input
                            type="checkbox"
                            checked={
                              selectedStreamForBulkCancel.size ===
                              (stats.activeStreams.length +
                                stats.scheduledStreams.length)
                            }
                            disabled={isBulkCanceling}
                            onChange={(e) => {
                              if (e.target.checked) {
                                const ids = new Set(
                                  [...stats.activeStreams, ...stats.scheduledStreams].map(
                                    (s) => s.id
                                  )
                                );
                                setSelectedStreamForBulkCancel(ids);
                              } else {
                                setSelectedStreamForBulkCancel(new Set());
                              }
                            }}
                            aria-label="Select all streams"
                          />
                        </th>
                        <th>To</th>
                        <th>Asset</th>
                        <th>Total</th>
                        <th>Status</th>
                        <th>Progress</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...stats.scheduledStreams, ...stats.activeStreams].map(
                        (stream) => (
                          <tr key={stream.id}>
                            <td>
                              <input
                                type="checkbox"
                                checked={selectedStreamForBulkCancel.has(
                                  stream.id
                                )}
                                disabled={isBulkCanceling}
                                onChange={(e) => {
                                  const newSet = new Set(
                                    selectedStreamForBulkCancel
                                  );
                                  if (e.target.checked) {
                                    newSet.add(stream.id);
                                  } else {
                                    newSet.delete(stream.id);
                                  }
                                  setSelectedStreamForBulkCancel(newSet);
                                }}
                                aria-label={`Select stream ${stream.id}`}
                              />
                            </td>
                            <td>
                              <span className="truncate-address">
                                {stream.recipient.slice(0, 8)}…
                                {stream.recipient.slice(-4)}
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
                                <strong>
                                  {stream.progress.percentComplete}%
                                </strong>
                              </div>
                              <div
                                className="progress-bar"
                                aria-hidden
                              >
                                <div
                                  style={{
                                    width: `${Math.min(
                                      stream.progress.percentComplete,
                                      100
                                    )}%`,
                                  }}
                                />
                              </div>
                            </td>
                            <td>
                              <div className="action-cell">
                                {stream.progress.status === "scheduled" && (
                                  <button
                                    className="btn-ghost btn-edit"
                                    type="button"
                                    title="Edit start time"
                                    onClick={() => onEditStartTime(stream)}
                                  >
                                    ✏️ Edit
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="btn-ghost"
                                  style={{
                                    color: "var(--color-error)",
                                    padding: "4px 8px",
                                  }}
                                  onClick={() => handleCancel(stream.id)}
                                  disabled={
                                    stream.progress.status === "canceled" ||
                                    cancelingStreamId !== null ||
                                    isBulkCanceling
                                  }
                                  aria-busy={cancelingStreamId === stream.id}
                                >
                                  {cancelingStreamId === stream.id
                                    ? "Canceling…"
                                    : "Cancel"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Completed Streams Table */}
            {stats.completedStreams.length > 0 && (
              <section className="recipient-dashboard-section">
                <h3 className="recipient-dashboard-section-title">History</h3>
                <div className="table-wrap" style={{ maxHeight: "480px", overflowY: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>To</th>
                        <th>Asset</th>
                        <th>Total</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.completedStreams.map((stream) => (
                        <tr key={stream.id}>
                          <td>
                            <span className="truncate-address">
                              {stream.recipient.slice(0, 8)}…
                              {stream.recipient.slice(-4)}
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

