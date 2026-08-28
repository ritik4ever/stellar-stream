import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { listStreams } from "../services/api";
import { Stream, StreamStatus } from "../types/stream";

interface SenderAnalyticsProps {
  /** Connected wallet address (sender account). When null, user must connect. */
  senderAddress: string | null;
}

/** Color per stream status used in the status breakdown chart. */
const STATUS_COLORS: Record<StreamStatus, string> = {
  active: "#10b981",
  scheduled: "#f59e0b",
  completed: "#3b82f6",
  canceled: "#ef4444",
  paused: "#8b5cf6",
};

/** Human-readable label per stream status. */
const STATUS_LABELS: Record<StreamStatus, string> = {
  active: "Active",
  scheduled: "Scheduled",
  completed: "Completed",
  canceled: "Canceled",
  paused: "Paused",
};

/** Color palette for the per-asset bar chart. */
const ASSET_PALETTE = [
  "#0ea5a5",
  "#3b82f6",
  "#8b5cf6",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#06b6d4",
  "#f97316",
];

/** Shared dark-friendly tooltip styling (matches StreamMetricsChart). */
const TOOLTIP_STYLE = {
  backgroundColor: "#1f2937",
  border: "1px solid #374151",
  borderRadius: "8px",
  color: "#f9fafb",
};

/** Number of months to include in the monthly volume chart (12 = last 12 months). */
const MONTH_COUNT = 12;

/** Rounds a value to two decimals to avoid floating-point noise in charts. */
function round2(value: number): number {
  return Number(value.toFixed(2));
}

/** Formats an amount with thousands separators (up to 2 decimals). */
function formatAmount(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Shortens a Stellar address for display: first 8 + … + last 4 chars. */
function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 8)}…${address.slice(-4)}`;
}

/** Returns a `YYYY-M` key for a unix-seconds timestamp (used to bucket by month). */
function monthKeyOf(timestampSeconds: number): string {
  const date = new Date(timestampSeconds * 1000);
  return `${date.getFullYear()}-${date.getMonth()}`;
}

/** Formats a month as a short label, e.g. "Aug 26". */
function monthLabelOf(date: Date): string {
  return date.toLocaleString("en-US", { month: "short", year: "2-digit" });
}

export interface MonthlyBucket {
  key: string;
  label: string;
  amount: number;
}

/**
 * Builds the trailing N monthly buckets (current month + previous N-1) and
 * sums each stream's total amount into the bucket of its creation month.
 * Always returns exactly `monthCount` buckets so charts show a full rolling
 * window even when no streams exist in some months.
 *
 * @param streams - Streams to aggregate.
 * @param monthCount - Number of trailing months to cover (defaults to 12).
 * @param now - Reference date (injectable for deterministic tests).
 * @returns Monthly buckets ordered oldest to newest.
 */
export function buildMonthlyBuckets(
  streams: Stream[],
  monthCount: number = MONTH_COUNT,
  now: Date = new Date(),
): MonthlyBucket[] {
  const buckets = Array.from({ length: monthCount }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (monthCount - 1 - index), 1);
    return {
      key: `${date.getFullYear()}-${date.getMonth()}`,
      label: monthLabelOf(date),
      amount: 0,
    };
  });

  streams.forEach((stream) => {
    const bucket = buckets.find((b) => b.key === monthKeyOf(stream.createdAt));
    if (bucket) bucket.amount += stream.totalAmount;
  });

  return buckets;
}

/**
 * Analytics dashboard for senders.
 *
 * Aggregates the connected sender's streams into four views:
 * - Total streamed by asset (bar chart)
 * - Stream status breakdown (pie chart)
 * - Monthly streaming volume over the last 12 months (line chart)
 * - Top recipients by amount received (ranked list)
 *
 * @param props - The component props.
 * @returns The rendered SenderAnalytics component.
 */
export function SenderAnalytics({ senderAddress }: SenderAnalyticsProps) {
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStreams = useCallback(async (address: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await listStreams({ sender: address });
      setStreams(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load streams.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!senderAddress) {
      setStreams([]);
      setError(null);
      setLoading(false);
      return;
    }
    loadStreams(senderAddress);
  }, [senderAddress, loadStreams]);

  const analytics = useMemo(() => {
    const assetTotals = new Map<string, number>();
    const statusCounts = new Map<StreamStatus, number>();
    const recipientTotals = new Map<string, number>();

    const monthly = buildMonthlyBuckets(streams);

    streams.forEach((stream) => {
      const asset = stream.assetCode || "Unknown";
      assetTotals.set(asset, (assetTotals.get(asset) || 0) + stream.totalAmount);
      statusCounts.set(
        stream.progress.status,
        (statusCounts.get(stream.progress.status) || 0) + 1,
      );
      recipientTotals.set(
        stream.recipient,
        (recipientTotals.get(stream.recipient) || 0) + stream.totalAmount,
      );
    });

    const assetData = Array.from(assetTotals.entries())
      .map(([asset, amount]) => ({ asset, amount: round2(amount) }))
      .sort((a, b) => b.amount - a.amount);

    const statusData = Array.from(statusCounts.entries())
      .map(([status, count]) => ({
        name: STATUS_LABELS[status],
        value: count,
        color: STATUS_COLORS[status],
      }))
      .sort((a, b) => b.value - a.value);

    const monthlyData = monthly.map((m) => ({ name: m.label, amount: round2(m.amount) }));

    const recipientData = Array.from(recipientTotals.entries())
      .map(([address, amount]) => ({ address, amount: round2(amount) }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    const totalAmount = round2(streams.reduce((sum, s) => sum + s.totalAmount, 0));
    const activeCount = streams.filter((s) => s.progress.status === "active").length;

    return {
      assetData,
      statusData,
      monthlyData,
      recipientData,
      totalStreams: streams.length,
      totalAmount,
      activeCount,
    };
  }, [streams]);

  if (!senderAddress) {
    return (
      <div className="card recipient-dashboard-card">
        <h2 className="recipient-dashboard-title">Sender Analytics</h2>
        <div className="activity-empty">
          <span className="activity-empty-icon">📊</span>
          <p>Wallet Not Connected</p>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            Connect your wallet to see analytics for your outgoing streams.
          </p>
        </div>
      </div>
    );
  }

  if (loading && streams.length === 0) {
    return (
      <div className="card recipient-dashboard-card">
        <h2 className="recipient-dashboard-title">Sender Analytics</h2>
        <div className="activity-feed">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton skeleton-item" style={{ height: "80px" }} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card recipient-dashboard-card">
        <h2 className="recipient-dashboard-title">Sender Analytics</h2>
        <div className="activity-error">
          <span style={{ fontSize: "2rem", display: "block", marginBottom: "0.5rem" }}>
            ⚠️
          </span>
          <h3>Analytics Load Failed</h3>
          <p className="muted">{error}</p>
          <button
            type="button"
            className="retry-btn"
            onClick={() => loadStreams(senderAddress)}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (streams.length === 0) {
    return (
      <div className="card recipient-dashboard-card">
        <h2 className="recipient-dashboard-title">Sender Analytics</h2>
        <div className="activity-empty">
          <span className="activity-empty-icon">📊</span>
          <p>No Stream Data</p>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            Create your first stream to start seeing analytics here.
          </p>
        </div>
      </div>
    );
  }

  const maxRecipientAmount = Math.max(
    ...analytics.recipientData.map((r) => r.amount),
    1,
  );

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
          <h2 className="recipient-dashboard-title" style={{ marginBottom: 0 }}>
            Sender Analytics
          </h2>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => loadStreams(senderAddress)}
          >
            ↻ Refresh
          </button>
        </div>
        <p className="muted recipient-dashboard-subtitle">
          Overview of your outgoing streams: assets, statuses, monthly volume, and
          top recipients.
        </p>

        <section className="recipient-dashboard-metrics">
          <article className="metric-card">
            <span>Total Streams</span>
            <strong>{analytics.totalStreams}</strong>
          </article>
          <article className="metric-card">
            <span>Total Amount Streamed</span>
            <strong>{formatAmount(analytics.totalAmount)}</strong>
          </article>
          <article className="metric-card">
            <span>Active Streams</span>
            <strong>{analytics.activeCount}</strong>
          </article>
        </section>

        <div className="analytics-grid">
          {/* Total Streamed by Asset */}
          <section className="chart-section">
            <h3 className="chart-section__title">Total Streamed by Asset</h3>
            <div style={{ width: "100%", height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={analytics.assetData}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="asset" />
                  <YAxis />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(value) => formatAmount(Number(value))}
                  />
                  <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                    {analytics.assetData.map((entry, index) => (
                      <Cell
                        key={`asset-${entry.asset}`}
                        fill={ASSET_PALETTE[index % ASSET_PALETTE.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Stream Status Breakdown */}
          <section className="chart-section">
            <h3 className="chart-section__title">Stream Status Breakdown</h3>
            <div style={{ width: "100%", height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={analytics.statusData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius="80%"
                    label
                  >
                    {analytics.statusData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Monthly Streaming Volume */}
          <section className="chart-section">
            <h3 className="chart-section__title">Monthly Streaming Volume</h3>
            <p className="muted" style={{ margin: "-0.75rem 0 1rem" }}>
              Amount streamed per month — last 12 months.
            </p>
            <div style={{ width: "100%", height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={analytics.monthlyData}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(value) => formatAmount(Number(value))}
                  />
                  <Line
                    type="monotone"
                    dataKey="amount"
                    stroke="#0ea5a5"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Top Recipients */}
          <section className="chart-section">
            <h3 className="chart-section__title">Top Recipients</h3>
            {analytics.recipientData.length === 0 ? (
              <p className="muted">No recipient data yet.</p>
            ) : (
              <ul className="analytics-recipients">
                {analytics.recipientData.map((recipient, index) => (
                  <li key={recipient.address} className="analytics-recipient">
                    <div className="analytics-recipient__top">
                      <span className="analytics-recipient__rank">{index + 1}</span>
                      <span className="truncate-address" title={recipient.address}>
                        {truncateAddress(recipient.address)}
                      </span>
                      <strong className="analytics-recipient__amount">
                        {formatAmount(recipient.amount)}
                      </strong>
                    </div>
                    <div className="progress-bar" aria-hidden>
                      <div
                        style={{
                          width: `${Math.max(
                            4,
                            (recipient.amount / maxRecipientAmount) * 100,
                          )}%`,
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
