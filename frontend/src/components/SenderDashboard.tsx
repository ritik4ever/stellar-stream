import { useEffect, useState, useMemo, useCallback, useRef } from "react";
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

  // A11Y: Replace window.confirm with accessible modal dialogs.
  // cancelConfirmStreamId: stream awaiting keyboard-accessible cancel confirmation.
  // bulkCancelConfirmPending: bulk cancel awaiting confirmation.
  const [cancelConfirmStreamId, setCancelConfirmStreamId] = useState<string | null>(null);
  const [bulkCancelConfirmPending, setBulkCancelConfirmPending] = useState(false);

  // A11Y: refs for modal focus management and live region announcements
  const cancelModalRef = useRef<HTMLDivElement>(null);
  const cancelTriggerRef = useRef<HTMLElement | null>(null);
  const bulkCancelModalRef = useRef<HTMLDivElement>(null);
  const bulkCancelTriggerRef = useRef<HTMLElement | null>(null);
  const liveRegionRef = useRef<HTMLDivElement>(null);

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

  // A11Y: Generic focus-trap + focus-restore for a modal panel.
  // Opens when `condition` is truthy; focuses first focusable child.
  function useFocusTrap(
    condition: boolean,
    panelRef: React.RefObject<HTMLDivElement | null>,
    triggerRef: React.MutableRefObject<HTMLElement | null>,
    onEscape: () => void
  ) {
    useEffect(() => {
      if (condition) {
        triggerRef.current = document.activeElement as HTMLElement;
        setTimeout(() => {
          const panel = panelRef.current;
          if (!panel) return;
          const first = panel.querySelector<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
          );
          first?.focus();
        }, 0);
      } else {
        triggerRef.current?.focus();
        triggerRef.current = null;
      }
    }, [condition]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
      if (!condition) return;
      const handleKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") { onEscape(); return; }
        if (e.key !== "Tab") return;
        const panel = panelRef.current;
        if (!panel) return;
        const focusable = Array.from(
          panel.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        }
      };
      document.addEventListener("keydown", handleKey);
      return () => document.removeEventListener("keydown", handleKey);
    }, [condition]); // eslint-disable-line react-hooks/exhaustive-deps
  }

  useFocusTrap(
    cancelConfirmStreamId !== null,
    cancelModalRef,
    cancelTriggerRef,
    () => setCancelConfirmStreamId(null)
  );
  useFocusTrap(
    bulkCancelConfirmPending,
    bulkCancelModalRef,
    bulkCancelTriggerRef,
    () => setBulkCancelConfirmPending(false)
  );

  // A11Y: Announce action outcomes to screen readers via the polite live region.
  const announce = useCallback((message: string) => {
    const el = liveRegionRef.current;
    if (!el) return;
    el.textContent = "";
    requestAnimationFrame(() => { el.textContent = message; });
  }, []);

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
   * Opens the accessible cancel confirmation dialog for a single stream.
   * Actual cancellation is performed by confirmCancelStream() after the user confirms.
   *
   * @param id - The unique identifier of the stream to cancel.
   */
  const handleCancel = (id: string) => {
    if (cancelingStreamId !== null || isBulkCanceling) return;
    setCancelConfirmStreamId(id);
  };

  /**
   * Executes the cancel after the user confirms via the accessible modal.
   * Accepts an optional `overrideId` for direct retry (bypasses the confirmation modal).
   * Prevents duplicate requests with in-flight guards and displays actionable retry on failure.
   */
  const confirmCancelStream = async (overrideId?: string) => {
    const id = overrideId ?? cancelConfirmStreamId;
    if (!id) return;
    setCancelConfirmStreamId(null);
    setCancelingStreamId(id);
    setActionError(null);
    try {
      await cancelStream(id);
      const result = await listStreams({ sender: senderAddress! });
      setStreams(result.data);
      // Refresh events
      const recentEvents = await getSenderEvents(senderAddress!);
      setEvents(recentEvents);
      announce(`Stream ${id} canceled successfully.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to cancel stream";
      setActionError({
        title: "Cancellation Failed",
        message: msg,
        action: "cancel",
        streamId: id,
      });
      announce(`Cancellation failed: ${msg}`);
    } finally {
      setCancelingStreamId(null);
    }
  };

  /**
   * Opens the accessible bulk cancel confirmation dialog.
   * Actual cancellation is performed by confirmBulkCancel() after the user confirms.
   */
  const handleBulkCancel = () => {
    if (isBulkCanceling || cancelingStreamId !== null) return;
    if (selectedStreamForBulkCancel.size === 0) return;
    setBulkCancelConfirmPending(true);
  };

  /**
   * Executes bulk cancellation after the user confirms via the accessible modal.
   * Preserves uncancelled / failed streams in the selection set for actionable retry.
   * Prevents duplicate in-flight bulk requests.
   */
  const confirmBulkCancel = async () => {
    setBulkCancelConfirmPending(false);
    const selectedIds = Array.from(selectedStreamForBulkCancel);
    if (selectedIds.length === 0) return;

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
      announce(`Bulk cancel: ${failedIds.length} of ${selectedIds.length} stream(s) could not be canceled.`);
    } else {
      setSelectedStreamForBulkCancel(new Set());
      announce(`All ${selectedIds.length} stream(s) canceled successfully.`);
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
      {/* A11Y: Polite live region — announces stream action outcomes to screen readers without interruption */}
      <div
        ref={liveRegionRef}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />

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
            aria-pressed={showCreateForm}
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
                  onClick={() => void confirmCancelStream(actionError.streamId)}
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
                  onClick={() => void confirmBulkCancel()}
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
            <section
              className="recipient-dashboard-metrics"
              aria-label="Stream summary metrics"
            >
              <article className="metric-card">
                <span id="metric-total-streams">Total Streams Created</span>
                <strong aria-labelledby="metric-total-streams">{stats.totalStreams}</strong>
              </article>
              <article className="metric-card">
                <span id="metric-total-amount">Total Amount Streamed</span>
                <strong aria-labelledby="metric-total-amount">
                  {stats.totalAmount.toLocaleString("en-US", {
                    maximumFractionDigits: 2,
                  })}
                </strong>
              </article>
              <article className="metric-card">
                <span id="metric-active-streams">Active Streams</span>
                <strong aria-labelledby="metric-active-streams">{stats.activeStreams.length}</strong>
              </article>
              <article className="metric-card">
                <span id="metric-completed-streams">Completed/Canceled</span>
                <strong aria-labelledby="metric-completed-streams">{stats.completedStreams.length}</strong>
              </article>
            </section>

            {/* Asset Breakdown */}
            {Object.entries(stats.assetAmounts).length > 0 && (
              <section
                className="recipient-dashboard-metrics"
                aria-label="Asset breakdown"
              >
                {Object.entries(stats.assetAmounts).map(([asset, amount]) => (
                  <article className="metric-card" key={asset}>
                    <span id={`metric-asset-${asset}`}>Total {asset}</span>
                    <strong aria-labelledby={`metric-asset-${asset}`}>
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
                aria-labelledby="chart-heading"
              >
                <h3 id="chart-heading" className="recipient-dashboard-section-title">
                  Streams by Status
                </h3>
                {/* A11Y: Chart is decorative — provide summary text for screen readers */}
                <p className="sr-only">
                  {chartData.map((d) => `${d.name}: ${d.value}`).join(", ")}
                </p>
                <div style={{ width: "100%", height: 300 }} aria-hidden="true">
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
                      aria-label={`Bulk cancel ${selectedStreamForBulkCancel.size} selected stream(s)`}
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
                aria-labelledby="activity-heading"
              >
                <h3 id="activity-heading" className="recipient-dashboard-section-title">
                  Recent Activity
                </h3>
                <div className="activity-feed" role="list">
                  {events.map((event) => (
                    <div
                      key={event.id}
                      className="activity-item"
                      role="listitem"
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
                          Stream:{" "}
                          <span
                            title={event.streamId}
                            aria-label={`Stream ${event.streamId}`}
                          >
                            {event.streamId.slice(0, 8)}…{event.streamId.slice(-4)}
                          </span>
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
                        <time>{formatEventTime(event.timestamp)}</time>
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
                aria-labelledby="active-scheduled-heading"
              >
                <h3 id="active-scheduled-heading" className="recipient-dashboard-section-title">
                  Active &amp; Scheduled
                </h3>
                <div className="table-wrap" style={{ maxHeight: "480px", overflowY: "auto" }}>
                  <table aria-labelledby="active-scheduled-heading">
                    <thead>
                      <tr>
                        <th scope="col">
                          <input
                            type="checkbox"
                            checked={
                              selectedStreamForBulkCancel.size > 0 &&
                              selectedStreamForBulkCancel.size ===
                              (stats.activeStreams.length +
                                stats.scheduledStreams.length)
                            }
                            ref={(el) => {
                              if (el) {
                                // A11Y: indeterminate state for partial selection
                                el.indeterminate =
                                  selectedStreamForBulkCancel.size > 0 &&
                                  selectedStreamForBulkCancel.size <
                                    (stats.activeStreams.length + stats.scheduledStreams.length);
                              }
                            }}
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
                            aria-label={
                              selectedStreamForBulkCancel.size ===
                              (stats.activeStreams.length + stats.scheduledStreams.length)
                                ? "Deselect all streams"
                                : "Select all streams"
                            }
                          />
                        </th>
                        <th scope="col">To</th>
                        <th scope="col">Asset</th>
                        <th scope="col">Total</th>
                        <th scope="col">Status</th>
                        <th scope="col">Progress</th>
                        <th scope="col">Actions</th>
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
                              <span
                                className="truncate-address"
                                title={stream.recipient}
                                aria-label={`Recipient: ${stream.recipient}`}
                              >
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
                              <div
                                className="progress-copy"
                                aria-label={`${stream.progress.percentComplete}% complete`}
                              >
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
                                    aria-label={`Edit start time for stream to ${stream.recipient.slice(0, 8)}…${stream.recipient.slice(-4)}`}
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
                                  aria-label={`Cancel stream to ${stream.recipient.slice(0, 8)}…${stream.recipient.slice(-4)}`}
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
              <section
                className="recipient-dashboard-section"
                aria-labelledby="history-heading"
              >
                <h3 id="history-heading" className="recipient-dashboard-section-title">History</h3>
                <div className="table-wrap" style={{ maxHeight: "480px", overflowY: "auto" }}>
                  <table aria-labelledby="history-heading">
                    <thead>
                      <tr>
                        <th scope="col">To</th>
                        <th scope="col">Asset</th>
                        <th scope="col">Total</th>
                        <th scope="col">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.completedStreams.map((stream) => (
                        <tr key={stream.id}>
                          <td>
                            <span
                              className="truncate-address"
                              title={stream.recipient}
                              aria-label={`Recipient: ${stream.recipient}`}
                            >
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

      {/* A11Y: Accessible cancel confirmation modal — replaces window.confirm */}
      {cancelConfirmStreamId !== null && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCancelConfirmStreamId(null);
          }}
        >
          <div
            ref={cancelModalRef}
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-confirm-title"
          >
            <div className="modal-header">
              <h3 id="cancel-confirm-title" className="modal-title">
                Cancel stream?
              </h3>
              <button
                type="button"
                className="modal-close"
                aria-label="Close cancel confirmation dialog"
                onClick={() => setCancelConfirmStreamId(null)}
              >
                ✕
              </button>
            </div>
            <p className="modal-stream-hint">
              Are you sure you want to cancel stream{" "}
              <strong>#{cancelConfirmStreamId}</strong>? This action cannot be undone.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setCancelConfirmStreamId(null)}
              >
                Keep stream
              </button>
              <button
                type="button"
                className="btn-primary"
                style={{ backgroundColor: "var(--color-error)" }}
                onClick={() => void confirmCancelStream()}
              >
                Yes, cancel stream
              </button>
            </div>
          </div>
        </div>
      )}

      {/* A11Y: Accessible bulk cancel confirmation modal — replaces window.confirm */}
      {bulkCancelConfirmPending && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setBulkCancelConfirmPending(false);
          }}
        >
          <div
            ref={bulkCancelModalRef}
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-cancel-confirm-title"
          >
            <div className="modal-header">
              <h3 id="bulk-cancel-confirm-title" className="modal-title">
                Cancel {selectedStreamForBulkCancel.size} stream(s)?
              </h3>
              <button
                type="button"
                className="modal-close"
                aria-label="Close bulk cancel confirmation dialog"
                onClick={() => setBulkCancelConfirmPending(false)}
              >
                ✕
              </button>
            </div>
            <p className="modal-stream-hint">
              Are you sure you want to cancel{" "}
              <strong>{selectedStreamForBulkCancel.size} selected stream(s)</strong>?
              This action cannot be undone.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setBulkCancelConfirmPending(false)}
              >
                Keep streams
              </button>
              <button
                type="button"
                className="btn-primary"
                style={{ backgroundColor: "var(--color-error)" }}
                onClick={() => void confirmBulkCancel()}
              >
                Yes, cancel {selectedStreamForBulkCancel.size} stream(s)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

