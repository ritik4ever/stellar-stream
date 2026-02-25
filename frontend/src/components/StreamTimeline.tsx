import { useEffect, useState } from "react";
import { getStreamHistory, StreamEvent } from "../services/api";

interface StreamTimelineProps {
  streamId: string;
}

export function StreamTimeline({ streamId }: StreamTimelineProps) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadHistory();
  }, [streamId]);

  async function loadHistory() {
    try {
      setLoading(true);
      setError(null);
      const data = await getStreamHistory(streamId);
      setEvents(data);
    } catch (err: any) {
      setError(err.message || "Failed to load stream history");
    } finally {
      setLoading(false);
    }
  }

  function formatTimestamp(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleString();
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
    switch (event.eventType) {
      case "created":
        return `Stream created by ${event.actor?.slice(0, 8)}... for ${event.amount} tokens`;
      case "claimed":
        return `${event.actor?.slice(0, 8)}... claimed ${event.amount} tokens`;
      case "canceled":
        return `Stream canceled by ${event.actor?.slice(0, 8)}...`;
      case "start_time_updated":
        return `Start time updated by ${event.actor?.slice(0, 8)}...`;
      default:
        return "Unknown event";
    }
  }

  if (loading) {
    return <div className="text-gray-500">Loading history...</div>;
  }

  if (error) {
    return <div className="text-red-500">Error: {error}</div>;
  }

  if (events.length === 0) {
    return <div className="text-gray-500">No events found</div>;
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Stream Timeline</h3>
      <div className="space-y-3">
        {events.map((event: StreamEvent) => (
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
                {formatTimestamp(event.timestamp)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
