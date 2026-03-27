import { useState } from "react";
import { Stream } from "../types/stream";
import { getExportCsvUrl, ListStreamsFilters } from "../services/api";
import { StreamTimeline } from "./StreamTimeline";


interface StreamsTableProps {
  streams: Stream[];
  filters: ListStreamsFilters;
  onFiltersChange: (f: ListStreamsFilters) => void;
  onCancel: (streamId: string) => Promise<void>;
  onEditStartTime: (stream: Stream) => void;
}

const VALID_STATUSES = [
  "active",
  "scheduled",
  "completed",
  "canceled",
] as const;

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
    default:
      return "badge";
  }
}

function formatTimestamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString();
}



  const exportUrl = getExportCsvUrl(filters as Record<string, string>);

  const header = (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "1rem",
      }}
    >
      <h2 style={{ margin: 0 }}>Live Streams</h2>
      {/* <a href={exportUrl} className="btn-ghost" download>
        Export CSV
      </a> */}
    </div>
  );

  const [expandedStreamId, setExpandedStreamId] = useState<string | null>(null);

  const toggleTimeline = (streamId: string) => {
    setExpandedStreamId((prev) => (prev === streamId ? null : streamId));
  };

  return (
    <div className="card">
      {header}
      {/* <FilterBar filters={filters} onChange={onFiltersChange} /> */}

      {streams.length === 0 ? (
        <p className="muted">No streams match your filters.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Route</th>
                <th>Asset</th>
                <th>Progress</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {streams.map((stream) => {
                const isScheduled = stream.progress.status === "scheduled";
                const isFinalised =
                  stream.progress.status === "completed" ||
                  stream.progress.status === "canceled";
                const isExpanded = expandedStreamId === stream.id;

                // Derive health badges for this stream
                const healthBadges = getHealthBadges(stream);

                return (
                  <>
                    <tr key={stream.id}>
                      <td>
                        <button
                          type="button"
                          className="btn-ghost"
                          aria-expanded={isExpanded}
                          aria-controls={`timeline-${stream.id}`}
                          onClick={() => toggleTimeline(stream.id)}
                          title={isExpanded ? "Hide timeline" : "Show timeline"}
                        >
                          {isExpanded ? "▲" : "▼"} {stream.id}
                        </button>
                      </td>
                      <td>
                        <div className="stacked">
                          <CopyableAddress
                            address={stream.sender}
                            truncationMode="end"
                          />
                          <CopyableAddress
                            address={stream.recipient}
                            truncationMode="end"
                          />
                        </div>
                      </td>
                      <td>
                        {stream.totalAmount} {stream.assetCode}
                        <div className="muted">
                          Start: {formatTimestamp(stream.startAt)}
                        </div>
                      </td>
                      <td>
                        <div className="progress-copy">
                          <strong>{stream.progress.percentComplete}%</strong>
                          <span className="muted">
                            Vested: {stream.progress.vestedAmount}{" "}
                            {stream.assetCode}
                          </span>
                        </div>
                        <div className="progress-bar" aria-hidden>
                          <div
                            style={{
                              width: `${Math.min(stream.progress.percentComplete, 100)}%`,
                            }}
                          />
                        </div>
                      </td>
                      <td>
                        {/*
                         * Status cell: core status label first, then health
                         * badges below. Badges are purely additive and never
                         * replace the status label.
                         */}
                        <div className="status-cell">
                          <span className={statusClass(stream.progress.status)}>
                            {stream.progress.status}
                          </span>
                          {healthBadges.length > 0 && (
                            <div className="health-badge-row" role="list" aria-label="Health badges">
                              {healthBadges.map((badge) => (
                                <span
                                  key={badge.key}
                                  className={badge.cssClass}
                                  title={badge.title}
                                  role="listitem"
                                >
                                  {badge.label}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="action-cell">
                          {isScheduled && (
                            <button
                              className="btn-ghost btn-edit"
                              type="button"
                              title="Edit start time"
                              onClick={() => onEditStartTime(stream)}
                            >
                              ✏️ Edit
                            </button>
                          )}
                          <button
                            className="btn-ghost"
                            type="button"
                            onClick={() => onCancel(stream.id)}
                            disabled={isFinalised}
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr
                        key={`timeline-${stream.id}`}
                        id={`timeline-${stream.id}`}
                      >
                        <td
                          colSpan={6}
                          style={{
                            padding: "1rem 1.5rem",
                            background: "var(--color-background-secondary)",
                          }}
                        >
                          <StreamTimeline streamId={stream.id} />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
