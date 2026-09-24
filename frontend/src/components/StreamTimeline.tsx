import { useCallback, useEffect, useMemo, useState } from "react";
import { getStreamHistory, listAllEvents, StreamEvent } from "../services/api";

interface StreamTimelineProps {
  streamId?: string;
}

import { CopyableAddress } from "./CopyableAddress";

export type EventType = StreamEvent["eventType"];

// ---------------------------------------------------------------------------
// Filter state types
// ---------------------------------------------------------------------------

export interface DateRangeFilter {
  /** ISO date string "YYYY-MM-DD" or empty string */
  from: string;
  /** ISO date string "YYYY-MM-DD" or empty string */
  to: string;
}

export interface TimelineFilters {
  activeEventTypes: Set<EventType>;
  dateRange: DateRangeFilter;
  /** Case-insensitive substring match against event.actor */
  actorSearch: string;
}

export function makeEmptyFilters(): TimelineFilters {
  return {
    activeEventTypes: new Set(),
    dateRange: { from: "", to: "" },
    actorSearch: "",
  };
}

export function hasActiveFilters(filters: TimelineFilters): boolean {
  return (
    filters.activeEventTypes.size > 0 ||
    filters.dateRange.from !== "" ||
    filters.dateRange.to !== "" ||
    filters.actorSearch.trim() !== ""
  );
}

// ---------------------------------------------------------------------------
// Pure filter functions
// ---------------------------------------------------------------------------

export function computeFilteredEvents(
  events: StreamEvent[],
  activeFilters: Set<EventType>,
  dateRange?: DateRangeFilter,
  actorSearch?: string,
): StreamEvent[] {
  let filtered = events;

  // Event type filter
  if (activeFilters.size > 0) {
    filtered = filtered.filter((e) => activeFilters.has(e.eventType));
  }

  // Date range filter — timestamps are unix seconds; compare against midnight UTC boundaries
  if (dateRange?.from) {
    const fromMs = new Date(dateRange.from + "T00:00:00Z").getTime();
    filtered = filtered.filter((e) => e.timestamp * 1000 >= fromMs);
  }
  if (dateRange?.to) {
    // inclusive: include everything up to the end of that day (23:59:59.999 UTC)
    const toMs = new Date(dateRange.to + "T00:00:00Z").getTime() + 86_400_000 - 1;
    filtered = filtered.filter((e) => e.timestamp * 1000 <= toMs);
  }

  // Actor address search — case-insensitive substring
  const trimmedActor = actorSearch?.trim() ?? "";
  if (trimmedActor !== "") {
    const lower = trimmedActor.toLowerCase();
    filtered = filtered.filter(
      (e) => e.actor !== undefined && e.actor.toLowerCase().includes(lower),
    );
  }

  return [...filtered].sort((a, b) => a.timestamp - b.timestamp);
}

export function toggleFilter(prev: Set<EventType>, type: EventType): Set<EventType> {
  const next = new Set(prev);
  if (next.has(type)) {
    next.delete(type);
  } else {
    next.add(type);
  }
  return next;
}

/** @deprecated Use makeEmptyFilters() for the full filter state reset. Kept for backward compatibility. */
export function clearFilters(): Set<EventType> {
  return new Set();
}

// ---------------------------------------------------------------------------
// FilterBar
// ---------------------------------------------------------------------------

export interface FilterBarProps {
  activeFilters: Set<EventType>;
  onToggle: (type: EventType) => void;
  onClear: () => void;
  dateRange: DateRangeFilter;
  onDateRangeChange: (range: DateRangeFilter) => void;
  actorSearch: string;
  onActorSearchChange: (value: string) => void;
}

export const FILTER_BUTTONS: Array<{ type: EventType; label: string }> = [
  { type: "created", label: "Created" },
  { type: "claimed", label: "Claimed" },
  { type: "canceled", label: "Canceled" },
  { type: "start_time_updated", label: "Start Time Updated" },
  { type: "paused", label: "Paused" },
  { type: "resumed", label: "Resumed" },
];

export function FilterBar({
  activeFilters,
  onToggle,
  onClear,
  dateRange,
  onDateRangeChange,
  actorSearch,
  onActorSearchChange,
}: FilterBarProps) {
  const anyFilterActive =
    activeFilters.size > 0 ||
    dateRange.from !== "" ||
    dateRange.to !== "" ||
    actorSearch.trim() !== "";

  return (
    <div className="flex flex-col gap-3 p-3 bg-white border border-gray-200 rounded-lg">
      {/* Row 1: Event type toggle buttons */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-sm font-medium text-gray-700">Event type:</span>
        {FILTER_BUTTONS.map(({ type, label }) => {
          const isActive = activeFilters.has(type);
          return (
            <button
              key={type}
              onClick={() => onToggle(type)}
              aria-pressed={isActive}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                isActive
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Row 2: Date range + actor search */}
      <div className="flex flex-wrap gap-3 items-end">
        {/* Date range — from */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="timeline-date-from"
            className="text-xs font-medium text-gray-600"
          >
            From date
          </label>
          <input
            id="timeline-date-from"
            type="date"
            value={dateRange.from}
            max={dateRange.to || undefined}
            onChange={(e) =>
              onDateRangeChange({ ...dateRange, from: e.target.value })
            }
            className="px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Filter from date"
          />
        </div>

        {/* Date range — to */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="timeline-date-to"
            className="text-xs font-medium text-gray-600"
          >
            To date
          </label>
          <input
            id="timeline-date-to"
            type="date"
            value={dateRange.to}
            min={dateRange.from || undefined}
            onChange={(e) =>
              onDateRangeChange({ ...dateRange, to: e.target.value })
            }
            className="px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Filter to date"
          />
        </div>

        {/* Actor address search */}
        <div className="flex flex-col gap-1 flex-1" style={{ minWidth: "200px" }}>
          <label
            htmlFor="timeline-actor-search"
            className="text-xs font-medium text-gray-600"
          >
            Actor address
          </label>
          <input
            id="timeline-actor-search"
            type="text"
            value={actorSearch}
            onChange={(e) => onActorSearchChange(e.target.value)}
            placeholder="Search by actor address…"
            className="px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Filter by actor address"
          />
        </div>

        {/* Clear all filters button */}
        {anyFilterActive && (
          <button
            onClick={onClear}
            className="px-3 py-1.5 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000 - timestamp);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getEventIcon(eventType: string): string {
  switch (eventType) {
    case "created":            return "🚀";
    case "claimed":            return "💸";
    case "canceled":           return "❌";
    case "start_time_updated": return "🕐";
    case "paused":             return "⏸️";
    case "resumed":            return "▶️";
    default:                   return "📋";
  }
}

function formatEventTitle(eventType: string): string {
  switch (eventType) {
    case "created":
      return "Stream created";
    case "claimed":
      return "Stream claimed";
    case "canceled":
      return "Stream canceled";
    case "start_time_updated":
      return "Start time updated";
    case "paused":
      return "Stream paused";
    case "resumed":
      return "Stream resumed";
    default:
      return "Stream event";
  }
}

function getEventDescription(event: StreamEvent): string {
  const actor = event.actor
    ? `${event.actor.slice(0, 6)}...${event.actor.slice(-4)}`
    : "Unknown";
  switch (event.eventType) {
    case "created":
      return `Initiated by ${actor} for ${event.amount ?? 0} tokens`;
    case "claimed":
      return `Claim of ${event.amount ?? 0} tokens processed by ${actor}`;
    case "canceled":
      return `Closed by ${actor}`;
    case "start_time_updated":
      return `New start time set by ${actor}`;
    case "paused":
      return `Stream paused by ${actor}`;
    case "resumed":
      return `Stream resumed by ${actor}`;
    default:
      return `Action performed by ${actor}`;
  }
}

// ---------------------------------------------------------------------------
// StreamTimeline component
// ---------------------------------------------------------------------------

export function StreamTimeline({ streamId }: StreamTimelineProps) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  // Filter state
  const [activeFilters, setActiveFilters] = useState<Set<EventType>>(new Set());
  const [dateRange, setDateRange] = useState<DateRangeFilter>({ from: "", to: "" });
  const [actorSearch, setActorSearch] = useState<string>("");

  const isGlobalFeed = useMemo(() => !streamId, [streamId]);

  const filteredEvents = useMemo(
    () => computeFilteredEvents(events, activeFilters, dateRange, actorSearch),
    [events, activeFilters, dateRange, actorSearch],
  );

  const anyFilterActive =
    activeFilters.size > 0 ||
    dateRange.from !== "" ||
    dateRange.to !== "" ||
    actorSearch.trim() !== "";

  const handleClearFilters = useCallback(() => {
    setActiveFilters(new Set());
    setDateRange({ from: "", to: "" });
    setActorSearch("");
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = streamId
        ? await getStreamHistory(streamId)
        : await listAllEvents();
      setEvents(data);
      setLastUpdatedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stream history.");
    } finally {
      setLoading(false);
    }
  }, [streamId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  if (loading) {
    return (
      <div className="activity-feed">
        {Array.from({ length: 3 }).map((_, idx) => (
          <div key={`activity-skeleton-${idx}`} className="skeleton skeleton-item" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="activity-error">
        <h3>Unable to load activity</h3>
        <p>{error}</p>
        <button type="button" className="retry-btn" onClick={loadHistory}>
          Try again
        </button>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="activity-empty">
        <span className="activity-empty-icon" aria-hidden>
          --
        </span>
        <p>No activity to show yet.</p>
      </div>
    );
  }

  if (filteredEvents.length === 0 && anyFilterActive) {
    return (
      <div className="activity-empty">
        <span className="activity-empty-icon" aria-hidden>
          --
        </span>
        <p>No events match the selected filters. Clear filters to see all events.</p>
        <button type="button" className="btn-ghost" onClick={handleClearFilters}>
          Clear filters
        </button>
      </div>
    );
  }

  return (
    <div className="activity-feed">
      {isGlobalFeed && (
        <div className="activity-meta" style={{ justifyContent: "space-between" }}>
          <span>
            Latest across all streams
            {lastUpdatedAt ? ` · updated ${timeAgo(Math.floor(lastUpdatedAt / 1000))}` : ""}
          </span>
          <button type="button" className="btn-ghost" onClick={loadHistory}>
            Refresh
          </button>
        </div>
      )}
      <FilterBar
        activeFilters={activeFilters}
        onToggle={(type) => setActiveFilters((prev) => toggleFilter(prev, type))}
        onClear={handleClearFilters}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        actorSearch={actorSearch}
        onActorSearchChange={setActorSearch}
      />
      {filteredEvents.map((event) => (
        <div key={event.id} className="activity-item">
          <div className="activity-icon">{getEventIcon(event.eventType)}</div>
          <div className="activity-content">
            <p className="activity-title">{formatEventTitle(event.eventType)}</p>
            <div className="activity-meta">
              <span>{timeAgo(event.timestamp)}</span>
              {isGlobalFeed && (
                <a href={`#stream-${event.streamId}`} className="muted">
                  Stream {event.streamId}
                </a>
              )}
            </div>
            <div className="muted" style={{ marginTop: "0.35rem" }}>
              {getEventDescription(event)}
            </div>
            {event.actor && (
              <div style={{ marginTop: "0.5rem" }}>
                <CopyableAddress address={event.actor} truncationMode="end" />
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
