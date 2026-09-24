import { useEffect, useState } from "react";

interface VestingClockProps {
  endTime: number; // unix seconds — when vesting completes
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "Complete";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function VestingClock({ endTime }: VestingClockProps) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, 1000 * 30); // tick every 30s, no need for per-second churn
    return () => clearInterval(interval);
  }, []);

  const remaining = endTime - now;
  const isComplete = remaining <= 0;

  return (
    <div className="flex items-center gap-2">
      <span className="text-lg" aria-hidden>
        {isComplete ? "✅" : "⏳"}
      </span>
      <div>
        <p className="text-sm font-medium text-gray-700">
          {isComplete ? "Vesting complete" : "Time remaining"}
        </p>
        {!isComplete && (
          <p className="text-xs text-gray-500">{formatDuration(remaining)}</p>
        )}
      </div>
    </div>
  );
}