import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMemo, useState } from "react";
import type { Stream } from "../types/stream";

interface VestingChartProps {
  stream: Stream | null;
  now?: number;
  loading?: boolean;
  error?: Error | null;
}

interface VestingPoint {
  t: number;
  label: string;
  past: number | null;
  future: number | null;
}

const RANGE_PRESETS = [
  { key: "all", label: "All", pct: 1 },
  { key: "half", label: "50%", pct: 0.5 },
  { key: "quarter", label: "25%", pct: 0.25 },
] as const;

type RangeKey = (typeof RANGE_PRESETS)[number]["key"];

const DEFAULT_POINTS = 30;

function formatDate(timestampSeconds: number): string {
  return new Date(timestampSeconds * 1000).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function endTime(stream: Stream): number {
  return stream.startAt + stream.durationSeconds + (stream.pausedDuration ?? 0);
}

export function vestedAt(stream: Stream, atSeconds: number): number {
  const pausedAt = stream.pausedAt;
  const effectiveAt = pausedAt !== undefined && atSeconds > pausedAt ? pausedAt : atSeconds;
  const elapsed = Math.max(0, Math.max(0, effectiveAt - stream.startAt) - (stream.pausedDuration ?? 0));
  const ratio = stream.durationSeconds <= 0 ? 1 : Math.min(1, elapsed / stream.durationSeconds);
  return round2(stream.totalAmount * ratio);
}

export function buildVestingData(stream: Stream, now: number): VestingPoint[] {
  const start = stream.startAt;
  const end = endTime(stream);
  const clampedNow = Math.min(Math.max(now, start), end);
  const canceled = stream.canceledAt !== undefined;
  const hasFuture = !canceled && clampedNow < end;
  const anchored = stream.progress.vestedAmount;

  const timeline = new Set<number>([start, end, clampedNow]);
  if (end > start) {
    for (let i = 0; i <= DEFAULT_POINTS; i++) {
      timeline.add(start + ((end - start) * i) / DEFAULT_POINTS);
    }
  }

  return Array.from(timeline)
    .sort((a, b) => a - b)
    .map((t) => {
      const isNow = t === clampedNow;
      const past = t <= clampedNow ? (isNow ? anchored : vestedAt(stream, t)) : null;
      const future = hasFuture && t >= clampedNow ? (isNow ? anchored : vestedAt(stream, t)) : null;
      return { t, label: formatDate(t), past, future };
    });
}

export function VestingChart({
  stream,
  now = Math.floor(Date.now() / 1000),
  loading = false,
  error = null,
}: VestingChartProps) {
  const [rangeKey, setRangeKey] = useState<RangeKey>("all");

  const data = useMemo(() => (stream ? buildVestingData(stream, now) : []), [stream, now]);

  const hasFutureData = data.some((p) => p.future !== null);

  const visibleData = useMemo(() => {
    if (!stream || data.length === 0) return [];
    const preset = RANGE_PRESETS.find((p) => p.key === rangeKey) ?? RANGE_PRESETS[0];
    const windowEnd = stream.startAt + (endTime(stream) - stream.startAt) * preset.pct;
    return data.filter((p) => p.t <= windowEnd);
  }, [data, stream, rangeKey]);

  const durationTotal = stream ? endTime(stream) - stream.startAt : 0;
  const cliffSeconds =
    stream && stream.cliffSeconds != null && stream.cliffSeconds > 0 && stream.cliffSeconds < durationTotal
      ? stream.cliffSeconds
      : null;
  const cliffTs = stream && cliffSeconds != null ? stream.startAt + cliffSeconds : null;

  if (loading) {
    return (
      <div className="chart-empty-state" aria-live="polite" aria-busy="true">
        <div className="chart-empty-state__content">
          <span className="chart-empty-state__icon">⏳</span>
          <h3>Loading Chart Data</h3>
          <p>Fetching vesting schedule…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="chart-empty-state" role="alert">
        <div className="chart-empty-state__content">
          <span className="chart-empty-state__icon">⚠️</span>
          <h3>Failed to Load Chart</h3>
          <p>{error.message || "An error occurred while fetching the vesting schedule."}</p>
        </div>
      </div>
    );
  }

  if (!stream) {
    return (
      <div className="chart-empty-state">
        <div className="chart-empty-state__content">
          <span className="chart-empty-state__icon">📊</span>
          <h3>No Chart Data Yet</h3>
          <p>Select a stream to see its vesting schedule.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="chart-container">
      <div
        className="chart-header"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem",
        }}
      >
        <div style={{ color: "#9ca3af", fontSize: "0.875rem" }}>Cumulative vested over time</div>
        <div role="group" aria-label="Time range" style={{ display: "flex", gap: "0.5rem" }}>
          {RANGE_PRESETS.map((preset) => (
            <button
              key={preset.key}
              onClick={() => setRangeKey(preset.key)}
              style={{
                padding: "0.25rem 0.5rem",
                backgroundColor: rangeKey === preset.key ? "#3b82f6" : "#374151",
                color: "#f9fafb",
                borderRadius: "0.25rem",
                fontSize: "0.875rem",
                border: "none",
                cursor: "pointer",
              }}
              aria-pressed={rangeKey === preset.key}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={visibleData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
          <XAxis
            dataKey="label"
            stroke="#9ca3af"
            tick={{ fill: "#9ca3af", fontSize: 12 }}
            tickLine={{ stroke: "#4b5563" }}
            interval="preserveStartEnd"
          />
          <YAxis
            stroke="#9ca3af"
            tick={{ fill: "#9ca3af", fontSize: 12 }}
            tickLine={{ stroke: "#4b5563" }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1f2937",
              border: "1px solid #374151",
              borderRadius: "8px",
              color: "#f9fafb",
            }}
            labelStyle={{ color: "#d1d5db" }}
          />
          <Legend wrapperStyle={{ color: "#d1d5db", fontSize: 14 }} iconType="line" />
          <Line
            type="monotone"
            dataKey="past"
            name="Vested (past)"
            stroke="#8b5cf6"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          {hasFutureData && (
            <Line
              type="monotone"
              dataKey="future"
              name="Projection"
              stroke="#10b981"
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}
          {cliffTs != null && (
            <ReferenceLine
              x={formatDate(cliffTs)}
              stroke="#f59e0b"
              strokeDasharray="4 4"
              label={{ value: "Cliff", fill: "#f59e0b", fontSize: 12, position: "top" }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}