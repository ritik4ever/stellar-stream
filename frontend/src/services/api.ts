import { CreateStreamPayload, OpenIssue, Stream } from "../types/stream";

type CacheEntry<T> = {
  data: T;
  timestamp: number;
  promise?: Promise<T>; // prevents duplicate fetches
};

const cache = new Map<string, CacheEntry<any>>();

const DEFAULT_STALE_AFTER_MS = 4000;

const API_BASE = import.meta.env.VITE_API_URL ?? "/api";

export function getWebSocketUrl(): string {
  // Construct WebSocket URL from API base URL
  const apiUrl = import.meta.env.VITE_API_URL || window.location.origin + "/api";
  const wsProtocol = apiUrl.startsWith("https") ? "wss" : "ws";
  const wsUrl = apiUrl.replace(/^https?:\/\//, "").replace(/\/api$/, "");
  return `${wsProtocol}://${wsUrl}/api/ws`;
}

let authToken: string | null = null;
export function setAuthToken(token: string | null) {
  authToken = token;
}
export function getAuthToken(): string | null {
  return authToken;
}

export class ApiError extends Error {
  statusCode: number;
  details?: unknown;

  constructor(message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const rawBody = await response.text();
  let body: Record<string, unknown> = {};
  if (rawBody) {
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      body = { message: rawBody };
    }
  }

  if (!response.ok) {
    if (response.status === 401) {
      setAuthToken(null);
    }
    const message =
      (body.error as string | undefined) ??
      (body.message as string | undefined) ??
      "Unexpected API error";
    throw new ApiError(message, response.status, body);
  }

  return body as T;
}

async function fetchWithCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  staleAfterMs: number = DEFAULT_STALE_AFTER_MS
): Promise<T> {
  const now = Date.now();
  const cached = cache.get(key);

  // ✅ Fresh cache → return immediately
  if (cached && now - cached.timestamp < staleAfterMs) {
    return cached.data;
  }

  // ✅ Stale cache → return immediately + refresh in background
  if (cached) {
    if (!cached.promise) {
      cached.promise = fetcher()
        .then((freshData) => {
          cache.set(key, {
            data: freshData,
            timestamp: Date.now(),
          });
          return freshData;
        })
        .finally(() => {
          const updated = cache.get(key);
          if (updated) delete updated.promise;
        });
    }

    return cached.data;
  }

  // ❗ No cache → fetch normally
  const promise = fetcher();
  const data = await promise;

  cache.set(key, {
    data,
    timestamp: now,
  });

  return data;
}


export interface ListStreamsFilters {
  recipient?: string;
  sender?: string;
  status?: string;
  asset?: string;
  q?: string;
  sort?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export async function listStreams(filters?: ListStreamsFilters): Promise<PaginatedResult<Stream>> {
  const params = new URLSearchParams();
  if (filters?.recipient) params.set("recipient", filters.recipient);
  if (filters?.sender) params.set("sender", filters.sender);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.asset) params.set("asset", filters.asset);
  if (filters?.q) params.set("q", filters.q);
  if (filters?.sort) params.set("sort", filters.sort);
  if (filters?.page) params.set("page", String(filters.page));
  if (filters?.limit) params.set("limit", String(filters.limit));

  const q = params.toString();
  const url = q ? `${API_BASE}/streams?${q}` : `${API_BASE}/streams`;

  const response = await fetch(url);
  const body = await parseResponse<{ data: Stream[]; total: number; page: number; limit: number }>(response);
  return body;
}

export async function listRecipientStreams(accountId: string): Promise<Stream[]> {
  const response = await fetch(`${API_BASE}/recipients/${accountId}/streams`);
  const body = await parseResponse<{ data: Stream[] }>(response);
  return body.data;
}

export function getExportCsvUrl(filters?: Record<string, string>): string {
  // If API_BASE is absolute (e.g. http://localhost:3000/api), we use that directly.
  // Otherwise, we base it off window.location.origin
  const base = API_BASE.startsWith("http")
    ? API_BASE
    : window.location.origin + API_BASE;
  const url = new URL(`${base}/streams/export.csv`);
  if (filters) {
    Object.entries(filters).forEach(([k, v]) => {
      if (v) url.searchParams.append(k, v);
    });
  }
  return url.toString();
}

export async function createStream(
  payload: CreateStreamPayload,
): Promise<Stream> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const response = await fetch(`${API_BASE}/streams`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const body = await parseResponse<{ data: Stream }>(response);
  return body.data;
}

export interface StreamFeeEstimate {
  feeStroops: number;
  feeXlm: string;
}

export async function estimateCreateStreamFee(
  payload: CreateStreamPayload,
): Promise<StreamFeeEstimate> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const response = await fetch(`${API_BASE}/streams/fee-estimate`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const body = await parseResponse<{ data: StreamFeeEstimate }>(response);
  return body.data;
}

export async function cancelStream(streamId: string): Promise<Stream> {
  const headers: Record<string, string> = {};
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const response = await fetch(`${API_BASE}/streams/${streamId}/cancel`, {
    method: "POST",
    headers,
  });
  const body = await parseResponse<{ data: Stream }>(response);
  return body.data;
}

export async function pauseStream(streamId: string): Promise<Stream> {
  const headers: Record<string, string> = {};
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const response = await fetch(`${API_BASE}/streams/${streamId}/pause`, {
    method: "POST",
    headers,
  });
  const body = await parseResponse<{ data: Stream }>(response);
  return body.data;
}

export async function resumeStream(streamId: string): Promise<Stream> {
  const headers: Record<string, string> = {};
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const response = await fetch(`${API_BASE}/streams/${streamId}/resume`, {
    method: "POST",
    headers,
  });
  const body = await parseResponse<{ data: Stream }>(response);
  return body.data;
}

export async function updateStreamStartAt(
  streamId: string,
  startAt: number,
): Promise<Stream> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const response = await fetch(`${API_BASE}/streams/${streamId}/start-time`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ startAt }),
  });
  const body = await parseResponse<{ data: Stream }>(response);
  return body.data;
}

export async function listOpenIssues(): Promise<OpenIssue[]> {
  const response = await fetch(`${API_BASE}/open-issues`);
  const body = await parseResponse<{ data: OpenIssue[] }>(response);
  return body.data;
}

export interface StreamEvent {
  id: number;
  streamId: string;
  eventType: "created" | "claimed" | "canceled" | "start_time_updated" | "paused" | "resumed" | "cliff_reached";
  timestamp: number;
  actor?: string;
  amount?: number;
  txHash?: string;
  metadata?: Record<string, any>;
}

export async function getStreamHistory(streamId: string, signal?: AbortSignal): Promise<StreamEvent[]> {
  const response = await fetch(`${API_BASE}/streams/${streamId}/history`, { signal });
  const body = await parseResponse<{ data: StreamEvent[] }>(response);
  return body.data;
}

export async function listAllEvents(): Promise<StreamEvent[]> {
  const response = await fetch(`${API_BASE}/events`);
  const body = await parseResponse<{ data: StreamEvent[] }>(response);
  return body.data;
}



export interface MetricsHistoryParams {
  startTimestamp: number;
  endTimestamp: number;
}

export async function fetchMetricsHistory(params: MetricsHistoryParams): Promise<any[]> {
  const searchParams = new URLSearchParams({
    start: params.startTimestamp.toString(),
    end: params.endTimestamp.toString(),
  });

  const response = await fetch(`${API_BASE}/metrics/history?${searchParams}`);
  const body = await parseResponse<{ data: any[] }>(response);
  return body.data;
}

export interface StreamStats {
  total_streams: number;
  active_streams: number;
  completed_streams: number;
  canceled_streams: number;
  total_vested: number;
  avg_duration_seconds: number;
  unique_senders: number;
  unique_recipients: number;
}

export async function fetchStats(): Promise<StreamStats> {
  const response = await fetch(`${API_BASE}/stats`);
  const body = await parseResponse<{ data: StreamStats }>(response);
  return body.data;
}
export async function getStream(streamId: string, signal?: AbortSignal): Promise<Stream> {
  const url = `${API_BASE}/streams/${encodeURIComponent(streamId)}`;
  if (signal) {
    const response = await fetch(url, { signal });
    const body = await parseResponse<{ data: Stream }>(response);
    return body.data;
  }
  return fetchWithCache(url, async () => {
    const response = await fetch(url);
    const body = await parseResponse<{ data: Stream }>(response);
    return body.data;
  });
}

export interface AppConfig {
  allowedAssets: string[];
}

export async function getConfig(): Promise<AppConfig> {
  const response = await fetch(`${API_BASE}/config`);
  return parseResponse<AppConfig>(response);
}

/**
 * Fetches recent events for a sender across all their streams.
 * Aggregates events from all sender's streams and returns them sorted by timestamp (newest first).
 * 
 * @param senderAddress - The sender's wallet address
 * @param limit - Maximum number of events to return (default: 10)
 * @returns Array of StreamEvents sorted by timestamp descending
 */
export async function getSenderEvents(senderAddress: string, limit: number = 10): Promise<StreamEvent[]> {
  try {
    // First get all streams for the sender
    const streamsResult = await listStreams({ sender: senderAddress });
    const streams = streamsResult.data;

    if (streams.length === 0) {
      return [];
    }

    // Fetch events from each stream
    const allEvents: StreamEvent[] = [];
    const eventPromises = streams.map((stream) =>
      getStreamHistory(stream.id)
        .then((events) => allEvents.push(...events))
        .catch(() => {
          // Silent fail on individual stream event fetch
        })
    );

    await Promise.all(eventPromises);

    // Sort by timestamp descending (most recent first) and limit
    return allEvents
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  } catch {
    return [];
  }
}

export function clearCache() {
  cache.clear();
}


