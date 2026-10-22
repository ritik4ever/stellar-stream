import { archiveOldStreams } from "./streamStore";
import { logger } from "../logger";

let archiveInterval: NodeJS.Timeout | null = null;
let archiveInFlight = false;

async function runArchiveCycle(): Promise<void> {
  if (archiveInFlight) {
    logger.warn("skipping archive cycle because a previous run is still in progress");
    return;
  }

  archiveInFlight = true;
  try {
    const archived = await archiveOldStreams();
    if (archived > 0) {
      logger.info({ archived }, "archived old streams");
    }
  } finally {
    archiveInFlight = false;
  }
}


export function startArchiveJob(intervalMs = 86400000): void {
  if (archiveInterval) {
    return;
  }

  logger.info({ intervalMs }, "archive job started");

  archiveInterval = setInterval(() => {
    runArchiveCycle().catch((err) => {
      logger.error({ err }, "archive job cycle failed");
    });
  }, intervalMs);

  runArchiveCycle().catch((err) => {
    logger.error({ err }, "initial archive cycle failed");
  });
}

export function stopArchiveJob(): void {
  if (!archiveInterval) {
    return;
  }

  clearInterval(archiveInterval);
  archiveInterval = null;
  logger.info("archive job stopped");
}
