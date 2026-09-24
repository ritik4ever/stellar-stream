import { useMemo, useRef, useState } from "react";
import { Stream } from "../types/stream";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface VestingBarProps {
  stream: Stream;
  /**
   * Amount already claimed by the recipient.
   * Defaults to 0 when not yet tracked (on-chain claim integration pending).
   */
  claimedAmount?: number;
  /** Override the "current time" (unix seconds). Defaults to Date.now() / 1000. */
  now?: number;
  /** Optional extra class added to the outer container. */
  className?: string;
}

interface Segment {
  key: "claimed" | "vested" | "unvested";
  widthPct: number;
  label: string;
  bg: string;
  /** Accessible description for this segment */
  ariaLabel: string;
}

// ─── Tooltip ───────────────────────────────────────────────────────────────

interface TooltipProps {
  visible: boolean;
  x: number;
  lines: string[];
}

function Tooltip({ visible, x, lines }: TooltipProps) {
  if (!visible || lines.length === 0) return null;
  return (
    <div
      className="vesting-bar__tooltip"
      style={{ left: `${x}px` }}
      role="tooltip"
      aria-hidden="true"
    >
      {lines.map((line, i) => (
        <p key={i} className="vesting-bar__tooltip-line">
          {line}
        </p>
      ))}
    </div>
  );
}

// ─── Cliff marker ──────────────────────────────────────────────────────────

interface InlineCliffProps {
  cliffPct: number;
  hasReachedCliff: boolean;
  cliffDate: string;
  cliffDays: number;
}

function InlineCliff({ cliffPct, hasReachedCliff, cliffDate, cliffDays }: InlineCliffProps) {
  return (
    <div
      className={`vesting-bar__cliff ${hasReachedCliff ? "vesting-bar__cliff--reached" : "vesting-bar__cliff--pending"}`}
      style={{ left: `${cliffPct}%` }}
      aria-label={`Cliff on ${cliffDate} (${cliffDays} days from start)${hasReachedCliff ? ", reached" : ", not yet reached"}`}
      title={`Cliff on ${cliffDate} (${cliffDays}d from start)`}
    >
      <span className="vesting-bar__cliff-pin" aria-hidden="true">📍</span>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

/**
 * VestingBar — animated three-colour progress bar for a payment stream.
 *
 * Segments (left → right):
 *   ■ green  — claimed tokens
 *   ■ blue   — vested but not yet claimed
 *   ■ gray   — unvested / remaining
 *
 * Features:
 *   • Hover tooltip with exact amounts per segment
 *   • Optional cliff marker rendered as a vertical pin
 *   • ARIA roles and labels for screen-reader accessibility
 *   • CSS transition so the bar animates as values update
 */
export function VestingBar({
  stream,
  claimedAmount = 0,
  now: nowProp,
  className = "",
}: VestingBarProps) {
  const now = nowProp ?? Math.floor(Date.now() / 1000);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Tooltip state ──────────────────────────────────────────────────────
  const [tooltip, setTooltip] = useState<{ visible: boolean; x: number; lines: string[] }>({
    visible: false,
    x: 0,
    lines: [],
  });

  // ── Derived amounts ────────────────────────────────────────────────────
  const total = stream.totalAmount;
  const asset = stream.assetCode;

  // Clamp claimed so it never exceeds vested
  const vestedRaw = stream.progress.vestedAmount;
  const claimed = Math.max(0, Math.min(claimedAmount, vestedRaw));
  const vestedUnclaimed = Math.max(0, vestedRaw - claimed);
  const unvested = Math.max(0, total - vestedRaw);

  // Convert to percentages (guard against zero total)
  const toPercent = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  const claimedPct = toPercent(claimed);
  const vestedPct = toPercent(vestedUnclaimed);
  const unvestedPct = toPercent(unvested);

  // ── Cliff ──────────────────────────────────────────────────────────────
  const cliffData = useMemo(() => {
    const cs = stream.cliffSeconds;
    if (!cs || cs <= 0) return null;
    const cliffTimestamp = stream.startAt + cs;
    const cliffPct = (cs / stream.durationSeconds) * 100;
    const hasReachedCliff = now >= cliffTimestamp;
    const cliffDate = new Date(cliffTimestamp * 1000).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const cliffDays = Math.ceil(cs / (24 * 3600));
    return { cliffPct, hasReachedCliff, cliffDate, cliffDays };
  }, [stream.cliffSeconds, stream.startAt, stream.durationSeconds, now]);

  // ── Segments ───────────────────────────────────────────────────────────
  const segments: Segment[] = useMemo(
    () => [
      {
        key: "claimed",
        widthPct: claimedPct,
        label: "Claimed",
        bg: "var(--vesting-claimed, #10b981)",
        ariaLabel: `Claimed: ${claimed.toFixed(2)} ${asset} (${claimedPct.toFixed(1)}%)`,
      },
      {
        key: "vested",
        widthPct: vestedPct,
        label: "Vested (unclaimed)",
        bg: "var(--vesting-vested, #3b82f6)",
        ariaLabel: `Vested unclaimed: ${vestedUnclaimed.toFixed(2)} ${asset} (${vestedPct.toFixed(1)}%)`,
      },
      {
        key: "unvested",
        widthPct: unvestedPct,
        label: "Unvested",
        bg: "var(--vesting-unvested, #e5e7eb)",
        ariaLabel: `Unvested: ${unvested.toFixed(2)} ${asset} (${unvestedPct.toFixed(1)}%)`,
      },
    ],
    [claimedPct, vestedPct, unvestedPct, claimed, vestedUnclaimed, unvested, asset],
  );

  // ── Tooltip lines ──────────────────────────────────────────────────────
  const tooltipLines = useMemo(() => {
    const lines = [
      `✓ Claimed: ${claimed.toFixed(2)} ${asset}`,
      `◉ Vested (unclaimed): ${vestedUnclaimed.toFixed(2)} ${asset}`,
      `○ Unvested: ${unvested.toFixed(2)} ${asset}`,
    ];
    if (cliffData) {
      lines.push(
        `📍 Cliff: ${cliffData.cliffDate}${cliffData.hasReachedCliff ? " ✓" : ""}`,
      );
    }
    return lines;
  }, [claimed, vestedUnclaimed, unvested, asset, cliffData]);

  // ── Event handlers ─────────────────────────────────────────────────────
  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const relX = e.clientX - rect.left;
    setTooltip({ visible: true, x: relX, lines: tooltipLines });
  }

  function handleMouseLeave() {
    setTooltip((prev) => ({ ...prev, visible: false }));
  }

  // ── Accessibility label for the whole bar ──────────────────────────────
  const ariaValueText = `${stream.progress.percentComplete.toFixed(1)}% vested. Claimed: ${claimed.toFixed(2)} ${asset}, Vested unclaimed: ${vestedUnclaimed.toFixed(2)} ${asset}, Unvested: ${unvested.toFixed(2)} ${asset}.`;

  return (
    <div className={`vesting-bar ${className}`.trim()}>
      {/* Cliff pin lives above the track */}
      {cliffData && (
        <div className="vesting-bar__cliff-row" aria-hidden="true">
          <InlineCliff {...cliffData} />
        </div>
      )}

      {/* Track */}
      <div
        ref={containerRef}
        className="vesting-bar__track"
        role="img"
        aria-label={ariaValueText}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {segments.map((seg) =>
          seg.widthPct > 0 ? (
            <div
              key={seg.key}
              className={`vesting-bar__segment vesting-bar__segment--${seg.key}`}
              style={{ width: `${seg.widthPct}%`, background: seg.bg }}
              aria-label={seg.ariaLabel}
            />
          ) : null,
        )}

        <Tooltip visible={tooltip.visible} x={tooltip.x} lines={tooltipLines} />
      </div>

      {/* Screen-reader summary (visually hidden) */}
      <span className="sr-only">{ariaValueText}</span>

      {/* Legend */}
      <div className="vesting-bar__legend" aria-hidden="true">
        <span className="vesting-bar__legend-item vesting-bar__legend-item--claimed">
          Claimed
        </span>
        <span className="vesting-bar__legend-item vesting-bar__legend-item--vested">
          Vested
        </span>
        <span className="vesting-bar__legend-item vesting-bar__legend-item--unvested">
          Unvested
        </span>
      </div>
    </div>
  );
}
