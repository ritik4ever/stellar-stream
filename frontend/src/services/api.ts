import { CreateStreamPayload, OpenIssue, Stream } from "../types/stream";

const API_BASE = import.meta.env.VITE_API_URL ?? "/api";

async function parseResponse<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? "Unexpected API error");
  }
  return body;
}

export async function listStreams(): Promise<Stream[]> {
  const response = await fetch(`${API_BASE}/streams`);
  const body = await parseResponse<{ data: Stream[] }>(response);
  return body.data;
}

export function getExportCsvUrl(filters?: Record<string, string>): string {
  // If API_BASE is absolute (e.g. http://localhost:3000/api), we use that directly.
  // Otherwise, we base it off window.location.origin
  const base = API_BASE.startsWith("http") ? API_BASE : window.location.origin + API_BASE;
  const url = new URL(`${base}/streams/export.csv`);
  if (filters) {
    Object.entries(filters).forEach(([k, v]) => {
      if (v) url.searchParams.append(k, v);
    });
  }
  return url.toString();
}

export async function createStream(payload: CreateStreamPayload): Promise<Stream> {
  const response = await fetch(`${API_BASE}/streams`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await parseResponse<{ data: Stream }>(response);
  return body.data;
}

export async function cancelStream(streamId: string): Promise<Stream> {
  const response = await fetch(`${API_BASE}/streams/${streamId}/cancel`, {
    method: "POST",
  });
  const body = await parseResponse<{ data: Stream }>(response);
  return body.data;
}

export async function updateStreamStartAt(
  streamId: string,
  startAt: number,
): Promise<Stream> {
  const response = await fetch(`${API_BASE}/streams/${streamId}/start-time`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
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
