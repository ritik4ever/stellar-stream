import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Keypair } from '@stellar/stellar-sdk';

const RECIPIENT = Keypair.random().publicKey();
const SENDER = Keypair.random().publicKey();

const streamStoreMocks = vi.hoisted(() => ({
  archiveOldStreams: vi.fn(),
  calculateProgress: vi.fn(),
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
  nowInSeconds: vi.fn(),
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
}));

vi.mock('./services/streamStore', () => streamStoreMocks);

vi.mock('./services/eventHistory', () => eventHistoryMocks);

vi.mock('./services/auth', () => ({
  authMiddleware: vi.fn((_req: unknown, _res: unknown, next: () => void) =>
    next(),
  ),
  adminJwtAuth: vi.fn((_req: unknown, _res: unknown, next: () => void) =>
    next(),
  ),
  generateChallenge: vi.fn(),
  refreshToken: vi.fn(),
  verifyChallengeAndIssueToken: vi.fn(),
  getJwtSecret: vi.fn(() => 'snapshot-test-secret'),
}));

import { app } from './index';

const stream = {
  id: '5',
  sender: SENDER,
  recipient: RECIPIENT,
  assetCode: 'USDC',
  totalAmount: 1000,
  durationSeconds: 100,
  startAt: 1000,
  createdAt: 900,
  pausedDuration: 0,
  cliffSeconds: 0,
};

describe('GET /api/streams/:id/snapshot?at=', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    streamStoreMocks.getStream.mockReturnValue(stream);

    eventHistoryMocks.countStreamEvents.mockReturnValue(2);

    eventHistoryMocks.getStreamHistory.mockReturnValue([
      {
        id: 1,
        streamId: '5',
        eventType: 'claimed',
        timestamp: 1040,
        actor: RECIPIENT,
        amount: 100,
      },
      {
        id: 2,
        streamId: '5',
        eventType: 'claimed',
        timestamp: 1080,
        actor: RECIPIENT,
        amount: 50,
      },
    ]);

    streamStoreMocks.calculateProgress.mockImplementation(
      (_stream: typeof stream, at: number) => {
        if (at < 1000) {
          return {
            status: 'scheduled',
            ratePerSecond: 10,
            elapsedSeconds: 0,
            vestedAmount: 0,
            remainingAmount: 1000,
            percentComplete: 0,
          };
        }

        if (at >= 1100) {
          return {
            status: 'completed',
            ratePerSecond: 10,
            elapsedSeconds: 100,
            vestedAmount: 1000,
            remainingAmount: 0,
            percentComplete: 100,
          };
        }

        const elapsed = at - 1000;
        const vested = elapsed * 10;

        return {
          status: 'active',
          ratePerSecond: 10,
          elapsedSeconds: elapsed,
          vestedAmount: vested,
          remainingAmount: 1000 - vested,
          percentComplete: elapsed,
        };
      },
    );
  });

  it('returns completed with total vested at the stream end', async () => {
    const response = await request(app).get('/api/streams/5/snapshot?at=1100');

    expect(response.status).toBe(200);

    expect(response.body.data).toMatchObject({
      status: 'completed',
      vested: 1000,
      claimable: 850,
      remaining: 0,
    });

    expect(streamStoreMocks.calculateProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '5',
        totalAmount: 1000,
      }),
      1100,
    );
  });

  it('returns scheduled with zero vested before the stream starts', async () => {
    const response = await request(app).get('/api/streams/5/snapshot?at=999');

    expect(response.status).toBe(200);

    expect(response.body.data).toMatchObject({
      status: 'scheduled',
      vested: 0,
      claimable: 0,
      remaining: 1000,
    });

    expect(streamStoreMocks.calculateProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '5',
      }),
      999,
    );
  });

  it('computes claimable using only claims recorded by that timestamp', async () => {
    const response = await request(app).get('/api/streams/5/snapshot?at=1050');

    expect(response.status).toBe(200);

    expect(response.body.data).toMatchObject({
      status: 'active',
      vested: 500,
      claimable: 400,
      remaining: 500,
    });

    expect(eventHistoryMocks.getStreamHistory).toHaveBeenCalledWith(
      '5',
      2,
      0,
      'asc',
    );
  });

  it('returns 400 for an invalid timestamp', async () => {
    const response = await request(app).get(
      '/api/streams/5/snapshot?at=not-a-timestamp',
    );

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');

    expect(streamStoreMocks.calculateProgress).not.toHaveBeenCalled();
  });

  it('returns 400 when the timestamp is missing', async () => {
    const response = await request(app).get('/api/streams/5/snapshot');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');

    expect(streamStoreMocks.calculateProgress).not.toHaveBeenCalled();
  });

  it('returns 400 for a negative timestamp', async () => {
    const response = await request(app).get('/api/streams/5/snapshot?at=-1');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');

    expect(streamStoreMocks.calculateProgress).not.toHaveBeenCalled();
  });

  it('returns 404 when the stream does not exist', async () => {
    streamStoreMocks.getStream.mockReturnValue(undefined);

    const response = await request(app).get(
      '/api/streams/999/snapshot?at=1050',
    );

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });
});
