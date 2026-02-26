import { beforeEach, describe, expect, it, vi } from "vitest";

const streamStoreMocks = vi.hoisted(() => ({
  calculateProgress: vi.fn(),
  cancelStream: vi.fn(),
  createStream: vi.fn(),
  getStream: vi.fn(),
  initSoroban: vi.fn(),
  listStreams: vi.fn(),
  syncStreams: vi.fn(),
  updateStreamStartAt: vi.fn(),
}));

vi.mock("./services/streamStore", () => streamStoreMocks);

import { app } from "./index";

type TestStream = {
  id: string;
  sender: string;
  recipient: string;
  assetCode: string;
  totalAmount: number;
  durationSeconds: number;
  startAt: number;
  createdAt: number;
  canceledAt?: number;
  completedAt?: number;
};

type TestProgress = {
  status: "scheduled" | "active" | "completed" | "canceled";
  ratePerSecond: number;
  elapsedSeconds: number;
  vestedAmount: number;
  remainingAmount: number;
  percentComplete: number;
};

const streams: TestStream[] = [
  {
    id: "4",
    sender: "GSENDERAAAA",
    recipient: "GRECIPIENT111",
    assetCode: "USDC",
    totalAmount: 100,
    durationSeconds: 100,
    startAt: 100,
    createdAt: 400,
  },
  {
    id: "3",
    sender: "GSENDERBBBB",
    recipient: "GRECIPIENT222",
    assetCode: "USDC",
    totalAmount: 100,
    durationSeconds: 100,
    startAt: 100,
    createdAt: 300,
    completedAt: 250,
  },
  {
    id: "2",
    sender: "GSENDERAAAA",
    recipient: "GRECIPIENT222",
    assetCode: "USDC",
    totalAmount: 100,
    durationSeconds: 100,
    startAt: 300,
    createdAt: 200,
  },
  {
    id: "1",
    sender: "GSENDERCCCC",
    recipient: "GRECIPIENT111",
    assetCode: "USDC",
    totalAmount: 100,
    durationSeconds: 100,
    startAt: 100,
    createdAt: 100,
    canceledAt: 150,
  },
];

const progressById: Record<string, TestProgress> = {
  "4": {
    status: "active",
    ratePerSecond: 1,
    elapsedSeconds: 50,
    vestedAmount: 50,
    remainingAmount: 50,
    percentComplete: 50,
  },
  "3": {
    status: "completed",
    ratePerSecond: 1,
    elapsedSeconds: 100,
    vestedAmount: 100,
    remainingAmount: 0,
    percentComplete: 100,
  },
  "2": {
    status: "scheduled",
    ratePerSecond: 1,
    elapsedSeconds: 0,
    vestedAmount: 0,
    remainingAmount: 100,
    percentComplete: 0,
  },
  "1": {
    status: "canceled",
    ratePerSecond: 1,
    elapsedSeconds: 20,
    vestedAmount: 20,
    remainingAmount: 80,
    percentComplete: 20,
  },
};

function invokeListStreamsRoute(
  query: Record<string, unknown> = {},
): { status: number; body: any } {
  const layer = (app as any)?._router?.stack?.find(
    (entry: any) => entry.route?.path === "/api/streams" && entry.route?.methods?.get,
  );

  if (!layer) {
    throw new Error("GET /api/streams route not found");
  }

  const handler = layer.route.stack[0].handle as (req: any, res: any) => void;

  let statusCode = 200;
  let jsonBody: any;

  const req = { query };
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: any) {
      jsonBody = payload;
      return this;
    },
  };

  handler(req, res);

  return { status: statusCode, body: jsonBody };
}

beforeEach(() => {
  streamStoreMocks.listStreams.mockReset();
  streamStoreMocks.calculateProgress.mockReset();
  streamStoreMocks.listStreams.mockReturnValue(streams);
  streamStoreMocks.calculateProgress.mockImplementation((stream: TestStream) => progressById[stream.id]);
});

describe("GET /api/streams", () => {
  it("returns all streams and metadata by default", () => {
    const { status, body } = invokeListStreamsRoute();

    expect(status).toBe(200);
    expect(body.total).toBe(4);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(4);
    expect(body.data.map((item: any) => item.id)).toEqual(["4", "3", "2", "1"]);
  });

  it("filters by status", () => {
    const { status, body } = invokeListStreamsRoute({ status: "active" });

    expect(status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.data.map((item: any) => item.id)).toEqual(["4"]);
  });

  it("filters by sender exact match", () => {
    const { status, body } = invokeListStreamsRoute({ sender: "GSENDERAAAA" });

    expect(status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.data.map((item: any) => item.id)).toEqual(["4", "2"]);
  });

  it("filters by recipient exact match", () => {
    const { status, body } = invokeListStreamsRoute({ recipient: "GRECIPIENT111" });

    expect(status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.data.map((item: any) => item.id)).toEqual(["4", "1"]);
  });

  it("applies combined sender + recipient + status filtering", () => {
    const { status, body } = invokeListStreamsRoute({
      sender: "GSENDERAAAA",
      recipient: "GRECIPIENT222",
      status: "scheduled",
    });

    expect(status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.data.map((item: any) => item.id)).toEqual(["2"]);
  });

  it("paginates when page and limit are provided", () => {
    const { status, body } = invokeListStreamsRoute({ page: "2", limit: "2" });

    expect(status).toBe(200);
    expect(body.total).toBe(4);
    expect(body.page).toBe(2);
    expect(body.limit).toBe(2);
    expect(body.data.map((item: any) => item.id)).toEqual(["2", "1"]);
  });

  it("uses default limit when only page is provided", () => {
    const { status, body } = invokeListStreamsRoute({ page: "2" });

    expect(status).toBe(200);
    expect(body.total).toBe(4);
    expect(body.page).toBe(2);
    expect(body.limit).toBe(20);
    expect(body.data).toEqual([]);
  });

  it("uses default page when only limit is provided", () => {
    const { status, body } = invokeListStreamsRoute({ limit: "2" });

    expect(status).toBe(200);
    expect(body.total).toBe(4);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(2);
    expect(body.data.map((item: any) => item.id)).toEqual(["4", "3"]);
  });

  it("returns 400 for invalid status", () => {
    const { status, body } = invokeListStreamsRoute({ status: "pending" });

    expect(status).toBe(400);
    expect(body.error).toContain("status must be one of");
  });

  it("returns 400 for invalid page", () => {
    const { status, body } = invokeListStreamsRoute({ page: "0" });

    expect(status).toBe(400);
    expect(body.error).toContain("page must be greater than or equal to 1");
  });

  it("returns 400 for invalid limit", () => {
    const { status, body } = invokeListStreamsRoute({ limit: "101" });

    expect(status).toBe(400);
    expect(body.error).toContain("limit must be less than or equal to 100");
  });

  it("returns empty data for out-of-range page with metadata intact", () => {
    const { status, body } = invokeListStreamsRoute({
      status: "active",
      page: "2",
      limit: "1",
    });

    expect(status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.page).toBe(2);
    expect(body.limit).toBe(1);
    expect(body.data).toEqual([]);
  });
});
