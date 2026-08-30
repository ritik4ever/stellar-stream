interface VestingBarProps {
  totalAmount: number;
  vestedAmount: number;
  assetCode?: string;
  startTime: number; // unix seconds
  endTime: number;   // unix seconds
}

export function VestingBar({
  totalAmount,
  vestedAmount,
  assetCode = "XLM",
  startTime,
  endTime,
}: VestingBarProps) {
  const percent = totalAmount > 0
    ? Math.min(100, Math.max(0, (vestedAmount / totalAmount) * 100))
    : 0;

  const isComplete = percent >= 100;
  const now = Math.floor(Date.now() / 1000);
  const isNotStarted = now < startTime;

  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm font-medium text-gray-700">
          {isComplete ? "Fully vested" : isNotStarted ? "Not started" : "Vesting"}
        </span>
        <span className="text-sm text-gray-500">
          {vestedAmount.toLocaleString()} / {totalAmount.toLocaleString()} {assetCode}
        </span>
      </div>
      <div
        className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            isComplete ? "bg-green-500" : "bg-blue-600"
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-1 text-xs text-gray-400">
        {Math.round(percent)}% vested
      </div>
    </div>
  );
}