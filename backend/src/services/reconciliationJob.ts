import { reconcileMissingStreams } from "./streamStore";

let reconciliationInterval: NodeJS.Timeout | null = null;
let reconciliationInFlight = false;

async function runReconciliationCycle(): Promise<void> {
  if (reconciliationInFlight) {
    console.warn(
      "[reconciliation] skipping cycle because a previous run is still in progress",
    );
    return;
  }

  reconciliationInFlight = true;
  try {
    await reconcileMissingStreams();
  } finally {
    reconciliationInFlight = false;
  }
}

export function startReconciliationJob(intervalMs = 60000): void {
  if (reconciliationInterval) {
    return;
  }

  console.log(
    `[reconciliation] starting reconciliation job with ${intervalMs}ms interval`,
  );

  reconciliationInterval = setInterval(() => {
    runReconciliationCycle().catch((err) => {
      console.error("[reconciliation] job cycle failed:", err);
    });
  }, intervalMs);

  runReconciliationCycle().catch((err) => {
    console.error("[reconciliation] initial reconciliation failed:", err);
  });
}

export function stopReconciliationJob(): void {
  if (!reconciliationInterval) {
    return;
  }

  clearInterval(reconciliationInterval);
  reconciliationInterval = null;
  console.log("[reconciliation] reconciliation job stopped");
}
