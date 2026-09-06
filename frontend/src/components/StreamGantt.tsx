import { useMemo, useState, type CSSProperties } from 'react';
import { Stream, StreamStatus } from '../types/stream';

/**
 * Horizontal Gantt chart that renders every stream on a shared timeline.
 *
 * - One row per stream with a color-coded bar spanning `startAt →
 *   startAt + durationSeconds`.
 * - Bar colors: gray = unvested (scheduled/canceled), blue = vested
 *   (active/paused), green = claimed (completed).
 * - Zoom controls switch between day, week, and month granularity.
 * - Clicking a bar opens the stream detail view via `onOpenStream`.
 */

export type GanttZoom = 'day' | 'week' | 'month';

export interface StreamGanttProps {
  streams: Stream[];
  onOpenStream?: (streamId: string) => void;
}

export interface GanttZoomLevel {
  key: GanttZoom;
  label: string;
  /** Seconds covered by a single timeline unit at this zoom level. */
  secondsPerUnit: number;
}

export const ZOOM_LEVELS: GanttZoomLevel[] = [
  { key: 'day', label: 'Day', secondsPerUnit: 24 * 60 * 60 },
  { key: 'week', label: 'Week', secondsPerUnit: 7 * 24 * 60 * 60 },
  { key: 'month', label: 'Month', secondsPerUnit: 30 * 24 * 60 * 60 },
];

/** Pixel width of a single timeline unit at the current zoom. */
export const GANTT_UNIT_PX = 56;
/** Width reserved for the stream label column. */
export const GANTT_LABEL_COLUMN_PX = 176;
/** Minimum rendered bar width so short streams stay clickable. */
export const GANTT_MIN_BAR_PX = 4;
export const GANTT_ROW_HEIGHT_PX = 36;
export const GANTT_AXIS_HEIGHT_PX = 26;

export const GANTT_COLORS = {
  /** Not yet vested (scheduled, canceled, or never started). */
  unvested: '#9ca3af',
  /** Vested and still claimable (active, paused). */
  vested: '#3b82f6',
  /** Fully vested and claimed (completed). */
  claimed: '#22c55e',
} as const;

export function streamGanttColor(status: StreamStatus): string {
  switch (status) {
    case 'completed':
      return GANTT_COLORS.claimed;
    case 'active':
    case 'paused':
      return GANTT_COLORS.vested;
    default:
      return GANTT_COLORS.unvested;
  }
}

function formatAxisLabel(timestamp: number, zoom: GanttZoom): string {
  const date = new Date(timestamp * 1000);
  if (zoom === 'month') {
    return date.toLocaleDateString(undefined, {
      month: 'short',
      year: 'numeric',
    });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function StreamGantt({ streams, onOpenStream }: StreamGanttProps) {
  const [zoom, setZoom] = useState<GanttZoom>('week');
  const activeZoom =
    ZOOM_LEVELS.find((level) => level.key === zoom) ?? ZOOM_LEVELS[1];

  const domain = useMemo(() => {
    if (streams.length === 0) {
      return null;
    }
    const start = Math.min(...streams.map((stream) => stream.startAt));
    const end = Math.max(
      ...streams.map((stream) => stream.startAt + stream.durationSeconds),
    );
    const pad = Math.max(Math.ceil((end - start) / 20), 3600);
    return { start: start - pad, end: end + pad };
  }, [streams]);

  const totalUnits = useMemo(() => {
    if (!domain) {
      return 0;
    }
    return Math.max(
      1,
      Math.ceil((domain.end - domain.start) / activeZoom.secondsPerUnit),
    );
  }, [domain, activeZoom.secondsPerUnit]);

  if (!domain || streams.length === 0) {
    return (
      <div className="stream-gantt" data-testid="stream-gantt">
        <div style={{ padding: '1.25rem', color: 'var(--color-text-muted)' }}>
          No streams to display yet.
        </div>
      </div>
    );
  }

  const chartWidth = totalUnits * GANTT_UNIT_PX;
  const tickIndexes = Array.from(
    { length: totalUnits + 1 },
    (_, index) => index,
  );

  const barLayout = (stream: Stream): { left: number; width: number } => {
    const left =
      ((stream.startAt - domain.start) / activeZoom.secondsPerUnit) *
      GANTT_UNIT_PX;
    const width =
      (stream.durationSeconds / activeZoom.secondsPerUnit) * GANTT_UNIT_PX;
    return { left, width: Math.max(width, GANTT_MIN_BAR_PX) };
  };

  const tickStyle: CSSProperties = {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    background: 'var(--border, #e5e7eb)',
  };

  return (
    <div className="stream-gantt" data-testid="stream-gantt" data-zoom={zoom}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.75rem',
          marginBottom: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.8rem',
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: GANTT_COLORS.unvested,
                display: 'inline-block',
              }}
            />
            Unvested
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.8rem',
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: GANTT_COLORS.vested,
                display: 'inline-block',
              }}
            />
            Vested
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.8rem',
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: GANTT_COLORS.claimed,
                display: 'inline-block',
              }}
            />
            Claimed
          </span>
        </div>

        <div
          role="group"
          aria-label="Gantt zoom level"
          style={{ display: 'flex', gap: '0.25rem' }}
        >
          {ZOOM_LEVELS.map((level) => (
            <button
              key={level.key}
              type="button"
              className="btn-ghost"
              aria-pressed={zoom === level.key}
              aria-label={`${level.label} zoom`}
              onClick={() => setZoom(level.key)}
              style={{
                padding: '0.25rem 0.6rem',
                fontSize: '0.8rem',
                fontWeight: zoom === level.key ? 600 : 400,
                ...(zoom === level.key
                  ? {
                      background: 'var(--color-background-secondary, #eef2f7)',
                      borderColor: 'var(--border)',
                    }
                  : {}),
              }}
            >
              {level.label}
            </button>
          ))}
        </div>
      </div>

      <div
        data-testid="stream-gantt-scroll"
        style={{
          overflowX: 'auto',
          border: '1px solid var(--border, #e5e7eb)',
          borderRadius: 8,
        }}
      >
        <div style={{ minWidth: GANTT_LABEL_COLUMN_PX + chartWidth }}>
          {/* Timeline axis */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              height: GANTT_AXIS_HEIGHT_PX,
              background: 'var(--bg-table-head, #f9fafb)',
              borderBottom: '1px solid var(--border, #e5e7eb)',
            }}
          >
            <div
              style={{
                width: GANTT_LABEL_COLUMN_PX,
                flexShrink: 0,
                padding: '0 0.75rem',
                fontWeight: 600,
                fontSize: '0.75rem',
              }}
            >
              Stream
            </div>
            <div
              style={{
                position: 'relative',
                width: chartWidth,
                height: '100%',
                flexShrink: 0,
              }}
            >
              {tickIndexes.map((index) => {
                const left = index * GANTT_UNIT_PX;
                const tickTime =
                  domain.start + index * activeZoom.secondsPerUnit;
                return (
                  <span
                    key={index}
                    style={{
                      position: 'absolute',
                      left,
                      top: 0,
                      height: '100%',
                      borderLeft: '1px solid var(--border, #e5e7eb)',
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        top: 5,
                        left: 6,
                        fontSize: '0.7rem',
                        whiteSpace: 'nowrap',
                        color: 'var(--color-text-muted, #6b7280)',
                      }}
                    >
                      {formatAxisLabel(tickTime, zoom)}
                    </span>
                  </span>
                );
              })}
            </div>
          </div>

          {/* Stream rows */}
          {streams.map((stream) => {
            const layout = barLayout(stream);
            const status = stream.progress.status;
            return (
              <div
                key={stream.id}
                className="stream-gantt-row"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  height: GANTT_ROW_HEIGHT_PX,
                  borderBottom: '1px solid var(--border, #e5e7eb)',
                }}
              >
                <div
                  style={{
                    width: GANTT_LABEL_COLUMN_PX,
                    flexShrink: 0,
                    padding: '0 0.75rem',
                    fontSize: '0.8rem',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={`${stream.id} · ${stream.assetCode} · ${status}`}
                >
                  {stream.id.length > 16
                    ? `${stream.id.slice(0, 16)}…`
                    : stream.id}
                </div>

                <div
                  data-testid="stream-gantt-track"
                  style={{
                    position: 'relative',
                    width: chartWidth,
                    height: '100%',
                    flexShrink: 0,
                  }}
                >
                  {tickIndexes.map((index) => (
                    <span
                      key={index}
                      style={{
                        ...tickStyle,
                        left: index * GANTT_UNIT_PX,
                        background:
                          index % 2 === 0
                            ? 'transparent'
                            : 'var(--bg-muted, #f9fafb)',
                      }}
                      aria-hidden
                    />
                  ))}

                  <button
                    type="button"
                    data-status={status}
                    aria-label={`Open stream ${stream.id}`}
                    title={`${stream.id} · ${stream.assetCode} · ${status} · ${stream.progress.percentComplete.toFixed(2)}% vested`}
                    onClick={() => onOpenStream?.(stream.id)}
                    style={{
                      position: 'absolute',
                      top: 7,
                      left: layout.left,
                      width: layout.width,
                      height: 22,
                      border: 'none',
                      borderRadius: 4,
                      background: streamGanttColor(status),
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-start',
                      padding: 0,
                      overflow: 'hidden',
                      boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)',
                    }}
                  >
                    {stream.progress.status === 'active' &&
                      stream.progress.percentComplete > 0 && (
                        <span
                          data-testid="stream-gantt-vested"
                          aria-hidden
                          style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            bottom: 0,
                            width: `${Math.min(stream.progress.percentComplete, 100)}%`,
                            background: 'rgba(0,0,0,0.18)',
                          }}
                        />
                      )}
                    {layout.width > 44 && (
                      <span
                        style={{
                          position: 'relative',
                          zIndex: 1,
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          color: '#fff',
                          padding: '0 6px',
                          textShadow: '0 1px 1px rgba(0,0,0,0.25)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {stream.id.length > 12
                          ? `${stream.id.slice(0, 12)}…`
                          : stream.id}
                      </span>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p
        style={{
          margin: '0.75rem 0 0',
          fontSize: '0.75rem',
          color: 'var(--color-text-muted, #6b7280)',
        }}
      >
        Showing {streams.length} stream{streams.length === 1 ? '' : 's'} ·{' '}
        {formatAxisLabel(domain.start, zoom)} →{' '}
        {formatAxisLabel(domain.end, zoom)}
      </p>
    </div>
  );
}
