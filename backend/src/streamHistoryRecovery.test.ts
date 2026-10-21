import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { Keypair } from '@stellar/stellar-sdk';

const SENDER = Keypair.random().publicKey();
const RECIPIENT = Keypair.random().publicKey();

const mockDbRows: Array<{
  id: number;
  stream_id: string;
  event_type: string;
  ledger_sequence: number | null;
  timestamp: number;
  actor: string | null;
  amount: number | null;
  metadata: string | null;
}> = [];

const dbMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  initDb: vi.fn(),
  searchStreamsFts: vi.fn(() => []),
  getAllowedAssets: vi.fn(() => ['USDC', 'XLM']),
  addAllowedAsset: vi.fn(),
  removeAllowedAsset: vi.fn(),
}));

const streamStoreMocks = vi.hoisted(() => ({
  MIN_COMPARE_STREAMS: 2,
  MAX_COMPARE_STREAMS: 5,
  archiveOldStreams: vi.fn(),
  calculateProgress: vi.fn(),
  compareStreams: vi.fn(),
  cancelStream: vi.fn(),
  createStream: vi.fn(),
  deleteStreamById: vi.fn(),
  estimateCreateStreamFee: vi.fn(),
  getLatestLedgerTime: vi.fn(),
  getOnChainClaimableAmount: vi.fn(),
  getOnChainClaimableBatch: vi.fn(),
  getOnChainStreamCount: vi.fn(),
  getStream: vi.fn(),
  initSoroban: vi.fn(),
  listStreams: vi.fn(),
  listStreamsByRecipient: vi.fn(),
  listStreamsBySender: vi.fn(),
  markStreamComplete: vi.fn(),
  nowInSeconds: vi.fn(() => 1000),
  pauseStream: vi.fn(),
  reconcileStream: vi.fn(),
  refreshStreamStatuses: vi.fn(),
  resumeStream: vi.fn(),
  syncStreams: vi.fn(),
  updateStreamStartAt: vi.fn(),
}));

const eventHistoryMocks = vi.hoisted(() => ({
  countAllEvents: vi.fn(),
  countStreamEvents: vi.fn(),
  getAllEvents: vi.fn(),
  getGlobalEvents: vi.fn(),
  getStreamEventSummary: vi.fn(),
  getStreamHistory: vi.fn(),
  recordEvent: vi.fn(),
  recordEventWithDb: vi.fn(),
}));

vi.mock('./services/db', () => dbMocks);
vi.mock('./services/streamStore', () => streamStoreMocks);
vi.mock('./services/eventHistory', () => eventHistoryMocks);
vi.mock('./services/auth', () => ({
  authMiddleware: vi.fn((req: any, _res: any, next: any) => {
    req.user = { accountId: RECIPIENT };
    next();
  }),
  adminJwtAuth: vi.fn((_req: any, _res: any, next: any) => next()),
  generateChallenge: vi.fn(),
  refreshToken: vi.fn(),
  verifyChallengeAndIssueToken: vi.fn(),
  getJwtSecret: vi.fn(() => 'test-secret'),
}));

import { app } from './index';

const sampleStream = {
  id: '1',
  sender: SENDER,
  recipient: RECIPIENT,
  assetCode: 'USDC',
  totalAmount: 100,
  durationSeconds: 100,
  startAt: 900,
  createdAt: 1000,
  pausedDuration: 0,
  cliffSeconds: 0,
};

const sampleProgress = {
  status: 'active' as const,
  ratePerSecond: 1,
  elapsedSeconds: 50,
  vestedAmount: 50,
  remainingAmount: 50,
  percentComplete: 50,
};

describe('Stream history endpoint recovery & same-second events (#1060)', () => {
  beforeEach(() => {
    mockDbRows.length = 0;
    vi.clearAllMocks();
    eventHistoryMocks.countStreamEvents.mockReset();
    eventHistoryMocks.getStreamHistory.mockReset();
    streamStoreMocks.getStream.mockReturnValue(sampleStream);
    streamStoreMocks.calculateProgress.mockReturnValue(sampleProgress);

    dbMocks.getDb.mockReturnValue({
      transaction: (fn: () => void) => () => fn(),
      prepare: (sql: string) => ({
        get: (streamId: string) => {
          if (sql.includes("event_type = 'claimed'")) {
            return mockDbRows.find(
              (r) => r.stream_id === streamId && r.event_type === 'claimed',
            );
          }
          return undefined;
        },
      }),
    });

    eventHistoryMocks.recordEventWithDb.mockImplementation(
      (
        _db: any,
        streamId: string,
        eventType: string,
        timestamp: number,
        actor?: string,
        amount?: number,
      ) => {
        mockDbRows.push({
          id: mockDbRows.length + 1,
          stream_id: streamId,
          event_type: eventType,
          ledger_sequence: null,
          timestamp,
          actor: actor ?? null,
          amount: amount ?? null,
          metadata: null,
        });
      },
    );
  });

  it('returns same-second created and claimed events in deterministic causal order', async () => {
    const sameSecondDesc = [
      {
        id: 2,
        streamId: '1',
        eventType: 'claimed',
        timestamp: 1000,
        actor: RECIPIENT,
        amount: 50,
      },
      {
        id: 1,
        streamId: '1',
        eventType: 'created',
        timestamp: 1000,
        actor: SENDER,
        amount: 100,
      },
    ];
    const sameSecondAsc = [...sameSecondDesc].reverse();

    eventHistoryMocks.countStreamEvents.mockReturnValue(2);
    eventHistoryMocks.getStreamHistory.mockImplementation(
      (
        _id: string,
        _limit?: number,
        _offset?: number,
        order?: 'asc' | 'desc',
      ) => (order === 'asc' ? sameSecondAsc : sameSecondDesc),
    );

    const descRes = await request(app).get('/api/streams/1/history');
    expect(descRes.status).toBe(200);
    expect(descRes.body.total).toBe(2);
    expect(descRes.body.data.map((e: any) => e.eventType)).toEqual([
      'claimed',
      'created',
    ]);
    expect(descRes.body.data[0].timestamp).toBe(1000);
    expect(descRes.body.data[1].timestamp).toBe(1000);

    const ascRes = await request(app).get('/api/streams/1/history?order=asc');
    expect(ascRes.status).toBe(200);
    expect(ascRes.body.data.map((e: any) => e.eventType)).toEqual([
      'created',
      'claimed',
    ]);
  });

  it('recovers via single read-only retry when history read fails transiently in GET /api/streams/:id/history', async () => {
    const events = [
      {
        id: 1,
        streamId: '1',
        eventType: 'created',
        timestamp: 1000,
        actor: SENDER,
        amount: 100,
      },
    ];

    eventHistoryMocks.countStreamEvents.mockReturnValue(1);
    eventHistoryMocks.getStreamHistory
      .mockImplementationOnce(() => {
        throw new Error('SQLITE_BUSY: transient history read failure');
      })
      .mockReturnValueOnce(events);

    const res = await request(app).get('/api/streams/1/history');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(events);
    expect(eventHistoryMocks.getStreamHistory).toHaveBeenCalledTimes(2);
    expect(eventHistoryMocks.recordEvent).not.toHaveBeenCalled();
    expect(eventHistoryMocks.recordEventWithDb).not.toHaveBeenCalled();
  });

  it('returns structured 500 error when history read fails persistently without mutating stream state', async () => {
    eventHistoryMocks.countStreamEvents.mockReturnValue(2);
    eventHistoryMocks.getStreamHistory.mockImplementation(() => {
      throw new Error('History table read failed independently');
    });

    const res = await request(app).get('/api/streams/1/history');
    expect(res.status).toBe(500);
    expect(res.body.statusCode).toBe(500);
    expect(res.body.requestId).toBeDefined();
    expect(res.body.code).toBe('HISTORY_READ_FAILED');
    expect(res.body).not.toHaveProperty('data');
    expect(res.body.error).toContain('History table read failed independently');
    expect(eventHistoryMocks.getStreamHistory).toHaveBeenCalledTimes(2);
    expect(eventHistoryMocks.recordEventWithDb).not.toHaveBeenCalled();
  });

  it('retries an independent count failure before reading the requested history page', async () => {
    const events = [
      { id: 1, streamId: '1', eventType: 'created', timestamp: 1000 },
      { id: 2, streamId: '1', eventType: 'claimed', timestamp: 1000 },
    ];
    eventHistoryMocks.countStreamEvents
      .mockImplementationOnce(() => {
        throw new Error('Transient count failure');
      })
      .mockReturnValueOnce(2);
    eventHistoryMocks.getStreamHistory.mockReturnValue(events);

    const res = await request(app).get('/api/streams/1/history?order=asc');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: events,
      total: 2,
      page: 1,
      pageSize: 20,
      hasMore: false,
    });
    expect(eventHistoryMocks.countStreamEvents).toHaveBeenCalledTimes(2);
    expect(eventHistoryMocks.getStreamHistory).toHaveBeenCalledExactlyOnceWith(
      '1',
      20,
      0,
      'asc',
    );
    expect(eventHistoryMocks.recordEvent).not.toHaveBeenCalled();
    expect(eventHistoryMocks.recordEventWithDb).not.toHaveBeenCalled();
  });

  it('returns a structured 500 after two count failures without reading or writing events', async () => {
    eventHistoryMocks.countStreamEvents.mockImplementation(() => {
      throw new Error('Persistent count failure');
    });

    const res = await request(app).get('/api/streams/1/history');

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      statusCode: 500,
      code: 'HISTORY_READ_FAILED',
      error: 'Persistent count failure',
    });
    expect(res.body).not.toHaveProperty('data');
    expect(eventHistoryMocks.countStreamEvents).toHaveBeenCalledTimes(2);
    expect(eventHistoryMocks.getStreamHistory).not.toHaveBeenCalled();
    expect(eventHistoryMocks.recordEvent).not.toHaveBeenCalled();
    expect(eventHistoryMocks.recordEventWithDb).not.toHaveBeenCalled();
  });

  it('preserves the database error code when history reads fail with a coded error', async () => {
    eventHistoryMocks.countStreamEvents.mockReturnValue(2);
    eventHistoryMocks.getStreamHistory.mockImplementation(() => {
      throw Object.assign(new Error('database is locked'), {
        code: 'SQLITE_BUSY',
      });
    });

    const res = await request(app).get('/api/streams/1/history');

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      statusCode: 500,
      code: 'SQLITE_BUSY',
      error: 'database is locked',
    });
    expect(eventHistoryMocks.getStreamHistory).toHaveBeenCalledTimes(2);
    expect(eventHistoryMocks.recordEventWithDb).not.toHaveBeenCalled();
  });

  it.each(['0', '-1', 'not-a-stream'])(
    'returns 400 for invalid stream ID %s before accessing history',
    async (id) => {
      const res = await request(app).get(`/api/streams/${id}/history`);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      });
      expect(streamStoreMocks.getStream).not.toHaveBeenCalled();
      expect(eventHistoryMocks.countStreamEvents).not.toHaveBeenCalled();
      expect(eventHistoryMocks.getStreamHistory).not.toHaveBeenCalled();
    },
  );

  it('returns 404 for a missing stream before accessing history', async () => {
    streamStoreMocks.getStream.mockReturnValue(undefined);

    const res = await request(app).get('/api/streams/999/history');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(eventHistoryMocks.countStreamEvents).not.toHaveBeenCalled();
    expect(eventHistoryMocks.getStreamHistory).not.toHaveBeenCalled();
  });

  it('does not fail committed claim or duplicate money-moving state when post-claim history read fails independently', async () => {
    eventHistoryMocks.getStreamHistory.mockImplementation(() => {
      throw new Error('Independent history read failure after claim commit');
    });

    const claimRes = await request(app)
      .post('/api/streams/1/claim')
      .set('Authorization', 'Bearer test-token')
      .send({});

    expect(claimRes.status).toBe(200);
    expect(claimRes.body.result).toMatchObject({
      claimedAmount: 50,
      assetCode: 'USDC',
    });
    expect(claimRes.body.history).toEqual([]);
    expect(eventHistoryMocks.getStreamHistory).toHaveBeenCalledTimes(2);
    expect(eventHistoryMocks.recordEventWithDb).toHaveBeenCalledTimes(1);
    // Claim was recorded exactly once
    expect(mockDbRows).toHaveLength(1);
    expect(mockDbRows[0].event_type).toBe('claimed');

    // Subsequent duplicate claim attempt is rejected with 409 ALREADY_CLAIMED
    const duplicateRes = await request(app)
      .post('/api/streams/1/claim')
      .set('Authorization', 'Bearer test-token')
      .send({});
    expect(duplicateRes.status).toBe(409);
    expect(duplicateRes.body.code).toBe('ALREADY_CLAIMED');
    expect(mockDbRows).toHaveLength(1);
  });
});
