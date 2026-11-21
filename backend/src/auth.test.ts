import { describe, it, expect, beforeAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const TEST_SECRET = "test_secret_for_vitest";
process.env.JWT_SECRET = TEST_SECRET;

import { authMiddleware, generateChallenge, getJwtSecret } from './services/auth';
import { app as mainApp } from './index';
import { Keypair, Transaction, Networks } from '@stellar/stellar-sdk';




describe('Authentication Logic & Middleware', () => {
  const testAccountId = Keypair.random().publicKey();
  let app: express.Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    
    // Define a dummy protected route for testing the middleware in isolation
    app.get('/api/test-protected', authMiddleware, (req, res) => {
      res.status(200).json({ 
        message: 'Success', 
        user: (req as any).user 
      });
    });
  });

  describe('generateChallenge', () => {
    it('should generate a non-empty SEP-10 challenge transaction string', () => {
      const challenge = generateChallenge(testAccountId);
      expect(typeof challenge).toBe('string');
      expect(challenge.length).toBeGreaterThan(0);
    });
  });

  describe('authMiddleware', () => {
    it('should reject requests with missing Authorization header (401)', async () => {
      const response = await request(app).get('/api/test-protected');
      
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        error: "Missing or invalid authorization header.",
        code: "unauthorized",
      });
    });

    it('should reject requests with invalid header format (401)', async () => {
      const response = await request(app)
        .get('/api/test-protected')
        .set('Authorization', 'Basic wrongformat');
      
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('unauthorized');
    });

    it('should reject requests with an invalid token (401)', async () => {
      const response = await request(app)
        .get('/api/test-protected')
        .set('Authorization', 'Bearer this.is.not.a.valid.token');
      
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        error: "Invalid authorization token.",
        code: "invalid_token",
      });
    });

    it('should reject requests with an expired token (401)', async () => {
      const expiredToken = jwt.sign(
        { accountId: testAccountId }, 
        getJwtSecret(), 
        { expiresIn: '-1h' }
      );

      const response = await request(app)
        .get('/api/test-protected')
        .set('Authorization', `Bearer ${expiredToken}`);
      
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        error: "Authorization token has expired.",
        code: "token_expired",
      });
    });

    it('should allow requests with a valid token and attach accountId to req.user (200)', async () => {
      const token = jwt.sign({ accountId: testAccountId }, getJwtSecret(), { expiresIn: '1h' });

      const response = await request(app)
        .get('/api/test-protected')
        .set('Authorization', `Bearer ${token}`);
      
      expect(response.status).toBe(200);
      expect(response.body.user.accountId).toBe(testAccountId);
    });
  });

  describe('Integration: Auth Flow', () => {
    let clientKeypair: Keypair;
    let challengeTx: string;
    let validToken: string;

    beforeAll(() => {
      clientKeypair = Keypair.random();
    });

    it('should generate a challenge for the client account (GET /api/auth/challenge)', async () => {
      const response = await request(mainApp)
        .get('/api/auth/challenge')
        .query({ accountId: clientKeypair.publicKey() });

      expect(response.status).toBe(200);
      expect(response.body.transaction).toBeDefined();
      expect(typeof response.body.transaction).toBe('string');
      expect(response.body.transaction.length).toBeGreaterThan(0);
      
      challengeTx = response.body.transaction;
    });

    it('should verify the challenge with a correct signature and return a token (POST /api/auth/token)', async () => {
      const tx = new Transaction(challengeTx, Networks.TESTNET);
      tx.sign(clientKeypair);
      const signedTxXdr = tx.toXDR();

      const response = await request(mainApp)
        .post('/api/auth/token')
        .send({ transaction: signedTxXdr });

      expect(response.status).toBe(200);
      expect(response.body.token).toBeDefined();
      expect(typeof response.body.token).toBe('string');
      
      validToken = response.body.token;
    });

    it('should return 401 for an incorrect or missing signature (POST /api/auth/token)', async () => {
      const response = await request(mainApp)
        .post('/api/auth/token')
        .send({ transaction: challengeTx }); // Unsigned

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Challenge verification failed');
    });

    it('should refresh a valid token (POST /api/auth/refresh)', async () => {
      const response = await request(mainApp)
        .post('/api/auth/refresh')
        .set('Authorization', `Bearer ${validToken}`);

      expect(response.status).toBe(200);
      expect(response.body.token).toBeDefined();
    });

    it('should reject an invalid token on refresh (POST /api/auth/refresh)', async () => {
      const response = await request(mainApp)
        .post('/api/auth/refresh')
        .set('Authorization', 'Bearer invalid_token_xyz');

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('UNAUTHORIZED');
    });
  });
});

describe('Stream Ownership Enforcement', () => {
  const senderKeypair = Keypair.random();
  const recipientKeypair = Keypair.random();
  const thirdPartyKeypair = Keypair.random();

  const senderToken = () =>
    jwt.sign({ accountId: senderKeypair.publicKey() }, getJwtSecret(), { expiresIn: '1h' });
  const recipientToken = () =>
    jwt.sign({ accountId: recipientKeypair.publicKey() }, getJwtSecret(), { expiresIn: '1h' });
  const thirdPartyToken = () =>
    jwt.sign({ accountId: thirdPartyKeypair.publicKey() }, getJwtSecret(), { expiresIn: '1h' });

  const STREAM_ID = '9001';

  beforeAll(async () => {
    const { initDb, getDb } = await import('./services/db');
    const { initCache } = await import('./services/cache');
    initDb();
    initCache();
    const db = getDb();

    // Clean up any leftover state
    db.exec("DELETE FROM stream_events WHERE stream_id = '" + STREAM_ID + "'");
    db.exec("DELETE FROM streams WHERE id = '" + STREAM_ID + "'");

    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
      INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      STREAM_ID,
      senderKeypair.publicKey(),
      recipientKeypair.publicKey(),
      'USDC',
      1000,
      3600,
      now - 60, // already started so vested > 0
      now - 60,
    );
  });

  it('sender cannot claim their own stream (403)', async () => {
    const res = await request(mainApp)
      .post(`/api/streams/${STREAM_ID}/claim`)
      .set('Authorization', `Bearer ${senderToken()}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('recipient cannot cancel the stream (403)', async () => {
    const res = await request(mainApp)
      .post(`/api/streams/${STREAM_ID}/cancel`)
      .set('Authorization', `Bearer ${recipientToken()}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('third party cannot claim the stream (403)', async () => {
    const res = await request(mainApp)
      .post(`/api/streams/${STREAM_ID}/claim`)
      .set('Authorization', `Bearer ${thirdPartyToken()}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('third party cannot cancel the stream (403)', async () => {
    const res = await request(mainApp)
      .post(`/api/streams/${STREAM_ID}/cancel`)
      .set('Authorization', `Bearer ${thirdPartyToken()}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('recipient can claim the stream (200)', async () => {
    const res = await request(mainApp)
      .post(`/api/streams/${STREAM_ID}/claim`)
      .set('Authorization', `Bearer ${recipientToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.result.claimedAmount).toBeGreaterThan(0);
  });

  it('sender can cancel the stream (200)', async () => {
    const res = await request(mainApp)
      .post(`/api/streams/${STREAM_ID}/cancel`)
      .set('Authorization', `Bearer ${senderToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.canceledAt).toBeDefined();
  });
});
