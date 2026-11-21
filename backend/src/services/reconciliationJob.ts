import { reconcileMissingStreams, getOnChainStreamCount } from "./streamStore";
import { getDb } from "./db";
import { logger } from "../logger";

let reconciliationInterval: NodeJS.Timeout | null = null;
let reconciliationInFlight = false;

async function runReconciliationCycle(): Promise<void> {
  if (reconciliationInFlight) {
    logger.warn("skipping reconciliation cycle because a previous run is still in progress");
    return;
  }

  reconciliationInFlight = true;
  try {
    await reconcileMissingStreams();
    await checkStreamCountDiscrepancy();
  } catch (err) {
    logger.error({ err }, "reconciliation cycle encountered an error");
    throw err;
  } finally {
    reconciliationInFlight = false;
  }
}

async function checkStreamCountDiscrepancy(): Promise<void> {
  try {
    const onChainCount = await getOnChainStreamCount();
    if (onChainCount === null) return;

    const db = getDb();
    const row = db.prepare("SELECT COUNT(*) AS total FROM streams").get() as { total: number } | undefined;
    const localCount = row?.total ?? 0;

    if (onChainCount !== localCount) {
      logger.warn(
        { onChainStreamCount: onChainCount, localStreamCount: localCount },
        "stream count discrepancy detected between on-chain and local database",
      );
    }
  } catch (err) {
    logger.warn({ err }, "failed to check stream count discrepancy during reconciliation cycle");
  }
}

export function startReconciliationJob(intervalMs = 60000): void {
  if (reconciliationInterval) {
    return;
  }

  logger.info({ intervalMs }, "reconciliation job started");

  reconciliationInterval = setInterval(() => {
    runReconciliationCycle().catch((err) => {
      logger.error({ err }, "reconciliation job cycle failed");
    });
  }, intervalMs);

  runReconciliationCycle().catch((err) => {
    logger.error({ err }, "initial reconciliation failed");
  });
}

export function stopReconciliationJob(): void {
  if (!reconciliationInterval) {
    return;
  }

  clearInterval(reconciliationInterval);
  reconciliationInterval = null;
  logger.info("reconciliation job stopped");
}
