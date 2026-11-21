import React, { useState, useMemo } from "react";

export interface StatsPanelProps {
  total?: number;
  active?: number;
  completed?: number;
  vested?: number;
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void | Promise<void>;
  onReconnect?: () => void | Promise<void>;
  streamsLoading?: boolean;
  className?: string;
  accountId?: string;
  onPrimaryAction?: () => void;
  primaryActionLabel?: string;
}

/**
 * StatsPanel displays aggregate streaming metrics including total streams,
 * active streams, completed streams, and vested amounts with resilient handling
 * for edge states, partial totals, keyboard navigation, and screen reader announcements.
 */
export function StatsPanel({
  total = 0,
  active = 0,
  completed = 0,
  vested = 0,
  loading = false,
  error = null,
  onRetry,
  onReconnect,
  streamsLoading = false,
  className = "",
  accountId,
  onPrimaryAction,
  primaryActionLabel,
}: StatsPanelProps) {
  const [isRetrying, setIsRetrying] = useState(false);

  const safeTotal = Number.isFinite(total) ? Math.max(0, total) : 0;
  const safeActive = Number.isFinite(active) ? Math.max(0, active) : 0;
  const safeCompleted = Number.isFinite(completed) ? Math.max(0, completed) : 0;
  const safeVested = Number.isFinite(vested) ? Math.max(0, vested) : 0;

  const isAllZero =
    !loading &&
    !error &&
    safeTotal === 0 &&
    safeActive === 0 &&
    safeCompleted === 0 &&
    safeVested === 0;

  const isPartial =
    !loading &&
    !error &&
    !isAllZero &&
    (safeTotal === 0 || safeActive === 0 || safeCompleted === 0 || safeVested === 0);

  const formattedVested = safeVested.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  // Accessible screen reader announcement without repeated alerts
  const announcement = useMemo(() => {
    if (loading) {
      return "Loading stream statistics…";
    }
    if (error) {
      if (streamsLoading) {
        return "Unable to load live statistics. Streams are still loading in the background.";
      }
      return `Unable to load live statistics: ${error.message || "error occurred"}`;
    }
    if (isAllZero) {
      return "Stream metrics: No stream activity recorded yet. All totals are zero.";
    }
    if (isPartial) {
      return `Stream metrics updated: Partially available totals. Total streams: ${safeTotal}, Active: ${safeActive}, Completed: ${safeCompleted}, Total Vested: ${formattedVested}.`;
    }
    return `Stream metrics ready: ${safeTotal} total streams, ${safeActive} active, ${safeCompleted} completed, ${formattedVested} vested.`;
  }, [loading, error, streamsLoading, isAllZero, isPartial, safeTotal, safeActive, safeCompleted, formattedVested]);

  const handleRetry = async () => {
    if (loading || isRetrying || !onRetry) return;
    setIsRetrying(true);
    try {
      await onRetry();
    } finally {
      setIsRetrying(false);
    }
  };

  const handleReconnect = async () => {
    if (loading || isRetrying) return;
    const action = onReconnect || onRetry;
    if (!action) return;
    setIsRetrying(true);
    try {
      await action();
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <section
      className={`stats-panel-container ${className}`}
      role="region"
      aria-label="Stream summary metrics"
      data-testid="stats-panel"
      data-boundary-state={
        error
          ? streamsLoading
            ? "stats-failed-streams-loading"
            : "stats-failed"
          : isAllZero
          ? "all-zero"
          : isPartial
          ? "partial-totals"
          : "ready"
      }
    >
      {/* Polite Screen Reader Live Region for Status Announcements */}
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="stats-a11y-announcement"
      >
        {announcement}
      </div>

      {/* Account ID display if provided, preserved safely across failure and recovery */}
      {accountId && (
        <div className="stats-account-row" data-testid="stats-account-row">
          <span className="stats-account-label">Account:</span>
          <span
            className="stats-account-value"
            title={accountId}
            data-testid="stats-account-id"
          >
            {accountId}
          </span>
        </div>
      )}

      {/* Boundary state indicators */}
      {isAllZero && (
        <div
          className="stats-boundary-banner stats-boundary-all-zero"
          data-testid="stats-all-zero-state"
          data-boundary-case="all-zero"
        >
          <span
            className="stats-boundary-badge"
            data-testid="boundary-all-zero-badge"
          >
            All-zero activity
          </span>
          <span className="stats-boundary-text">
            No stream activity recorded yet. Totals will populate once streams are initialized.
          </span>
        </div>
      )}

      {isPartial && (
        <div
          className="stats-boundary-banner stats-boundary-partial"
          data-testid="stats-partial-state"
          data-boundary-case="partial-totals"
        >
          <span
            className="stats-boundary-badge stats-boundary-badge-partial"
            data-testid="boundary-partial-badge"
          >
            Partially available totals
          </span>
          <span className="stats-boundary-text">
            Some stream metrics are zero or awaiting contract confirmation.
          </span>
        </div>
      )}

      {/* Failure State with Actionable Recovery Path */}
      {error && (
        <div
          className="stats-error-banner"
          role="alert"
          data-testid="stats-error-banner"
          data-boundary-case={
            streamsLoading ? "stats-failed-streams-loading" : "stats-failed"
          }
        >
          <div className="stats-error-content">
            <span className="stats-error-icon" aria-hidden="true">⚠️</span>
            <div className="stats-error-text">
              <div className="stats-error-header-row">
                <strong>Unable to load live statistics</strong>
                {streamsLoading ? (
                  <span
                    className="stats-boundary-badge stats-boundary-badge-warning"
                    data-testid="boundary-stats-failed-streams-loading"
                  >
                    Streams loading in background
                  </span>
                ) : (
                  <span
                    className="stats-boundary-badge stats-boundary-badge-error"
                    data-testid="boundary-stats-failed"
                  >
                    Stats offline
                  </span>
                )}
              </div>
              <p>{error.message || "An unexpected error occurred while fetching stats."}</p>
              {streamsLoading && (
                <span
                  className="stats-streams-loading-hint"
                  data-testid="stats-streams-loading-hint"
                >
                  Streams are still loading in the background…
                </span>
              )}
            </div>
          </div>
          <div className="stats-recovery-actions" data-testid="stats-recovery-actions">
            {onReconnect && (
              <button
                type="button"
                className="stats-reconnect-btn"
                onClick={handleReconnect}
                disabled={loading || isRetrying}
                aria-busy={loading || isRetrying}
                data-testid="stats-reconnect-button"
              >
                {loading || isRetrying ? "Reconnecting…" : "Reconnect"}
              </button>
            )}
            {onRetry && (
              <button
                type="button"
                className="stats-retry-btn"
                onClick={handleRetry}
                disabled={loading || isRetrying}
                aria-busy={loading || isRetrying}
                data-testid="stats-retry-button"
              >
                {loading || isRetrying
                  ? "Retrying…"
                  : streamsLoading
                  ? "Retry Loading Stats"
                  : "Retry"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Metrics Grid with accessible keyboard navigation and unambiguous field labels */}
      <div
        className="stats-metric-grid"
        data-testid="stats-metric-grid"
        role="region"
        aria-label="Stream summary totals"
      >
        <article
          className="metric-card"
          data-testid="metric-card-total"
          tabIndex={0}
          aria-label={`Total Streams: ${loading ? "Loading" : safeTotal}`}
        >
          <span id="metric-total-label">Total Streams</span>
          <strong
            aria-labelledby="metric-total-label"
            data-testid="metric-total-value"
          >
            {loading ? "…" : safeTotal}
          </strong>
        </article>

        <article
          className="metric-card"
          data-testid="metric-card-active"
          tabIndex={0}
          aria-label={`Active Streams: ${loading ? "Loading" : safeActive}`}
        >
          <span id="metric-active-label">Active</span>
          <strong
            aria-labelledby="metric-active-label"
            data-testid="metric-active-value"
          >
            {loading ? "…" : safeActive}
          </strong>
        </article>

        <article
          className="metric-card"
          data-testid="metric-card-completed"
          tabIndex={0}
          aria-label={`Completed Streams: ${loading ? "Loading" : safeCompleted}`}
        >
          <span id="metric-completed-label">Completed</span>
          <strong
            aria-labelledby="metric-completed-label"
            data-testid="metric-completed-value"
          >
            {loading ? "…" : safeCompleted}
          </strong>
        </article>

        <article
          className="metric-card"
          data-testid="metric-card-vested"
          tabIndex={0}
          aria-label={`Total Vested Amount: ${loading ? "Loading" : formattedVested}`}
        >
          <span id="metric-vested-label">Total Vested</span>
          <strong
            aria-labelledby="metric-vested-label"
            data-testid="metric-vested-value"
          >
            {loading ? "…" : formattedVested}
          </strong>
        </article>
      </div>

      {/* Primary Action Control (Reflects Actual State & Avoids Misleading Ready-to-Act) */}
      {onPrimaryAction && (
        <div className="stats-action-row" data-testid="stats-action-row">
          <button
            type="button"
            className="stats-primary-action-btn"
            data-testid="stats-primary-action-btn"
            onClick={onPrimaryAction}
            disabled={loading || isAllZero}
            aria-disabled={loading || isAllZero}
            title={
              isAllZero
                ? "No streams available to act on"
                : isPartial
                ? "Some totals are zero or pending"
                : undefined
            }
          >
            {isAllZero
              ? "No Streams Available"
              : isPartial
              ? primaryActionLabel || "View Available Streams"
              : primaryActionLabel || "View All Streams"}
          </button>
        </div>
      )}
    </section>
  );
}

export default StatsPanel;
