import { logger } from "../logger";
import { pruneDeadLettersOlderThan } from "./webhook";

export const DEAD_LETTER_RETENTION_SECONDS = 30 * 24 * 60 * 60;
export const DEFAULT_DEAD_LETTER_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

let pruningInterval: NodeJS.Timeout | null = null;

export function runDeadLetterPruningCycle(
  nowSeconds = Math.floor(Date.now() / 1000),
): number {
  const cutoffTimestamp = nowSeconds - DEAD_LETTER_RETENTION_SECONDS;
  const pruned = pruneDeadLettersOlderThan(cutoffTimestamp);
  logger.info({ pruned, cutoffTimestamp }, "webhook dead-letter pruning cycle completed");
  return pruned;
}

export function startDeadLetterPruningJob(
  intervalMs = DEFAULT_DEAD_LETTER_PRUNE_INTERVAL_MS,
): void {
  if (pruningInterval) return;

  logger.info(
    { intervalMs, retentionDays: 30 },
    "webhook dead-letter pruning job started",
  );

  try {
    runDeadLetterPruningCycle();
  } catch (err) {
    logger.error({ err }, "initial webhook dead-letter pruning cycle failed");
  }

  pruningInterval = setInterval(() => {
    try {
      runDeadLetterPruningCycle();
    } catch (err) {
      logger.error({ err }, "webhook dead-letter pruning cycle failed");
    }
  }, intervalMs);
}

export function stopDeadLetterPruningJob(): void {
  if (!pruningInterval) return;
  clearInterval(pruningInterval);
  pruningInterval = null;
  logger.info("webhook dead-letter pruning job stopped");
}