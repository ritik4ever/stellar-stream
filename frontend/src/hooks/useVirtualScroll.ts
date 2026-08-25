import { useState, useCallback } from "react";
export function useVirtualScroll(count: number, h = 72, vh = 600) {
  const [st, setSt] = useState(0);
  return { start: Math.max(0, Math.floor(st / h) - 2), count: Math.ceil(vh / h) + 3, onScroll: useCallback((e: any) => setSt(e.target.scrollTop), []), total: count * h };
}
