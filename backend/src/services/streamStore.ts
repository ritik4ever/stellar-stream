export type StreamStatus = "scheduled" | "active" | "completed" | "canceled";

export interface StreamInput {
  sender: string;
  recipient: string;
  assetCode: string;
  totalAmount: number;
  durationSeconds: number;
  startAt?: number;
}

export interface StreamRecord {
  id: string;
  sender: string;
  recipient: string;
  assetCode: string;
  totalAmount: number;
  durationSeconds: number;
  startAt: number;
  createdAt: number;
  canceledAt?: number;
}

export interface StreamProgress {
  status: StreamStatus;
  ratePerSecond: number;
  elapsedSeconds: number;
  vestedAmount: number;
  remainingAmount: number;
  percentComplete: number;
}

let sequence = 0;
const streams = new Map<string, StreamRecord>();

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

function computeStatus(stream: StreamRecord, at: number): StreamStatus {
  if (stream.canceledAt !== undefined) {
    return "canceled";
  }

  if (at < stream.startAt) {
    return "scheduled";
  }

  if (at >= stream.startAt + stream.durationSeconds) {
    return "completed";
  }

  return "active";
}

export function calculateProgress(stream: StreamRecord, at = nowInSeconds()): StreamProgress {
  const streamEnd = stream.startAt + stream.durationSeconds;
  const effectiveEnd = stream.canceledAt !== undefined ? Math.min(stream.canceledAt, streamEnd) : streamEnd;
  const elapsed = Math.max(0, Math.min(at, effectiveEnd) - stream.startAt);
  const ratio = Math.min(1, elapsed / stream.durationSeconds);
  const vestedAmount = stream.totalAmount * ratio;

  return {
    status: computeStatus(stream, at),
    ratePerSecond: round(stream.totalAmount / stream.durationSeconds),
    elapsedSeconds: elapsed,
    vestedAmount: round(vestedAmount),
    remainingAmount: round(Math.max(0, stream.totalAmount - vestedAmount)),
    percentComplete: round(ratio * 100),
  };
}

export function createStream(input: StreamInput): StreamRecord {
  const startAt = input.startAt ?? nowInSeconds();
  sequence += 1;

  const stream: StreamRecord = {
    id: `stream-${sequence}`,
    sender: input.sender,
    recipient: input.recipient,
    assetCode: input.assetCode.toUpperCase(),
    totalAmount: input.totalAmount,
    durationSeconds: input.durationSeconds,
    startAt,
    createdAt: nowInSeconds(),
  };

  streams.set(stream.id, stream);
  return stream;
}

export function listStreams(): StreamRecord[] {
  return Array.from(streams.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function getStream(id: string): StreamRecord | undefined {
  return streams.get(id);
}

export function cancelStream(id: string): StreamRecord | undefined {
  const stream = streams.get(id);
  if (!stream || stream.canceledAt !== undefined) {
    return stream;
  }

  stream.canceledAt = nowInSeconds();
  streams.set(id, stream);
  return stream;
}
