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

const eventHistoryMocks = vi.hoisted(() => ({
  getStreamHistory: vi.fn(),
  getAllEvents: vi.fn(),
  getGlobalEvents: vi.fn(),
  countAllEvents: vi.fn(),
  recordEvent: vi.fn(),
}));

vi.mock("./services/streamStore", () => streamStoreMocks);
vi.mock("./services/eventHistory", () => eventHistoryMocks);

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

const SENDER_A = "GA6W6AAAAAAAAAAW6AAAAAAAAAAW6AAAAAAAAAAW6AAAAAAAAAAW6AAA";
const SENDER_B = "GA6W6BBBBBBBBBBW6BBBBBBBBBBW6BBBBBBBBBBW6BBBBBBBBBBW6BBB";
const SENDER_C = "GA6W6CCCCCCCCCCW6CCCCCCCCCCW6CCCCCCCCCCW6CCCCCCCCCCW6CCC";
const RECIPIENT_1 = "GA6W61111111111W61111111111W61111111111W61111111111W6111";
const RECIPIENT_2 = "GA6W62222222222W62222222222W62222222222W62222222222W6222";

const streams: TestStream[] = [
  {
    id: "4",
    sender: SENDER_A,
    recipient: RECIPIENT_1,
    assetCode: "USDC",
    totalAmount: 100,
    durationSeconds: 100,
    startAt: 100,
    createdAt: 400,
  },
  {
    id: "3",
    sender: SENDER_B,
    recipient: RECIPIENT_2,
    assetCode: "USDC",
    totalAmount: 100,
    durationSeconds: 100,
    startAt: 100,
    createdAt: 300,
    completedAt: 250,
  },
  {
    id: "2",
    sender: SENDER_A,
    recipient: RECIPIENT_2,
    assetCode: "USDC",
    totalAmount: 100,
    durationSeconds: 100,
    startAt: 300,
    createdAt: 200,
  },
  {
    id: "1",
    sender: SENDER_C,
    recipient: RECIPIENT_1,
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

function invokeSenderStreamsRoute(
  accountId: string,
  query: Record<string, unknown> = {},
): { status: number; body: any } {
  const layer = (app as any)?._router?.stack?.find(
    (entry: any) => entry.route?.path === "/api/senders/:accountId/streams" && entry.route?.methods?.get,
  );

  if (!layer) {
    throw new Error("GET /api/senders/:accountId/streams route not found");
  }

  const handler = layer.route.stack[0].handle as (req: any, res: any) => void;

  let statusCode = 200;
  let jsonBody: any;

  const req = { params: { accountId }, query };
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

  eventHistoryMocks.getGlobalEvents.mockReset();
  eventHistoryMocks.countAllEvents.mockReset();
  eventHistoryMocks.getStreamHistory.mockReset();
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
    const { status, body } = invokeListStreamsRoute({ sender: SENDER_A });

    expect(status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.data.map((item: any) => item.id)).toEqual(["4", "2"]);
  });

  it("filters by recipient exact match", () => {
    const { status, body } = invokeListStreamsRoute({ recipient: RECIPIENT_1 });

    expect(status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.data.map((item: any) => item.id)).toEqual(["4", "1"]);
  });

  it("applies combined sender + recipient + status filtering", () => {
    const { status, body } = invokeListStreamsRoute({
      sender: SENDER_A,
      recipient: RECIPIENT_2,
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

describe("GET /api/senders/:accountId/streams", () => {
  it("returns streams for a specific sender", () => {
    const { status, body } = invokeSenderStreamsRoute(SENDER_A);

    expect(status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.data.every((s: any) => s.sender === SENDER_A)).toBe(true);
  });

  it("filters by status", () => {
    const { status, body } = invokeSenderStreamsRoute(SENDER_A, { status: "active" });

    expect(status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.data[0].id).toBe("4");
  });

  it("filters by asset", () => {
    const { status, body } = invokeSenderStreamsRoute(SENDER_A, { asset: "USDC" });

    expect(status).toBe(200);
    expect(body.total).toBe(2);
  });

  it("filters by search term", () => {
    const { status, body } = invokeSenderStreamsRoute(SENDER_A, { q: "GA6W6AAAAAAAAAAW6AAAAAAAAAAW6AAAAAAAAAAW6AAAAAAAAAAW6AAA" });

    expect(status).toBe(200);
    expect(body.total).toBe(2);
  });

  it("returns 400 for invalid account ID", () => {
    const { status, body } = invokeSenderStreamsRoute("invalid_account");

    expect(status).toBe(400);
    expect(body.error).toContain("Must be a valid Stellar account ID");
  });

  it("paginates correctly", () => {
    const { status, body } = invokeSenderStreamsRoute(SENDER_A, { limit: "1" });

    expect(status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.data).toHaveLength(1);
    expect(body.limit).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// GET /api/events
// ---------------------------------------------------------------------------

type TestEvent = {
  id: number;
  streamId: string;
  eventType: "created" | "claimed" | "canceled" | "start_time_updated";
  timestamp: number;
  actor?: string;
  amount?: number;
};

const sampleEvents: TestEvent[] = [
  { id: 4, streamId: "stream-1", eventType: "claimed",  timestamp: 400, actor: "GSENDER", amount: 50 },
  { id: 3, streamId: "stream-2", eventType: "canceled", timestamp: 300, actor: "GSENDER" },
  { id: 2, streamId: "stream-1", eventType: "created",  timestamp: 200, actor: "GSENDER", amount: 100 },
  { id: 1, streamId: "stream-2", eventType: "created",  timestamp: 100, actor: "GSENDER", amount: 200 },
];

function invokeGlobalEventsRoute(
  query: Record<string, unknown> = {},
): { status: number; body: any } {
  const layer = (app as any)?._router?.stack?.find(
    (entry: any) => entry.route?.path === "/api/events" && entry.route?.methods?.get,
  );

  if (!layer) {
    throw new Error("GET /api/events route not found");
  }

  const handler = layer.route.stack[0].handle as (req: any, res: any) => void;

  let statusCode = 200;
  let jsonBody: any;

  const req = { query };
  const res = {
    status(code: number) { statusCode = code; return this; },
    json(payload: any) { jsonBody = payload; return this; },
  };

  handler(req, res);
  return { status: statusCode, body: jsonBody };
}

describe("GET /api/events", () => {
  beforeEach(() => {
    eventHistoryMocks.countAllEvents.mockReturnValue(sampleEvents.length);
    eventHistoryMocks.getGlobalEvents.mockReturnValue(sampleEvents);
  });

  it("returns all events and correct metadata in legacy mode", () => {
    const { status, body } = invokeGlobalEventsRoute();

    expect(status).toBe(200);
    expect(body.total).toBe(4);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(4);
    expect(body.data).toHaveLength(4);
    expect(body.data[0].streamId).toBe("stream-1");
  });

  it("filters by eventType – passes it to getGlobalEvents and countAllEvents", () => {
    const createdEvents = sampleEvents.filter((e) => e.eventType === "created");
    eventHistoryMocks.countAllEvents.mockReturnValue(createdEvents.length);
    eventHistoryMocks.getGlobalEvents.mockReturnValue(createdEvents);

    const { status, body } = invokeGlobalEventsRoute({ eventType: "created" });

    expect(status).toBe(200);
    expect(body.total).toBe(2);
    expect(eventHistoryMocks.countAllEvents).toHaveBeenCalledWith("created");
    expect(eventHistoryMocks.getGlobalEvents).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      "created",
    );
  });

  it("paginates correctly when page and limit are provided", () => {
    const page2Events = sampleEvents.slice(2);
    eventHistoryMocks.getGlobalEvents.mockReturnValue(page2Events);

    const { status, body } = invokeGlobalEventsRoute({ page: "2", limit: "2" });

    expect(status).toBe(200);
    expect(body.page).toBe(2);
    expect(body.limit).toBe(2);
    expect(body.total).toBe(4);
    expect(body.data).toHaveLength(2);
    // offset should be (2-1)*2 = 2
    expect(eventHistoryMocks.getGlobalEvents).toHaveBeenCalledWith(2, 2, undefined);
  });

  it("uses default limit of 20 when only page is provided", () => {
    eventHistoryMocks.getGlobalEvents.mockReturnValue([]);

    const { status, body } = invokeGlobalEventsRoute({ page: "2" });

    expect(status).toBe(200);
    expect(body.page).toBe(2);
    expect(body.limit).toBe(20);
  });

  it("uses default page of 1 when only limit is provided", () => {
    eventHistoryMocks.getGlobalEvents.mockReturnValue(sampleEvents.slice(0, 2));

    const { status, body } = invokeGlobalEventsRoute({ limit: "2" });

    expect(status).toBe(200);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(2);
    expect(eventHistoryMocks.getGlobalEvents).toHaveBeenCalledWith(2, 0, undefined);
  });

  it("returns 400 for an invalid eventType", () => {
    const { status, body } = invokeGlobalEventsRoute({ eventType: "unknown" });

    expect(status).toBe(400);
    expect(body.error).toContain("eventType must be one of");
  });

  it("returns 400 for page < 1", () => {
    const { status, body } = invokeGlobalEventsRoute({ page: "0" });

    expect(status).toBe(400);
    expect(body.error).toContain("page must be greater than or equal to 1");
  });

  it("returns 400 for limit > 100", () => {
    const { status, body } = invokeGlobalEventsRoute({ limit: "101" });

    expect(status).toBe(400);
    expect(body.error).toContain("limit must be less than or equal to 100");
  });

  it("returns empty data array for out-of-range page with metadata intact", () => {
    eventHistoryMocks.countAllEvents.mockReturnValue(2);
    eventHistoryMocks.getGlobalEvents.mockReturnValue([]);

    const { status, body } = invokeGlobalEventsRoute({ page: "5", limit: "1" });

    expect(status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.page).toBe(5);
    expect(body.limit).toBe(1);
    expect(body.data).toEqual([]);
  });

  it("includes streamId and eventType fields in each event", () => {
    eventHistoryMocks.getGlobalEvents.mockReturnValue([sampleEvents[0]]);
    eventHistoryMocks.countAllEvents.mockReturnValue(1);

    const { status, body } = invokeGlobalEventsRoute({ page: "1", limit: "1" });

    expect(status).toBe(200);
    expect(body.data[0]).toMatchObject({
      id: 4,
      streamId: "stream-1",
      eventType: "claimed",
      timestamp: 400,
      actor: "GSENDER",
      amount: 50,
    });
  });
});
