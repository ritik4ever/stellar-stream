import { useEffect, useState, useCallback } from "react";
import { getStreamHistory, listAllEvents, StreamEvent } from "../services/api";
import { CopyableAddress } from "./CopyableAddress";

interface StreamTimelineProps {
  streamId?: string;
}

export type EventType = StreamEvent["eventType"];

// ---------------------------------------------------------------------------
// Pure filter logic — extracted so it can be tested without React rendering
// ---------------------------------------------------------------------------

export function computeFilteredEvents(
  events: StreamEvent[],
  activeFilters: Set<EventType>,
): StreamEvent[] {
  if (activeFilters.size === 0) return events;
  return events.filter((e) => activeFilters.has(e.eventType));
}

export function toggleFilter(
  prev: Set<EventType>,
  type: EventType,
): Set<EventType> {
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
// ---------------------------------------------------------------------------
// FilterBar sub-component
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple "time ago" formatter */
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
    case "created":
      return "🎉";
    case "claimed":
      return "💰";
    case "canceled":
      return "❌";
    case "start_time_updated":
      return "⏰";
    default:
      return "📌";
  }
}

function getEventDescription(event: StreamEvent): string {
  const actor = event.actor
    ? `${event.actor.slice(0, 6)}...${event.actor.slice(-4)}`
    : "Unknown";
  switch (event.eventType) {
    case "created":
      return `Initiated by ${actor} for ${event.amount} tokens`;
    case "claimed":
      return `Claim of ${event.amount} tokens processed by ${actor}`;
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
  const [activeFilters, setActiveFilters] = useState<Set<EventType>>(new Set());

  const filteredEvents = useMemo(
    () => computeFilteredEvents(events, activeFilters),
    [events, activeFilters],
  );

  function handleToggleFilter(type: EventType) {
    setActiveFilters((prev) => toggleFilter(prev, type));
  }

  function handleClearFilters() {
    setActiveFilters(clearFilters());
  }

  const loadHistory = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = streamId
        ? await getStreamHistory(streamId)
        : await listAllEvents();
      setEvents(data);
    } catch (err: any) {
      setError(err.message || "Failed to load stream history");
    } finally {
      setLoading(false);
    }
  }, [streamId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  if (loading) {
    return <div className="text-gray-500">Loading history...</div>;
  }

  if (error) {
    return <div className="text-red-500">Error: {error}</div>;
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Stream Timeline</h3>
      <FilterBar
        activeFilters={activeFilters}
        onToggle={handleToggleFilter}
        onClear={handleClearFilters}
      />
      {events.length === 0 ? (
        <div className="text-gray-500">No events found</div>
      ) : filteredEvents.length === 0 && activeFilters.size > 0 ? (
        <div className="text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-4">
          No events match the selected filters. Try adjusting or clearing your filters.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredEvents.map((event: StreamEvent) => (
            <div
              key={event.id}
              className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200"
            >
              <div className="text-2xl">{getEventIcon(event.eventType)}</div>
              <div className="flex-1">
                <div className="font-medium text-gray-900">
                  {getEventDescription(event)}
                </div>
                <div className="text-sm text-gray-500">
                  {timeAgo(event.timestamp)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
