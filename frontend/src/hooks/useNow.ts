import { useEffect, useState } from "react";

/**
 * Returns the current unix time in seconds and updates it on a fixed
 * interval, enabling live countdown/progress ticking (vesting clock).
 *
 * @param intervalMs - How often to refresh the timestamp (default 1s).
 * @returns Current unix time in seconds.
 */
export function useNow(intervalMs: number = 1000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      intervalMs,
    );
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
