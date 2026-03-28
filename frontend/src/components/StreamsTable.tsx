import { Fragment, useRef, useState } from "react";
import { Stream } from "../types/stream";
import { getExportCsvUrl, ListStreamsFilters } from "../services/api";
import { CopyableAddress } from "./CopyableAddress";
import { StreamTimeline } from "./StreamTimeline";
import { getHealthBadges } from "../utils/streamHealthBadges";

interface StreamsTableProps {
  streams: Stream[];
  filters: ListStreamsFilters;
  onFiltersChange: (f: ListStreamsFilters) => void;
  onCancel: (streamId: string) => Promise<void>;
  /**
   * Called when the user clicks "Edit" for a scheduled stream.
   * Receives the stream AND the button ref so the modal can return focus.
   */
  onEditStartTime: (stream: Stream, triggerRef: React.RefObject<HTMLButtonElement | null>) => void;
}

function statusClass(status: Stream["progress"]["status"]): string {
  switch (status) {
    case "active":    return "badge badge-active";
    case "scheduled": return "badge badge-scheduled";
    case "completed": return "badge badge-completed";
    case "canceled":  return "badge badge-canceled";
    default:          return "badge";
  }
}

function formatTimestamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString();
}

export function StreamsTable({
  streams,
  filters,
  onFiltersChange: _onFiltersChange,
  onCancel,
  onEditStartTime,
}: StreamsTableProps) {
  const exportUrl = getExportCsvUrl(filters as Record<string, string>);
  const [expandedStreamId, setExpandedStreamId] = useState<string | null>(null);

  const toggleTimeline = (streamId: string) => {
    setExpandedStreamId((prev) => (prev === streamId ? null : streamId));
  };

  return (
    <div className="card">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem",
        }}
      >
        <h2 style={{ margin: 0 }}>Live Streams</h2>
        <a href={exportUrl} className="btn-ghost" download>
          Export CSV
        </a>
      </div>

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
                const healthBadges = getHealthBadges(stream);

                return (
                  <StreamRow
                    key={stream.id}
                    stream={stream}
                    isScheduled={isScheduled}
                    isFinalised={isFinalised}
                    isExpanded={isExpanded}
                    healthBadges={healthBadges}
                    onToggleTimeline={toggleTimeline}
                    onCancel={onCancel}
                    onEditStartTime={onEditStartTime}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


// ── StreamRow ─────────────────────────────────────────────────────────────
// Extracted so each row can hold its own triggerRef without polluting the
// parent component's hook rules.

interface StreamRowProps {
  stream: Stream;
  isScheduled: boolean;
  isFinalised: boolean;
  isExpanded: boolean;
  healthBadges: ReturnType<typeof getHealthBadges>;
  onToggleTimeline: (id: string) => void;
  onCancel: (id: string) => Promise<void>;
  onEditStartTime: StreamsTableProps["onEditStartTime"];
}

function StreamRow({
  stream,
  isScheduled,
  isFinalised,
  isExpanded,
  healthBadges,
  onToggleTimeline,
  onCancel,
  onEditStartTime,
}: StreamRowProps) {
  /**
   * Stable ref to the "✏️ Edit" button in this row.
   * Passed to the modal so focus returns here when the modal closes.
   */
  const editBtnRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <tr>
        <td>
          <button
            type="button"
            className="btn-ghost"
            aria-expanded={isExpanded}
            aria-controls={`timeline-${stream.id}`}
            onClick={() => onToggleTimeline(stream.id)}
            title={isExpanded ? "Hide timeline" : "Show timeline"}
          >
            {isExpanded ? "▲" : "▼"} {stream.id}
          </button>
        </td>
        <td>
          <div className="stacked">
            <CopyableAddress address={stream.sender} truncationMode="end" />
            <CopyableAddress address={stream.recipient} truncationMode="end" />
          </div>
        </td>
        <td>
          {stream.totalAmount} {stream.assetCode}
          <div className="muted">Start: {formatTimestamp(stream.startAt)}</div>
        </td>
        <td>
          <div className="progress-copy">
            <strong>{stream.progress.percentComplete}%</strong>
            <span className="muted">
              Vested: {stream.progress.vestedAmount} {stream.assetCode}
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
                ref={editBtnRef}
                className="btn-ghost btn-edit"
                type="button"
                aria-label={`Edit start time for stream ${stream.id}`}
                onClick={() => onEditStartTime(stream, editBtnRef)}
              >
                ✏️ Edit
              </button>
            )}
            <button
              className="btn-ghost"
              type="button"
              aria-label={`Cancel stream ${stream.id}`}
              onClick={() => onCancel(stream.id)}
              disabled={isFinalised}
            >
              Cancel
            </button>
          </div>
        </td>
      </tr>

      {isExpanded && (
        <tr id={`timeline-${stream.id}`}>
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
}

