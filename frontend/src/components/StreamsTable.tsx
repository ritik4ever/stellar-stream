import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Stream } from "../types/stream";
import { getExportCsvUrl, ListStreamsFilters, cancelStream } from "../services/api";
import { CopyableAddress } from "./CopyableAddress";
import { StreamTimeline } from "./StreamTimeline";
import { getHealthBadges } from "../utils/streamHealthBadges";
import { FilterBar } from "./FilterBar";
import {
  OPTIONAL_COLUMN_LABELS,
  OPTIONAL_STREAM_COLUMNS,
  useStreamTableColumns,
  type OptionalStreamColumn,
} from "../hooks/useStreamTableColumns";
import { useWebSocket } from "../hooks/useWebSocket";

interface StreamsTableProps {
  streams: Stream[];
  loading?: boolean;
  filters: ListStreamsFilters;
  onFiltersChange: (f: ListStreamsFilters) => void;
  onCancel: (streamId: string) => Promise<void>;
  onPause: (streamId: string) => Promise<void>;
  onResume: (streamId: string) => Promise<void>;
  onOpenStream?: (streamId: string) => void;
  onEditStartTime: (stream: Stream, triggerRef: RefObject<HTMLButtonElement | null>) => void;
  // Optional props expected by App.tsx
  totalStreamCount?: number;
  onCreateStream?: () => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onRefreshStreams?: () => void;
  setUrlFilters?: (filters: ListStreamsFilters) => void;
}

const SKELETON_ROW_COUNT = 6;
/** Visible rows outside the viewport kept mounted for smooth scroll. */
export const STREAMS_TABLE_VIRTUAL_OVERSCAN = 5;
/** Only virtualize once lists are large enough to benefit from windowing. */
const VIRTUALIZATION_THRESHOLD = 50;
const ESTIMATE_ROW_HEIGHT_PX = 52;
const TABLE_SCROLL_MAX_HEIGHT = "min(70vh, 720px)";
const TABLE_SCROLL_VIEWPORT_HEIGHT = "480px";

function SkeletonRow({ colCount }: { colCount: number }) {
  return (
    <tr aria-hidden="true">
      {Array.from({ length: colCount }, (_, i) => (
        <td key={i}>
          <div className="skeleton" style={{ width: "80px", height: "16px" }} />
        </td>
      ))}
    </tr>
  );
}

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
    case "paused":
      return "badge badge-paused";
    default:
      return "badge";
  }
}

function formatTimestamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString();
}

function formatDuration(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}

export function StreamsTable({
  streams,
  loading = false,
  filters,
  onFiltersChange,
  onCancel,
  onPause,
  onResume,
  onEditStartTime,
  onOpenStream,
  onLoadMore,
  hasMore = true,
  loadingMore = false,
  onRefreshStreams,
  setUrlFilters,
}: StreamsTableProps) {
  const { visibility, toggleColumn, isVisible } = useStreamTableColumns();
  const [columnsOpen, setColumnsOpen] = useState(false);
  const columnsRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [streamProgressUpdates, setStreamProgressUpdates] = useState<Map<string, Stream["progress"]>>(new Map());

  const wsUrl = import.meta.env.VITE_WS_URL ?? "";
  const { readyState } = useWebSocket<{
    type: string;
    streamId?: string;
    progress?: Stream["progress"];
  }>(wsUrl, {
    onMessage: (data) => {
      if (data.type === "stream_progress" && data.streamId && data.progress) {
        setStreamProgressUpdates((prev) => {
          const next = new Map(prev);
          next.set(data.streamId!, data.progress!);
          return next;
        });
      }
    },
  });

  const isWebSocketConnected = readyState === 1; // WebSocket.OPEN
  const hasWebSocketUrl = wsUrl.length > 0;

  // Poll for updates when WebSocket is disconnected and URL is configured
  useEffect(() => {
    if (isWebSocketConnected || !hasWebSocketUrl || !onRefreshStreams) {
      return;
    }
    const interval = setInterval(() => {
      onRefreshStreams();
    }, 5000); // Poll every 5 seconds when disconnected
    return () => clearInterval(interval);
  }, [isWebSocketConnected, hasWebSocketUrl, onRefreshStreams]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !onLoadMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loadingMore) {
          onLoadMore();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [onLoadMore, hasMore, loadingMore]);

  const [selectedStreamIds, setSelectedStreamIds] = useState<Set<string>>(new Set());
  const [expandedStreamId, setExpandedStreamId] = useState<string | null>(null);
  const [isBulkCanceling, setIsBulkCanceling] = useState(false);
  const [bulkCancelProgress, setBulkCancelProgress] = useState({ current: 0, total: 0 });

  const exportUrl = useMemo(() => getExportCsvUrl(filters as Record<string, string>), [filters]);

  const sortedStreams = useMemo(
    () => [...streams].sort((a, b) => a.id.localeCompare(b.id)),
    [streams],
  );

  const streamsWithProgress = useMemo(
    () =>
      sortedStreams.map((stream) => {
        const progressUpdate = streamProgressUpdates.get(stream.id);
        if (progressUpdate) {
          return { ...stream, progress: progressUpdate };
        }
        return stream;
      }),
    [sortedStreams, streamProgressUpdates],
  );

  const visibleOptionalColumns = useMemo(
    () => OPTIONAL_STREAM_COLUMNS.filter((col) => isVisible(col)),
    [isVisible, visibility],
  );

  const colCount = 7 + visibleOptionalColumns.length;

  const isStreamSelectable = useCallback((stream: Stream): boolean => {
    return (
      stream.progress.status === "active" || stream.progress.status === "scheduled"
    );
  }, []);

  const selectableStreams = useMemo(
    () => streams.filter(isStreamSelectable),
    [streams, isStreamSelectable],
  );
  const selectableIds = useMemo(
    () => new Set(selectableStreams.map((s) => s.id)),
    [selectableStreams],
  );

  const allSelectableSelected = useMemo(
    () =>
      selectableStreams.length > 0 &&
      selectableStreams.every((stream) => selectedStreamIds.has(stream.id)),
    [selectableStreams, selectedStreamIds],
  );

  const handleCheckboxToggle = useCallback((streamId: string) => {
    setSelectedStreamIds((prev) => {
      const next = new Set(prev);
      if (next.has(streamId)) next.delete(streamId);
      else next.add(streamId);
      return next;
    });
  }, []);

  const handleSelectAllToggle = useCallback(() => {
    if (allSelectableSelected) {
      setSelectedStreamIds((prev) => {
        const next = new Set(prev);
        selectableIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedStreamIds((prev) => {
        const next = new Set(prev);
        selectableIds.forEach((id) => next.add(id));
        return next;
      });
    }
  }, [allSelectableSelected, selectableIds]);

  const toggleTimeline = useCallback((id: string) => {
    setExpandedStreamId((prev) => (prev === id ? null : id));
    onOpenStream?.(id);
  }, [onOpenStream]);

  const handleBulkCancel = useCallback(async () => {
    const idsToCancel = Array.from(selectedStreamIds);
    if (idsToCancel.length === 0) return;

    setIsBulkCanceling(true);
    setBulkCancelProgress({ current: 0, total: idsToCancel.length });

    for (let i = 0; i < idsToCancel.length; i++) {
      setBulkCancelProgress({ current: i + 1, total: idsToCancel.length });
      try {
        await cancelStream(idsToCancel[i]);
      } catch (error) {
        console.error(`Failed to cancel stream ${idsToCancel[i]}:`, error);
      }
    }

    setSelectedStreamIds(new Set());
    setIsBulkCanceling(false);
    setBulkCancelProgress({ current: 0, total: 0 });
  }, [selectedStreamIds]);

  useEffect(() => {
    setSelectedStreamIds((prev) => {
      const validIds = new Set(streams.map((s) => s.id));
      const next = new Set<string>();
      prev.forEach((id) => {
        if (validIds.has(id)) next.add(id);
      });
      return next;
    });
  }, [streams]);

  useEffect(() => {
    if (!columnsOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (columnsRef.current && !columnsRef.current.contains(e.target as Node)) {
        setColumnsOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [columnsOpen]);

  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const shouldVirtualize = !loading && sortedStreams.length >= VIRTUALIZATION_THRESHOLD;

  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? sortedStreams.length : 0,
    getScrollElement: () => scrollElement,
    estimateSize: () => ESTIMATE_ROW_HEIGHT_PX,
    overscan: STREAMS_TABLE_VIRTUAL_OVERSCAN,
    getItemKey: (index) => sortedStreams[index]?.id ?? index,
    measureElement: (element) => {
      const row = element as HTMLTableRowElement;
      let height = row.getBoundingClientRect().height;
      const timelineRow = row.nextElementSibling;
      if (
        timelineRow instanceof HTMLTableRowElement &&
        timelineRow.dataset.timelineRow === "true"
      ) {
        height += timelineRow.getBoundingClientRect().height;
      }
      return height;
    },
  });

  const virtualRows = rowVirtualizer.getVirtualItems();

  const resolvedVirtualRows = useMemo(() => {
    if (!shouldVirtualize) return [];

    if (virtualRows.length > 0) return virtualRows;

    const fallbackCount = Math.min(
      sortedStreams.length,
      Math.ceil(parseInt(TABLE_SCROLL_VIEWPORT_HEIGHT, 10) / ESTIMATE_ROW_HEIGHT_PX) +
        STREAMS_TABLE_VIRTUAL_OVERSCAN,
    );

    return Array.from({ length: fallbackCount }, (_, index) => ({
      index,
      start: index * ESTIMATE_ROW_HEIGHT_PX,
      end: (index + 1) * ESTIMATE_ROW_HEIGHT_PX,
      size: ESTIMATE_ROW_HEIGHT_PX,
      key: sortedStreams[index].id,
      lane: 0,
    }));
  }, [shouldVirtualize, sortedStreams, virtualRows]);

  useLayoutEffect(() => {
    if (!shouldVirtualize || !scrollElement) return;
    rowVirtualizer.measure();
  }, [expandedStreamId, shouldVirtualize, scrollElement, visibleOptionalColumns, rowVirtualizer]);

  const renderStreamRow = (
    stream: Stream,
    dataIndex: number,
    measureRef?: (element: HTMLTableRowElement | null) => void,
  ) => {
    const progressUpdate = streamProgressUpdates.get(stream.id);
    const streamWithProgress = progressUpdate ? { ...stream, progress: progressUpdate } : stream;
    return (
      <StreamRow
        key={stream.id}
        stream={streamWithProgress}
        isScheduled={streamWithProgress.progress.status === "scheduled"}
        isFinalised={
          streamWithProgress.progress.status === "completed" ||
          streamWithProgress.progress.status === "canceled"
        }
        isExpanded={expandedStreamId === stream.id}
        healthBadges={getHealthBadges(streamWithProgress)}
        isSelected={selectedStreamIds.has(stream.id)}
        visibleOptionalColumns={visibleOptionalColumns}
        colSpan={colCount}
        measureRef={measureRef}
        dataIndex={dataIndex}
        onToggleTimeline={toggleTimeline}
        onCheckboxToggle={handleCheckboxToggle}
        onCancel={onCancel}
        onPause={onPause}
        onResume={onResume}
        onEditStartTime={onEditStartTime}
        onOpenStream={onOpenStream}
      />
    );
  };

  const paddingTop =
    resolvedVirtualRows.length > 0 ? resolvedVirtualRows[0].start : 0;
  const paddingBottom =
    resolvedVirtualRows.length > 0
      ? rowVirtualizer.getTotalSize() - resolvedVirtualRows[resolvedVirtualRows.length - 1].end
      : 0;

  return (
    <>
      {!isWebSocketConnected && hasWebSocketUrl && (
        <div 
          className="ws-disconnected-banner" 
          role="status"
          aria-live="polite"
          style={{
            background: "var(--bg-muted)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            padding: "0.5rem 0.75rem",
            marginBottom: "1rem",
            fontSize: "0.85rem",
            color: "var(--color-text)",
            display: "flex",
          alignItems: "center",
          gap: "0.5rem",
        }}
        >
          <span>⚠️</span>
          <span>Live updates paused - using polling for progress updates</span>
        </div>
      )}
      <div className="card">
        <FilterBar filters={filters} onChange={onFiltersChange} setUrlFilters={setUrlFilters} />
        <div
          className="streams-table-toolbar"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1rem",
            gap: "0.75rem",
          }}
        >
          <h2 style={{ margin: 0 }}>Live Streams</h2>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <div className="column-toggle" ref={columnsRef} style={{ position: "relative" }}>
              <button
                type="button"
                className="btn-ghost"
                aria-expanded={columnsOpen}
                aria-haspopup="true"
                aria-label="Toggle table columns"
                onClick={() => setColumnsOpen((o) => !o)}
              >
                ⊞ Columns
              </button>
              {columnsOpen && (
                <div
                  className="column-toggle-popover"
                  role="dialog"
                  aria-label="Column visibility"
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "100%",
                    marginTop: "0.25rem",
                    zIndex: 20,
                    background: "var(--color-background)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "8px",
                    padding: "0.75rem",
                    minWidth: "200px",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                  }}
                >
                  <p className="muted" style={{ margin: "0 0 0.5rem", fontSize: "0.85rem" }}>
                    Optional columns
                  </p>
                  {OPTIONAL_STREAM_COLUMNS.map((col) => (
                    <label
                      key={col}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        marginBottom: "0.35rem",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isVisible(col)}
                        onChange={() => toggleColumn(col)}
                      />
                      {OPTIONAL_COLUMN_LABELS[col]}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <a href={exportUrl} className="btn-ghost" download>
              Export CSV
            </a>
          </div>
        </div>

        <div
          ref={setScrollElement}
          className="streams-table-scroll"
          data-testid="streams-table-scroll"
          style={{
            maxHeight: TABLE_SCROLL_MAX_HEIGHT,
            ...(shouldVirtualize ? { height: TABLE_SCROLL_VIEWPORT_HEIGHT } : {}),
          }}
        >
          <table aria-busy={loading} aria-label="Streams">
            <thead className="streams-table-head">
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all streams"
                    checked={allSelectableSelected}
                    onChange={handleSelectAllToggle}
                    disabled={loading}
                  />
                </th>
                <th>ID</th>
                <th>Sender</th>
                <th>Recipient</th>
                {isVisible("assetCode") && <th>Asset</th>}
                {isVisible("duration") && <th>Duration</th>}
                {isVisible("ratePerSecond") && <th>Rate / sec</th>}
                {isVisible("pausedDuration") && <th>Paused</th>}
                <th>Progress</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: SKELETON_ROW_COUNT }, (_, i) => (
                  <SkeletonRow key={i} colCount={colCount} />
                ))
              ) : shouldVirtualize ? (
                <>
                  {paddingTop > 0 && (
                    <tr aria-hidden="true" className="streams-table-spacer">
                      <td
                        colSpan={colCount}
                        style={{ height: paddingTop, padding: 0, border: "none" }}
                      />
                    </tr>
                  )}
                  {resolvedVirtualRows.map((virtualRow) =>
                    renderStreamRow(
                      streamsWithProgress[virtualRow.index],
                      virtualRow.index,
                      rowVirtualizer.measureElement,
                    ),
                  )}
                  {paddingBottom > 0 && (
                    <tr aria-hidden="true" className="streams-table-spacer">
                      <td
                        colSpan={colCount}
                        style={{ height: paddingBottom, padding: 0, border: "none" }}
                      />
                    </tr>
                  )}
                </>
              ) : (
                streamsWithProgress.map((stream, index) => renderStreamRow(stream, index))
              )}
            </tbody>
          </table>
          <div
            ref={sentinelRef}
            style={{ height: 1 }}
            data-testid="infinite-scroll-sentinel"
          />
          {loadingMore && (
            <div style={{ textAlign: "center", padding: "1rem", color: "var(--color-muted)" }}>
              Loading more streams...
            </div>
          )}
          {!hasMore && streams.length > 0 && (
            <div style={{ textAlign: "center", padding: "1rem", color: "var(--color-muted)" }}>
              End of results
            </div>
          )}
        </div>
      </div>

      {selectedStreamIds.size > 0 && (
        <BulkActionBar
          selectedCount={selectedStreamIds.size}
          onCancel={handleBulkCancel}
          isCanceling={isBulkCanceling}
          progress={bulkCancelProgress}
        />
      )}
    </>
  );
}

interface BulkActionBarProps {
  selectedCount: number;
  onCancel: () => void;
  isCanceling: boolean;
  progress: { current: number; total: number };
}

function BulkActionBar({
  selectedCount,
  onCancel,
  isCanceling,
  progress,
}: BulkActionBarProps) {
  return (
    <div className="bulk-action-bar">
      <div className="bulk-action-bar__content">
        <span className="bulk-action-bar__count">
          {selectedCount} stream{selectedCount !== 1 ? "s" : ""} selected
        </span>
        <button
          className="bulk-action-bar__button"
          onClick={onCancel}
          disabled={isCanceling}
        >
          {isCanceling
            ? `Canceling ${progress.current}/${progress.total}...`
            : `Cancel ${selectedCount} Stream${selectedCount !== 1 ? "s" : ""}`}
        </button>
      </div>
    </div>
  );
}

interface StreamRowProps {
  stream: Stream;
  isScheduled: boolean;
  isFinalised: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  healthBadges: ReturnType<typeof getHealthBadges>;
  visibleOptionalColumns: OptionalStreamColumn[];
  colSpan: number;
  dataIndex: number;
  measureRef?: (element: HTMLTableRowElement | null) => void;
  onToggleTimeline: (id: string) => void;
  onCheckboxToggle: (id: string) => void;
  onCancel: (id: string) => Promise<void>;
  onPause: (id: string) => Promise<void>;
  onResume: (id: string) => Promise<void>;
  onEditStartTime: StreamsTableProps["onEditStartTime"];
  onOpenStream?: (streamId: string) => void;
}

const StreamRow = memo(function StreamRow({
  stream,
  isScheduled,
  isFinalised,
  isExpanded,
  isSelected,
  healthBadges,
  visibleOptionalColumns,
  colSpan,
  dataIndex,
  measureRef,
  onToggleTimeline,
  onCheckboxToggle,
  onCancel,
  onPause,
  onResume,
  onEditStartTime,
  onOpenStream,
}: StreamRowProps) {
  const editBtnRef = useRef<HTMLButtonElement>(null);
  const isPaused = stream.progress.status === "paused";
  const isActive = stream.progress.status === "active";
  const show = (col: OptionalStreamColumn) => visibleOptionalColumns.includes(col);

  return (
    <>
      <tr ref={measureRef} data-index={dataIndex}>
        <td>
          <input
            type="checkbox"
            aria-label={`Select stream ${stream.id}`}
            checked={isSelected}
            onChange={() => onCheckboxToggle(stream.id)}
            disabled={isFinalised}
          />
        </td>
        <td>
          <button
            type="button"
            className="btn-ghost"
            aria-expanded={isExpanded}
            aria-controls={`timeline-${stream.id}`}
            onClick={() => {
              onToggleTimeline(stream.id);
            }}
            title={isExpanded ? "Hide timeline" : "Show timeline"}
          >
            {isExpanded ? "▲" : "▼"} {stream.id}
          </button>
        </td>
        <td>
          <CopyableAddress address={stream.sender} truncationMode="end" />
        </td>
        <td>
          <CopyableAddress address={stream.recipient} truncationMode="end" />
        </td>
        {show("assetCode") && <td>{stream.assetCode}</td>}
        {show("duration") && <td>{formatDuration(stream.durationSeconds)}</td>}
        {show("ratePerSecond") && (
          <td>{stream.progress.ratePerSecond.toFixed(6)}</td>
        )}
        {show("pausedDuration") && (
          <td>{stream.pausedDuration ?? 0}s</td>
        )}
        <td>
          <div className="progress-copy">
            <strong>{stream.progress.percentComplete.toFixed(2)}%</strong>
            <span className="muted">
              Vested: {stream.progress.vestedAmount.toFixed(2)} {stream.assetCode}
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
            {isActive && (
              <button
                className="btn-ghost"
                type="button"
                aria-label={`Pause stream ${stream.id}`}
                onClick={() => onPause(stream.id)}
              >
                ⏸ Pause
              </button>
            )}
            {isPaused && (
              <button
                className="btn-ghost"
                type="button"
                aria-label={`Resume stream ${stream.id}`}
                onClick={() => onResume(stream.id)}
              >
                ▶ Resume
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
        <tr id={`timeline-${stream.id}`} data-timeline-row="true">
          <td
            colSpan={colSpan}
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
}, (prev, next) =>
  prev.stream === next.stream &&
  prev.isExpanded === next.isExpanded &&
  prev.isSelected === next.isSelected &&
  prev.isScheduled === next.isScheduled &&
  prev.isFinalised === next.isFinalised &&
  prev.dataIndex === next.dataIndex &&
  prev.visibleOptionalColumns.join() === next.visibleOptionalColumns.join(),
);
