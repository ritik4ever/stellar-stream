export interface VestingBarProps {
  percentComplete: number;
  vestedAmount?: number;
  totalAmount?: number;
  remainingAmount?: number;
  assetCode?: string;
  status?: string;
  label?: string;
  className?: string;
}

export function VestingBar({
  percentComplete,
  vestedAmount,
  totalAmount,
  remainingAmount,
  assetCode,
  status,
  label = "Vesting progress",
  className = "",
}: VestingBarProps) {
  const clampedPercent = Number.isFinite(percentComplete)
    ? Math.min(100, Math.max(0, percentComplete))
    : 0;

  const valueTextParts = [`${clampedPercent}% complete`];
  if (vestedAmount !== undefined && assetCode) {
    valueTextParts.push(`${vestedAmount} ${assetCode} vested`);
  }
  if (remainingAmount !== undefined && assetCode) {
    valueTextParts.push(`${Math.max(0, remainingAmount)} ${assetCode} remaining`);
  }

  return (
    <div className={`vesting-bar ${className}`.trim()} data-testid="vesting-bar">
      {(vestedAmount !== undefined || totalAmount !== undefined || status) && (
        <div className="vesting-bar__header">
          <span className="vesting-bar__percent">{clampedPercent.toFixed(2)}%</span>
          {vestedAmount !== undefined && totalAmount !== undefined && assetCode && (
            <span className="vesting-bar__amounts muted">
              {vestedAmount} / {totalAmount} {assetCode} vested
            </span>
          )}
          {status && <span className={`badge badge-${status}`}>{status}</span>}
        </div>
      )}
      <div
        className="progress-bar"
        role="progressbar"
        aria-label={label}
        aria-valuenow={clampedPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={valueTextParts.join(", ")}
      >
        <div style={{ width: `${clampedPercent}%` }} />
      </div>
    </div>
  );
}
