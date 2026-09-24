import { VISUAL_FROZEN_MS, VISUAL_FROZEN_UNIX } from "../constants";

export const MOCK_STREAM_ID = "stream-001";

export const MOCK_SENDER =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

export const MOCK_RECIPIENT =
  "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGUE2DSNHKX4OEUZMPGQK24";

const DAY_MS = 24 * 60 * 60 * 1000;

export const mockStream = {
  id: MOCK_STREAM_ID,
  sender: MOCK_SENDER,
  recipient: MOCK_RECIPIENT,
  assetCode: "USDC",
  totalAmount: 1000,
  durationSeconds: 86_400,
  startAt: VISUAL_FROZEN_UNIX - 43_200,
  createdAt: VISUAL_FROZEN_UNIX - 86_400,
  cliffSeconds: 3600,
  progress: {
    status: "active" as const,
    ratePerSecond: 0.011574,
    elapsedSeconds: 43_200,
    vestedAmount: 500,
    remainingAmount: 500,
    percentComplete: 50,
  },
};

export const mockStreamsPage = {
  data: [mockStream],
  total: 1,
  page: 1,
  limit: 20,
};

export const mockEvents = [
  {
    id: 1,
    streamId: MOCK_STREAM_ID,
    eventType: "created" as const,
    timestamp: VISUAL_FROZEN_UNIX - 86_400,
    actor: MOCK_SENDER,
    amount: 1000,
  },
  {
    id: 2,
    streamId: MOCK_STREAM_ID,
    eventType: "claimed" as const,
    timestamp: VISUAL_FROZEN_UNIX - 3600,
    actor: MOCK_RECIPIENT,
    amount: 100,
    txHash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab",
  },
];

export const mockOpenIssues = [
  {
    id: "issue-781",
    title: "Add visual regression tests",
    labels: ["testing", "frontend"],
    summary: "Baseline screenshots for dashboard, stream detail, create form, and timeline.",
    complexity: "Medium" as const,
    points: 150 as const,
  },
];

export const mockMetricsHistory = Array.from({ length: 7 }, (_, index) => ({
  timestamp: VISUAL_FROZEN_MS - (6 - index) * DAY_MS,
  active: 4 + index,
  completed: 2 + index,
  vested: 200 + index * 50,
}));

export const mockStats = {
  total_streams: 1,
  active_streams: 1,
  completed_streams: 0,
  canceled_streams: 0,
  total_vested: 500,
  avg_duration_seconds: 86_400,
  unique_senders: 1,
  unique_recipients: 1,
};

export const mockConfig = {
  allowedAssets: ["USDC", "XLM"],
};
