import React from "react";

export interface StatsPanelProps {
  total?: number;
  active?: number;
  completed?: number;
  vested?: number;
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  streamsLoading?: boolean;
  className?: string;
  accountId?: string;
}

/**
 * StatsPanel displays aggregate streaming metrics including total streams,
 * active streams, completed streams, and vested amounts with resilient handling
 * for edge states, partial totals, and network failures.
 */
export function StatsPanel({
  total = 0,
  active = 0,
  completed = 0,
  vested = 0,
  loading = false,
  error = null,
  onRetry,
  streamsLoading = false,
  className = "",
  accountId,
}: StatsPanelProps) {
  const safeTotal = Number.isFinite(total) ? Math.max(0, total) : 0;
  const safeActive = Number.isFinite(active) ? Math.max(0, active) : 0;
  const safeCompleted = Number.isFinite(completed) ? Math.max(0, completed) : 0;
  const safeVested = Number.isFinite(vested) ? Math.max(0, vested) : 0;

  const formattedVested = safeVested.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <section
      className={`stats-panel-container ${className}`}
      aria-label="Stream summary metrics"
      data-testid="stats-panel"
    >
      {/* Account ID display if provided, formatted for narrow screen responsiveness */}
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

      {/* Failure State with Retry Action */}
      {error && (
        <div
          className="stats-error-banner"
          role="alert"
          data-testid="stats-error-banner"
        >
          <div className="stats-error-content">
            <span className="stats-error-icon" aria-hidden="true">⚠️</span>
            <div className="stats-error-text">
              <strong>Unable to load live statistics</strong>
              <p>{error.message || "An unexpected error occurred while fetching stats."}</p>
              {streamsLoading && (
                <span className="stats-streams-loading-hint">
                  Streams are still loading in the background…
                </span>
              )}
            </div>
          </div>
          {onRetry && (
            <button
              type="button"
              className="stats-retry-btn"
              onClick={onRetry}
              disabled={loading}
              data-testid="stats-retry-button"
            >
              {loading ? "Retrying…" : "Retry"}
            </button>
          )}
        </div>
      )}

      {/* Metrics Grid */}
      <div className="stats-metric-grid" data-testid="stats-metric-grid">
        <article className="metric-card" data-testid="metric-card-total">
          <span id="metric-total-label">Total Streams</span>
          <strong
            aria-labelledby="metric-total-label"
            data-testid="metric-total-value"
          >
            {loading ? "…" : safeTotal}
          </strong>
        </article>

        <article className="metric-card" data-testid="metric-card-active">
          <span id="metric-active-label">Active</span>
          <strong
            aria-labelledby="metric-active-label"
            data-testid="metric-active-value"
          >
            {loading ? "…" : safeActive}
          </strong>
        </article>

        <article className="metric-card" data-testid="metric-card-completed">
          <span id="metric-completed-label">Completed</span>
          <strong
            aria-labelledby="metric-completed-label"
            data-testid="metric-completed-value"
          >
            {loading ? "…" : safeCompleted}
          </strong>
        </article>

        <article className="metric-card" data-testid="metric-card-vested">
          <span id="metric-vested-label">Total Vested</span>
          <strong
            aria-labelledby="metric-vested-label"
            data-testid="metric-vested-value"
          >
            {loading ? "…" : formattedVested}
          </strong>
        </article>
      </div>
    </section>
  );
}

export default StatsPanel;
