/**
 * WebSocket cross-user event isolation tests.
 *
 * Verifies that a client subscribed to stream A does NOT receive events
 * broadcast for stream B, and vice versa.  Each test spins up a real HTTP
 * server with the WebSocket service attached so the network path is exercised
 * end-to-end without mocking the WS layer.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, Server as HttpServer } from "http";
import { AddressInfo } from "net";
import WebSocket from "ws";
import { initWebSocket, broadcastStreamEvent, broadcastStreamProgress } from "./websocket";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parsed WebSocket message received by a test client. */
interface ReceivedMessage {
  type: string;
  streamId: string;
  timestamp: number;
  [key: string]: unknown;
}

/**
 * Create a minimal HTTP server with the WebSocket service attached, listen on
 * an OS-assigned port, and return the server together with its base URL.
 */
function createTestServer(): Promise<{ server: HttpServer; url: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    initWebSocket(server);

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `ws://127.0.0.1:${port}/api/ws` });
    });

    server.once("error", reject);
  });
}

/**
 * Open a WebSocket connection to `url` and wait until it is OPEN.
 */
function connectClient(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

/**
 * Subscribe a client to a specific stream by sending the subscribe control
 * message and waiting for the server's `subscribed` acknowledgment.  This
 * guarantees the subscription is active on the server side before the caller
 * proceeds to broadcast.
 */
function subscribeToStream(ws: WebSocket, streamId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error(`subscribe ack for ${streamId} not received within 1000ms`));
    }, 1000);

    const onMessage = (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (msg.type === "subscribed" && msg.streamId === streamId) {
          clearTimeout(timer);
          ws.off("message", onMessage);
          resolve();
        }
      } catch {
        // ignore non-JSON
      }
    };

    ws.on("message", onMessage);
    ws.send(JSON.stringify({ type: "subscribe", streamId }), (err) => {
      if (err) {
        clearTimeout(timer);
        ws.off("message", onMessage);
        reject(err);
      }
    });
  });
}

/**
 * Collect messages received by `ws` for `durationMs` milliseconds.
 * Returns an array of parsed message objects.
 */
function collectMessages(ws: WebSocket, durationMs: number): Promise<ReceivedMessage[]> {
  return new Promise((resolve) => {
    const collected: ReceivedMessage[] = [];

    const onMessage = (raw: WebSocket.RawData) => {
      try {
        collected.push(JSON.parse(raw.toString()) as ReceivedMessage);
      } catch {
        // ignore non-JSON frames
      }
    };

    ws.on("message", onMessage);

    setTimeout(() => {
      ws.off("message", onMessage);
      resolve(collected);
    }, durationMs);
  });
}

/**
 * Wait for exactly one message on `ws` with a timeout.  Rejects if the
 * timeout fires before a message arrives.
 */
function waitForMessage(ws: WebSocket, timeoutMs = 500): Promise<ReceivedMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error(`No message received within ${timeoutMs}ms`));
    }, timeoutMs);

    const onMessage = (raw: WebSocket.RawData) => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      try {
        resolve(JSON.parse(raw.toString()) as ReceivedMessage);
      } catch (e) {
        reject(e);
      }
    };

    ws.on("message", onMessage);
  });
}

/**
 * Gracefully close a WebSocket and wait for the CLOSE event.
 */
function closeClient(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    ws.once("close", () => resolve());
    ws.close();
  });
}

/**
 * Stop the HTTP server and wait until it is fully closed.
 */
function stopServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("WebSocket cross-user event isolation", () => {
  let server: HttpServer;
  let wsUrl: string;
  let clientA: WebSocket;
  let clientB: WebSocket;

  const STREAM_A = "stream-user-alice-001";
  const STREAM_B = "stream-user-bob-002";

  beforeEach(async () => {
    ({ server, url: wsUrl } = await createTestServer());
    clientA = await connectClient(wsUrl);
    clientB = await connectClient(wsUrl);
  });

  afterEach(async () => {
    await Promise.all([closeClient(clientA), closeClient(clientB)]);
    await stopServer(server);
  });

  // -------------------------------------------------------------------------
  // broadcastStreamEvent isolation
  // -------------------------------------------------------------------------

  describe("broadcastStreamEvent", () => {
    it("client A receives the event for stream A that it subscribed to", async () => {
      await subscribeToStream(clientA, STREAM_A);

      const receivePromise = waitForMessage(clientA, 500);
      broadcastStreamEvent(STREAM_A, "stream.created", { amount: 100 });

      const msg = await receivePromise;

      expect(msg.type).toBe("stream.created");
      expect(msg.streamId).toBe(STREAM_A);
      expect(typeof msg.timestamp).toBe("number");
      expect(msg.timestamp).toBeGreaterThan(0);
    });

    it("client B does NOT receive an event broadcast for stream A", async () => {
      await subscribeToStream(clientA, STREAM_A);
      // Client B subscribes only to stream B — not to stream A
      await subscribeToStream(clientB, STREAM_B);

      // Collect messages on client B for 200 ms while we broadcast for stream A
      const collectPromise = collectMessages(clientB, 200);
      broadcastStreamEvent(STREAM_A, "stream.created", { amount: 100 });

      const received = await collectPromise;
      expect(received).toHaveLength(0);
    });

    it("client A does NOT receive an event broadcast for stream B", async () => {
      await subscribeToStream(clientA, STREAM_A);
      await subscribeToStream(clientB, STREAM_B);

      const collectPromise = collectMessages(clientA, 200);
      broadcastStreamEvent(STREAM_B, "stream.canceled");

      const received = await collectPromise;
      expect(received).toHaveLength(0);
    });

    it("each client receives only its own stream events when both are broadcast", async () => {
      await subscribeToStream(clientA, STREAM_A);
      await subscribeToStream(clientB, STREAM_B);

      const aMessages: ReceivedMessage[] = [];
      const bMessages: ReceivedMessage[] = [];

      const collectA = collectMessages(clientA, 300);
      const collectB = collectMessages(clientB, 300);

      broadcastStreamEvent(STREAM_A, "stream.created", { amount: 500 });
      broadcastStreamEvent(STREAM_B, "stream.canceled");

      aMessages.push(...(await collectA));
      bMessages.push(...(await collectB));

      // A only got its own event
      expect(aMessages).toHaveLength(1);
      expect(aMessages[0].streamId).toBe(STREAM_A);
      expect(aMessages[0].type).toBe("stream.created");

      // B only got its own event
      expect(bMessages).toHaveLength(1);
      expect(bMessages[0].streamId).toBe(STREAM_B);
      expect(bMessages[0].type).toBe("stream.canceled");
    });

    it("unsubscribed client receives no events", async () => {
      // Neither client subscribes to anything
      const collectPromise = collectMessages(clientA, 200);
      broadcastStreamEvent(STREAM_A, "stream.created");

      const received = await collectPromise;
      expect(received).toHaveLength(0);
    });

    it("payload shape includes streamId, type, and timestamp", async () => {
      await subscribeToStream(clientA, STREAM_A);

      const receivePromise = waitForMessage(clientA, 500);
      broadcastStreamEvent(STREAM_A, "stream.claimed", { amount: 42, actor: "GABC" });

      const msg = await receivePromise;

      // Required shape fields
      expect(msg).toHaveProperty("type", "stream.claimed");
      expect(msg).toHaveProperty("streamId", STREAM_A);
      expect(msg).toHaveProperty("timestamp");
      expect(typeof msg.timestamp).toBe("number");
      expect(msg.timestamp).toBeGreaterThan(0);

      // Additional data payload is forwarded
      expect(msg).toHaveProperty("data");
      const data = msg.data as Record<string, unknown>;
      expect(data.amount).toBe(42);
      expect(data.actor).toBe("GABC");
    });
  });

  // -------------------------------------------------------------------------
  // broadcastStreamProgress isolation
  // -------------------------------------------------------------------------

  describe("broadcastStreamProgress", () => {
    it("client A receives progress for stream A that it subscribed to", async () => {
      await subscribeToStream(clientA, STREAM_A);

      const receivePromise = waitForMessage(clientA, 500);
      broadcastStreamProgress(STREAM_A, 250.5, 50);

      const msg = await receivePromise;

      expect(msg.type).toBe("stream_progress");
      expect(msg.streamId).toBe(STREAM_A);
      expect(msg.vestedAmount).toBe(250.5);
      expect(msg.percentComplete).toBe(50);
      expect(typeof msg.timestamp).toBe("number");
      expect(msg.timestamp).toBeGreaterThan(0);
    });

    it("client B does NOT receive progress broadcast for stream A", async () => {
      await subscribeToStream(clientA, STREAM_A);
      await subscribeToStream(clientB, STREAM_B);

      const collectPromise = collectMessages(clientB, 200);
      broadcastStreamProgress(STREAM_A, 100, 25);

      const received = await collectPromise;
      expect(received).toHaveLength(0);
    });

    it("progress payload shape includes type, streamId, vestedAmount, percentComplete, timestamp", async () => {
      await subscribeToStream(clientA, STREAM_A);

      const receivePromise = waitForMessage(clientA, 500);
      broadcastStreamProgress(STREAM_A, 750.25, 75);

      const msg = await receivePromise;

      expect(msg).toHaveProperty("type", "stream_progress");
      expect(msg).toHaveProperty("streamId", STREAM_A);
      expect(msg).toHaveProperty("vestedAmount", 750.25);
      expect(msg).toHaveProperty("percentComplete", 75);
      expect(msg).toHaveProperty("timestamp");
      expect(typeof msg.timestamp).toBe("number");
    });
  });

  // -------------------------------------------------------------------------
  // Subscription lifecycle
  // -------------------------------------------------------------------------

  describe("subscription lifecycle", () => {
    it("client stops receiving events after unsubscribing", async () => {
      await subscribeToStream(clientA, STREAM_A);

      // Verify subscription works first
      const firstReceive = waitForMessage(clientA, 500);
      broadcastStreamEvent(STREAM_A, "stream.created");
      await firstReceive; // should resolve

      // Now unsubscribe — wait for server ack before broadcasting
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          clientA.off("message", onUnsubAck);
          reject(new Error("unsubscribed ack not received"));
        }, 1000);

        const onUnsubAck = (raw: WebSocket.RawData) => {
          try {
            const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
            if (msg.type === "unsubscribed" && msg.streamId === STREAM_A) {
              clearTimeout(timer);
              clientA.off("message", onUnsubAck);
              resolve();
            }
          } catch {
            // ignore
          }
        };

        clientA.on("message", onUnsubAck);
        clientA.send(JSON.stringify({ type: "unsubscribe", streamId: STREAM_A }), (err) => {
          if (err) {
            clearTimeout(timer);
            clientA.off("message", onUnsubAck);
            reject(err);
          }
        });
      });

      // Subsequent broadcast should NOT arrive
      const collectPromise = collectMessages(clientA, 200);
      broadcastStreamEvent(STREAM_A, "stream.claimed");
      const received = await collectPromise;

      expect(received).toHaveLength(0);
    });

    it("client can subscribe to multiple streams and receive events for each", async () => {
      await subscribeToStream(clientA, STREAM_A);
      await subscribeToStream(clientA, STREAM_B);

      const collectPromise = collectMessages(clientA, 300);

      broadcastStreamEvent(STREAM_A, "stream.created");
      broadcastStreamEvent(STREAM_B, "stream.canceled");

      const received = await collectPromise;

      expect(received).toHaveLength(2);
      const streamIds = received.map((m) => m.streamId).sort();
      expect(streamIds).toEqual([STREAM_A, STREAM_B].sort());
    });
  });
});
