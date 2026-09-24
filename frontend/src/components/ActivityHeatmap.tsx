import { useEffect, useMemo, useRef, useState } from "react";
import { listAllEvents, StreamEvent } from "../services/api";

// Event types counted as "activity" on the heatmap. Other event types
// (pauses, resumes, start-time updates, etc.) do not contribute.
const ACTIVITY_EVENT_TYPES: ReadonlySet<StreamEvent["eventType"]> = new Set([
  "created",
  "claimed",
  "canceled",
]);

interface ActivityHeatmapProps {
  /**
   * Optional pre-fetched events. When omitted the component fetches all events
   * from the API via `listAllEvents()`.
   */
  events?: StreamEvent[];
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
}

interface HeatmapDay {
  date: Date;
  key: string; // yyyy-mm-dd
  count: number;
  isFuture: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKS = 52; // last 12 months ≈ 52 weeks
const TOTAL_DAYS = WEEKS * 7;
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Format a date as yyyy-mm-dd (local time) for stable keys and lookups. */
function toKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDayLabel(date: Date): string {
  return date.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Map a daily count to a 0–4 intensity level. Level 0 (gray) is used for empty
 * days; higher levels scale against the per-day max so the busiest day always
 * renders darkest.
 */
function colorLevel(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  const ratio = count / max;
  if (ratio >= 0.75) return 4;
  if (ratio >= 0.5) return 3;
  if (ratio >= 0.25) return 2;
  return 1;
}

// Background colors by intensity level.
const LEVEL_COLORS: readonly string[] = [
  "#e5e7eb", // level 0 — gray / empty day
  "#dbeafe", // level 1 — faint blue
  "#93c5fd", // level 2 — light blue
  "#3b82f6", // level 3 — medium blue
  "#1e3a8a", // level 4 — darkest blue
];

export function ActivityHeatmap({
  events: eventsProp,
  loading: loadingProp,
  error: errorProp,
  onRetry,
}: ActivityHeatmapProps) {
  const [fetchedEvents, setFetchedEvents] = useState<StreamEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [hoveredDay, setHoveredDay] = useState<HeatmapDay | null>(null);
  const [hoverPosition, setHoverPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (eventsProp) {
      setLoading(false);
      return;
    }
    let mounted = true;
    setLoading(true);
    setError(null);
    listAllEvents()
      .then((data) => {
        if (mounted) setFetchedEvents(data);
      })
      .catch((err) => {
        if (mounted) setError(err instanceof Error ? err : new Error("Failed to load activity."));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [eventsProp]);

  const handleRetry = () => {
    if (eventsProp) return;
    setError(null);
    setLoading(true);
    listAllEvents()
      .then(setFetchedEvents)
      .catch((err) => setError(err instanceof Error ? err : new Error("Failed to load activity.")))
      .finally(() => setLoading(false));
  };

  const events: StreamEvent[] = eventsProp ?? fetchedEvents;
  const isLoading = loadingProp ?? loading;
  const hasError = errorProp ?? error;

  const { cells, maxCount } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today.getTime() - (TOTAL_DAYS - 1) * DAY_MS);
    const now = Date.now();

    // Tally events by day, counting only activity event types.
    const counts = new Map<string, number>();
    let max = 0;
    for (const event of events) {
      if (!ACTIVITY_EVENT_TYPES.has(event.eventType)) continue;
      const key = toKey(new Date(event.timestamp * 1000));
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      if (next > max) max = next;
    }

    const out: HeatmapDay[] = [];
    for (let i = 0; i < TOTAL_DAYS; i++) {
      const date = new Date(start.getTime() + i * DAY_MS);
      const key = toKey(date);
      out.push({
        date,
        key,
        isFuture: date.getTime() > now,
        count: counts.get(key) ?? 0,
      });
    }
    return { cells: out, maxCount: max };
  }, [events]);

  // Group cells into week columns (7 days each).
  const weeks = useMemo(() => {
    const cols: HeatmapDay[][] = [];
    for (let w = 0; w < WEEKS; w++) cols.push(cells.slice(w * 7, w * 7 + 7));
    return cols;
  }, [cells]);

  // Month label for the column in which each new month first appears.
  const monthLabels = useMemo(() => {
    const labels: { col: number; label: string }[] = [];
    let prevMonth = -1;
    cells.forEach((cell, idx) => {
      if (cell.date.getMonth() !== prevMonth) {
        labels.push({ col: Math.floor(idx / 7), label: MONTH_LABELS[cell.date.getMonth()] });
        prevMonth = cell.date.getMonth();
      }
    });
    return labels;
  }, [cells]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHoverPosition({ top: e.clientY - rect.top, left: e.clientX - rect.left });
  };

  const hideTooltip = () => {
    setHoveredDay(null);
    setHoverPosition(null);
  };

  if (isLoading) {
    return (
      <div className="chart-empty-state" aria-busy="true" aria-live="polite">
        <p>Loading activity…</p>
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="chart-empty-state" role="alert">
        <p>{hasError.message || "Failed to load activity."}</p>
        <button type="button" className="retry-btn" onClick={onRetry ?? handleRetry}>
          Try again
        </button>
      </div>
    );
  }

  const activityCount = events.filter((e) => ACTIVITY_EVENT_TYPES.has(e.eventType)).length;

  return (
    <div ref={containerRef} className="activity-heatmap" style={{ padding: "0.5rem", position: "relative" }}>
      <div style={{ display: "flex", gap: "2px", position: "relative" }} onMouseLeave={hideTooltip}>
        {/* Month label row aligned above each week column */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "2px",
          }}
        >
          {Array.from({ length: 7 }, (_, row) => (
            <span
              key={`day-label-${row}`}
              aria-hidden="true"
              style={{ height: 13, fontSize: 10, lineHeight: "13px", color: "#9ca3af" }}
            >
              {row === 1 ? "Mo" : row === 3 ? "We" : row === 5 ? "Fr" : ""}
            </span>
          ))}
        </div>

        <div style={{ position: "relative", flex: 1 }}>
          {/* Month label row */}
          <div
            aria-hidden="true"
            style={{
              display: "flex",
              gap: "2px",
              height: 14,
              marginBottom: 2,
            }}
          >
            {Array.from({ length: WEEKS }, (_, col) => {
              const match = monthLabels.find((m) => m.col === col);
              return (
                <div
                  key={col}
                  style={{
                    flex: 1,
                    fontSize: 10,
                    color: "#9ca3af",
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                  }}
                >
                  {match ? match.label : ""}
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: "2px" }}>
            {weeks.map((week, col) => (
              <div
                key={`week-${col}`}
                style={{ display: "flex", flexDirection: "column", gap: "2px", flex: 1 }}
              >
                {week.map((day) => {
                  const level = colorLevel(day.count, maxCount);
                  return (
                    <div
                      key={day.key}
                      role="img"
                      aria-label={
                        day.isFuture
                          ? `${formatDayLabel(day.date)} (upcoming)`
                          : day.count > 0
                            ? `${formatDayLabel(day.date)}: ${day.count} stream event${day.count === 1 ? "" : "s"}`
                            : `${formatDayLabel(day.date)}: no activity`
                      }
                      title={
                        day.isFuture
                          ? formatDayLabel(day.date)
                          : day.count > 0
                            ? `${formatDayLabel(day.date)} — ${day.count} event${day.count === 1 ? "" : "s"}`
                            : `${formatDayLabel(day.date)} — no activity`
                      }
                      onMouseMove={handleMouseMove}
                      onMouseEnter={() => setHoveredDay(day)}
                      style={{
                        backgroundColor: day.isFuture ? "transparent" : LEVEL_COLORS[level],
                        width: "100%",
                        aspectRatio: "1 / 1",
                        borderRadius: "2px",
                        minHeight: 11,
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tooltip */}
      {hoveredDay && hoverPosition && (
        <div
          role="tooltip"
          style={{
            position: "absolute",
            top: hoverPosition.top + 14,
            left: hoverPosition.left + 14,
            backgroundColor: "#1f2937",
            color: "#f9fafb",
            border: "1px solid #374151",
            borderRadius: "6px",
            padding: "0.25rem 0.5rem",
            fontSize: "12px",
            pointerEvents: "none",
            zIndex: 10,
            whiteSpace: "nowrap",
          }}
        >
          <strong>{formatDayLabel(hoveredDay.date)}</strong>
          <div>
            {hoveredDay.count > 0
              ? `${hoveredDay.count} stream event${hoveredDay.count === 1 ? "" : "s"}`
              : "No activity"}
          </div>
        </div>
      )}

      {/* Legend */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.4rem",
          marginTop: "0.75rem",
          fontSize: "12px",
        }}
      >
        <span style={{ color: "#9ca3af" }}>Less</span>
        {LEVEL_COLORS.map((color) => (
          <span
            key={color}
            aria-hidden="true"
            style={{ width: 12, height: 12, backgroundColor: color, borderRadius: 2, display: "inline-block" }}
          />
        ))}
        <span style={{ color: "#9ca3af" }}>More</span>
        <span style={{ color: "#9ca3af", marginLeft: "auto" }}>
          {activityCount} activity event{activityCount === 1 ? "" : "s"} in the last 12 months
        </span>
      </div>
    </div>
  );
}