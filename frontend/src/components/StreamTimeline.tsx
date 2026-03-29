import { useCallback, useEffect, useMemo, useState } from "react";
import { getStreamHistory, listAllEvents, StreamEvent } from "../services/api";

interface StreamTimelineProps {
  streamId?: string;
}

import { CopyableAddress } from "./CopyableAddress";

export type EventType = StreamEvent["eventType"];

export function computeFilteredEvents(
  events: StreamEvent[],
  activeFilters: Set<EventType>,
): StreamEvent[] {
  if (activeFilters.size === 0) return events;
  return events.filter((e) => activeFilters.has(e.eventType));
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

export function clearFilters(): Set<EventType> {
  return new Set();
}

export interface FilterBarProps {
  activeFilters: Set<EventType>;
  onToggle: (type: EventType) => void;
  onClear: () => void;
}

export const FILTER_BUTTONS: Array<{ type: EventType; label: string }> = [
  { type: "created", label: "Created" },
  { type: "claimed", label: "Claimed" },
  { type: "canceled", label: "Canceled" },
  { type: "start_time_updated", label: "Start Time Updated" },
];

export function FilterBar({ activeFilters, onToggle, onClear }: FilterBarProps) {
  return (
    <div className="flex flex-wrap gap-2 items-center p-3 bg-white border border-gray-200 rounded-lg">
      <span className="text-sm font-medium text-gray-700">Filter by:</span>
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
      {activeFilters.size > 0 && (
        <button
          onClick={onClear}
          className="ml-2 px-3 py-1.5 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

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
    default:
      return `Action performed by ${actor}`;
  }
}

export function StreamTimeline({ streamId }: StreamTimelineProps) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [activeFilters, setActiveFilters] = useState<Set<EventType>>(new Set());

  const isGlobalFeed = useMemo(() => !streamId, [streamId]);
  const filteredEvents = useMemo(
    () => computeFilteredEvents(events, activeFilters),
    [events, activeFilters],
  );

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

  if (filteredEvents.length === 0 && activeFilters.size > 0) {
    return (
      <div className="activity-empty">
        <span className="activity-empty-icon" aria-hidden>
          --
        </span>
        <p>No events match the selected filters. Clear filters to see all events.</p>
        <button type="button" className="btn-ghost" onClick={() => setActiveFilters(clearFilters())}>
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
        onClear={() => setActiveFilters(clearFilters())}
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
