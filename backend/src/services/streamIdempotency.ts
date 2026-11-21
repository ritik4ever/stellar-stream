import type { StreamRecord } from "./streamStore";

const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000; // 5 minutes retention
const inFlightKeys = new Set<string>();
const idempotentResponses = new Map<
  string,
  { stream: StreamRecord; timestamp: number }
>();

export function getIdempotentStream(key: string): StreamRecord | null {
  const entry = idempotentResponses.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > IDEMPOTENCY_TTL_MS) {
    idempotentResponses.delete(key);
    return null;
  }
  return entry.stream;
}

export function storeIdempotentStream(
  key: string,
  stream: StreamRecord,
): void {
  idempotentResponses.set(key, { stream, timestamp: Date.now() });
}

export function isInFlightStreamCreation(key: string): boolean {
  return inFlightKeys.has(key);
}

export function markStreamCreationInFlight(key: string): void {
  inFlightKeys.add(key);
}

export function clearStreamCreationInFlight(key: string): void {
  inFlightKeys.delete(key);
}

export function resetStreamIdempotencyForTesting(): void {
  inFlightKeys.clear();
  idempotentResponses.clear();
}
