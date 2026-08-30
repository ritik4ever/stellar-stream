import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Keypair } from '@stellar/stellar-sdk';

const RECIPIENT = Keypair.random().publicKey();
const STRANGER = Keypair.random().publicKey();
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
  recordEvent: vi.fn(),
}));

const claimServiceMocks = vi.hoisted(() => ({
  submitClaimTransaction: vi.fn(),
}));

vi.mock('./services/streamStore', () => streamStoreMocks);

vi.mock('./services/eventHistory', () => eventHistoryMocks);

vi.mock('./services/claimService', () => claimServiceMocks);

vi.mock('./services/auth', () => ({
  authMiddleware: vi.fn((req: any, _res: unknown, next: () => void) => {
    req.user = {
      accountId: req.header('x-test-account') ?? RECIPIENT,
    };

    next();
  }),

  adminJwtAuth: vi.fn((_req: unknown, _res: unknown, next: () => void) =>
    next(),
  ),

  generateChallenge: vi.fn(),
  refreshToken: vi.fn(),
  verifyChallengeAndIssueToken: vi.fn(),
  getJwtSecret: vi.fn(() => 'claim-test-secret'),
}));

import { app } from './index';

const activeStream = {
  id: '5',
  sender: SENDER,
  recipient: RECIPIENT,
  assetCode: 'USDC',
  totalAmount: 1000,
  durationSeconds: 1000,
  startAt: 1000,
  createdAt: 900,
  pausedDuration: 0,
  cliffSeconds: 0,
};

const activeProgress = {
  status: 'active',
  ratePerSecond: 1,
  elapsedSeconds: 250,
  vestedAmount: 250,
  remainingAmount: 750,
  percentComplete: 25,
};

describe('POST /api/streams/:id/claim', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    streamStoreMocks.getStream.mockReturnValue(activeStream);

    streamStoreMocks.calculateProgress.mockReturnValue(activeProgress);

    streamStoreMocks.getOnChainClaimableAmount.mockResolvedValue({
      claimableAmount: 250,
      at: 1250,
    });

    streamStoreMocks.nowInSeconds.mockReturnValue(1250);

    claimServiceMocks.submitClaimTransaction.mockResolvedValue({
      txHash: 'claim-tx-hash-abc123',
      amountClaimed: 250,
      ledgerSequence: 987654,
    });

    eventHistoryMocks.getStreamHistory.mockReturnValue([
      {
        id: 1,
        streamId: '5',
        eventType: 'claimed',
        timestamp: 1250,
        actor: RECIPIENT,
        amount: 250,
        metadata: {
          assetCode: 'USDC',
          txHash: 'claim-tx-hash-abc123',
        },
        ledgerSequence: 987654,
      },
    ]);
  });

  it('submits the recipient claim and returns the real tx hash and claimed amount', async () => {
    const response = await request(app)
      .post('/api/streams/5/claim')
      .set('x-test-account', RECIPIENT);

    expect(response.status).toBe(200);

    expect(streamStoreMocks.getOnChainClaimableAmount).toHaveBeenCalledWith(
      '5',
    );

    expect(claimServiceMocks.submitClaimTransaction).toHaveBeenCalledWith(
      '5',
      RECIPIENT,
      250,
    );

    expect(response.body.result).toEqual({
      claimedAmount: 250,
      assetCode: 'USDC',
      txHash: 'claim-tx-hash-abc123',
    });
  });

  it('records the claim in history with the transaction hash', async () => {
    const response = await request(app)
      .post('/api/streams/5/claim')
      .set('x-test-account', RECIPIENT);

    expect(response.status).toBe(200);

    expect(eventHistoryMocks.recordEvent).toHaveBeenCalledWith(
      '5',
      'claimed',
      1250,
      RECIPIENT,
      250,
      {
        assetCode: 'USDC',
        txHash: 'claim-tx-hash-abc123',
      },
      987654,
    );

    expect(response.body.history).toHaveLength(1);

    expect(response.body.history[0].metadata.txHash).toBe(
      'claim-tx-hash-abc123',
    );
  });

  it('returns 403 when the authenticated user is not the recipient', async () => {
    const response = await request(app)
      .post('/api/streams/5/claim')
      .set('x-test-account', STRANGER);

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');

    expect(claimServiceMocks.submitClaimTransaction).not.toHaveBeenCalled();

    expect(eventHistoryMocks.recordEvent).not.toHaveBeenCalled();
  });

  it('returns 400 when the stream is completed', async () => {
    streamStoreMocks.calculateProgress.mockReturnValue({
      ...activeProgress,
      status: 'completed',
      vestedAmount: 1000,
      remainingAmount: 0,
      percentComplete: 100,
    });

    const response = await request(app)
      .post('/api/streams/5/claim')
      .set('x-test-account', RECIPIENT);

    expect(response.status).toBe(400);

    expect(response.body.code).toBe('STREAM_NOT_CLAIMABLE');

    expect(claimServiceMocks.submitClaimTransaction).not.toHaveBeenCalled();
  });

  it('returns 400 when the stream is canceled', async () => {
    streamStoreMocks.getStream.mockReturnValue({
      ...activeStream,
      canceledAt: 1200,
    });

    streamStoreMocks.calculateProgress.mockReturnValue({
      ...activeProgress,
      status: 'canceled',
    });

    const response = await request(app)
      .post('/api/streams/5/claim')
      .set('x-test-account', RECIPIENT);

    expect(response.status).toBe(400);

    expect(response.body.code).toBe('STREAM_NOT_CLAIMABLE');

    expect(claimServiceMocks.submitClaimTransaction).not.toHaveBeenCalled();
  });

  it('returns 400 when there is no on-chain claimable amount', async () => {
    streamStoreMocks.getOnChainClaimableAmount.mockResolvedValue({
      claimableAmount: 0,
      at: 1250,
    });

    const response = await request(app)
      .post('/api/streams/5/claim')
      .set('x-test-account', RECIPIENT);

    expect(response.status).toBe(400);

    expect(response.body.code).toBe('NO_CLAIMABLE_AMOUNT');

    expect(claimServiceMocks.submitClaimTransaction).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown stream', async () => {
    streamStoreMocks.getStream.mockReturnValue(undefined);

    const response = await request(app)
      .post('/api/streams/999/claim')
      .set('x-test-account', RECIPIENT);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');

    expect(claimServiceMocks.submitClaimTransaction).not.toHaveBeenCalled();
  });
});
