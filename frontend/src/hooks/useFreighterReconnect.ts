import { useEffect, useCallback } from "react";

export function useFreighterReconnect(onConnect: (key: string) => void) {
  const reconnect = useCallback(async () => {
    try {
      const freighter = (window as any).freighterApi;
      if (freighter) {
        const key = await freighter.getPublicKey();
        onConnect(key);
      }
    } catch { /* wallet not available */ }
  }, [onConnect]);

  useEffect(() => {
    reconnect();
    window.addEventListener("focus", reconnect);
    return () => window.removeEventListener("focus", reconnect);
  }, [reconnect]);

  return reconnect;
}
