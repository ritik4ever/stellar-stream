import type { Request } from "express";
import { logger } from "../logger";

/**
 * Detects query keys that the given endpoint does not recognize, and emits a
 * structured `stream_search_unsupported_filter` warning so operators can
 * distinguish a request that carried unsupported filter input from a normal
 * empty result.
 *
 * The behavior of the endpoint is intentionally unchanged: unsupported keys
 * are still ignored. Only observability is added.
 *
 * Only the key names are logged. Values are never logged because arbitrary
 * query string values may contain credentials or wallet secrets (see issue
 * #1052 / batch SSB-2026-109).
 *
 * @returns the list of unsupported keys (useful for tests and callers).
 */
export function reportUnsupportedQueryFilters(
  req: Pick<Request, "query">,
  endpoint: string,
  allowedKeys: ReadonlySet<string>,
): string[] {
  const unsupported: string[] = [];
  for (const key of Object.keys(req.query)) {
    if (!allowedKeys.has(key)) {
      unsupported.push(key);
    }
  }

  if (unsupported.length > 0) {
    // correlation_id is injected automatically by the logger formatter from
    // AsyncLocalStorage, and matches the request-completed line's
    // correlation_id (and the X-Correlation-ID response header).
    logger.warn(
      {
        event: "stream_search_unsupported_filter",
        endpoint,
        unsupportedFilters: unsupported,
        outcome: "ignored",
      },
      "ignored unsupported query filter(s)",
    );
  }

  return unsupported;
}
