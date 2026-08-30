import { useMemo } from "react";

interface CliffMarkerProps {
  startAt: number;
  cliffSeconds: number;
  durationSeconds: number;
  now: number;
}

export function CliffMarker({ startAt, cliffSeconds, durationSeconds, now }: CliffMarkerProps) {
  const cliffTimestamp = startAt + cliffSeconds;

  const cliffDate = useMemo(() => {
    return new Date(cliffTimestamp * 1000).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }, [cliffTimestamp]);

  if (cliffSeconds === 0 || cliffSeconds === undefined) {
    return null;
  }

  const cliffPercentage = (cliffSeconds / durationSeconds) * 100;
  const hasReachedCliff = now >= cliffTimestamp;

  const cliffDaysFromStart = Math.ceil(cliffSeconds / (24 * 3600));

  return (
    <div className="cliff-marker-container" style={{ position: "relative", width: "100%" }}>
      <div
        className={`cliff-marker ${hasReachedCliff ? "cliff-reached" : "cliff-pending"}`}
        style={{
          position: "absolute",
          left: `${cliffPercentage}%`,
          top: "-20px",
          transform: "translateX(-50%)",
          width: "2px",
          height: "8px",
          backgroundColor: hasReachedCliff ? "#10b981" : "#f59e0b",
          transition: "background-color 0.3s ease",
        }}
        title={`Cliff reached on ${cliffDate} (${cliffDaysFromStart} days from start)`}
      />
      <div
        className="cliff-label"
        style={{
          position: "absolute",
          left: `${cliffPercentage}%`,
          top: "-32px",
          transform: "translateX(-50%)",
          fontSize: "0.75rem",
          fontWeight: "500",
          color: hasReachedCliff ? "#10b981" : "#f59e0b",
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}
      >
        📍
      </div>
    </div>
  );
}
