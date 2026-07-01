import { useEffect, useState, useMemo } from "react";
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
}: SenderDashboardProps) {
  const [streams, setStreams] = useState<Stream[]>([]);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [selectedStreamForBulkCancel, setSelectedStreamForBulkCancel] =
    useState<Set<string>>(new Set());

  useEffect(() => {
    if (!senderAddress) {
      setLoading(false);
      setStreams([]);
      setEvents([]);
      setError(null);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        const result = await listStreams({ sender: senderAddress });
        if (!active) return;
        setStreams(result.data);

        // Fetch events in background
        setEventsLoading(true);
        const recentEvents = await getSenderEvents(senderAddress);
        if (active) {
          setEvents(recentEvents);
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load streams.");
      } finally {
        if (active) {
          setLoading(false);
          setEventsLoading(false);
        }
      }
    };

    load();

    // Poll every 5 seconds to keep metrics and progress fresh
    const interval = setInterval(async () => {
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
  }, [senderAddress]);

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
   *
   * @param payload - The data for the new stream.
   */
  const handleCreate = async (payload: CreateStreamPayload) => {
    setCreateError(null);
    try {
      await createStream(payload);

      setShowCreateForm(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create stream.";
      setCreateError(msg);
      throw err;
    }
  };

  /**
   * Prompts for confirmation and cancels a stream if the user agrees.
   *
   * @param id - The unique identifier of the stream to cancel.
   */
  const handleCancel = async (id: string) => {
    if (!window.confirm("Are you sure you want to cancel this stream?"))
      return;
    try {
      await cancelStream(id);
      const result = await listStreams({ sender: senderAddress! });
      setStreams(result.data);

      // Refresh events
      const recentEvents = await getSenderEvents(senderAddress!);
      setEvents(recentEvents);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to cancel stream");
    }
  };

  /**
   * Handles bulk cancellation of selected streams
   */
  const handleBulkCancel = async () => {
    const selectedIds = Array.from(selectedStreamForBulkCancel);
    if (selectedIds.length === 0) {
      alert("Please select at least one stream to cancel");
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to cancel ${selectedIds.length} stream(s)?`
    );
    if (!confirmed) return;

    try {
      await Promise.all(selectedIds.map((id) => cancelStream(id)));
      const result = await listStreams({ sender: senderAddress! });
      setStreams(result.data);
      setSelectedStreamForBulkCancel(new Set());

      // Refresh events
      const recentEvents = await getSenderEvents(senderAddress!);
      setEvents(recentEvents);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to bulk cancel streams");
    }
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
        </div>
      </div>
    );
  }

  if (loading) {
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
                    >
                      Bulk Cancel ({selectedStreamForBulkCancel.size})
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
                <div className="table-wrap">
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
                                  disabled={stream.progress.status === "canceled"}
                                >
                                  Cancel
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
                <div className="table-wrap">
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

