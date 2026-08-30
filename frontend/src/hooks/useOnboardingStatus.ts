import { useEffect, useState } from "react";
import { listStreams, listAllEvents } from "../services/api";
import type { FreighterState } from "./useFreighter";

export interface OnboardingStatus {
  walletConnected: boolean;
  streamCreated: boolean;
  progressMonitored: boolean;
  tokensClaimed: boolean;
  loading: boolean;
}

const VISITED_DASHBOARD_KEY = "onboarding:visitedDashboard";

export function markDashboardVisited() {
  localStorage.setItem(VISITED_DASHBOARD_KEY, "true");
}

export function useOnboardingStatus(wallet: FreighterState): OnboardingStatus {
  const [streamCreated, setStreamCreated] = useState(false);
  const [tokensClaimed, setTokensClaimed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [progressMonitored, setProgressMonitored] = useState(
    () => localStorage.getItem(VISITED_DASHBOARD_KEY) === "true"
  );

  useEffect(() => {
    if (!wallet.address) {
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);

    (async () => {
      try {
        const [sent, events] = await Promise.all([
          listStreams({ sender: wallet.address! }),
          listAllEvents(),
        ]);
        if (!active) return;
        setStreamCreated(sent.data.length > 0);
        setTokensClaimed(
          events.some(
            (e) => e.eventType === "claimed" && e.actor === wallet.address
          )
        );
      } catch {
        // Best-effort — leave steps unchecked if we can't verify.
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [wallet.address]);

  // Re-check localStorage flag whenever storage changes (e.g. another tab/route).
  useEffect(() => {
    const check = () =>
      setProgressMonitored(localStorage.getItem(VISITED_DASHBOARD_KEY) === "true");
    window.addEventListener("storage", check);
    return () => window.removeEventListener("storage", check);
  }, []);

  return {
    walletConnected: wallet.status === "connected",
    streamCreated,
    progressMonitored,
    tokensClaimed,
    loading,
  };
}