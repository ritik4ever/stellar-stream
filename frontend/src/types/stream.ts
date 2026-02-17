export type StreamStatus = "scheduled" | "active" | "completed" | "canceled";

export interface StreamProgress {
  status: StreamStatus;
  ratePerSecond: number;
  elapsedSeconds: number;
  vestedAmount: number;
  remainingAmount: number;
  percentComplete: number;
}

export interface Stream {
  id: string;
  sender: string;
  recipient: string;
  assetCode: string;
  totalAmount: number;
  durationSeconds: number;
  startAt: number;
  createdAt: number;
  canceledAt?: number;
  progress: StreamProgress;
}

export interface CreateStreamPayload {
  sender: string;
  recipient: string;
  assetCode: string;
  totalAmount: number;
  durationSeconds: number;
  startAt?: number;
}

export interface OpenIssue {
  id: string;
  title: string;
  labels: string[];
  summary: string;
  complexity: "Trivial" | "Medium" | "High";
  points: 100 | 150 | 200;
}
