import { useEffect, useRef, useState } from "react";

export interface MetricsSnapshot {
  timestamp: number;
  active: number;
  completed: number;
  vested: number;
}

const MAX_HISTORY_POINTS = 20;

export function useMetricsHistory(
  active: number,
  completed: number,
  vested: number,
  updateIntervalMs = 5000,
) {
  const [history, setHistory] = useState<MetricsSnapshot[]>([]);
  const lastUpdateRef = useRef<number>(0);

  useEffect(() => {
    const now = Date.now();

    if (now - lastUpdateRef.current < updateIntervalMs) {
      return;
    }

    lastUpdateRef.current = now;

    setHistory((prev) => {
      const snapshot: MetricsSnapshot = {
        timestamp: now,
        active,
        completed,
        vested,
      };

      const updated = [...prev, snapshot];

      if (updated.length > MAX_HISTORY_POINTS) {
        return updated.slice(updated.length - MAX_HISTORY_POINTS);
      }

      return updated;
    });
  }, [active, completed, vested, updateIntervalMs]);

  return history;
}
