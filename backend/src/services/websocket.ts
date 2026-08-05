import { WebSocketServer, WebSocket } from "ws";
import { Server as HttpServer } from "http";
import { logger } from "../logger";

interface WebSocketMessage {
  type: string;
  streamId?: string;
  vestedAmount?: number;
  percentComplete?: number;
  timestamp?: number;
}

/**
 * Extended WebSocket type that carries a set of stream IDs this client has
 * explicitly subscribed to.  An empty set means the client wants no targeted
 * stream events (they will still receive un-targeted broadcasts if any are
 * added in the future, but will NOT receive per-stream progress/events for
 * streams they haven't subscribed to).
 */
interface SubscribedWebSocket extends WebSocket {
  subscribedStreams: Set<string>;
}

let wss: WebSocketServer | null = null;

export function initWebSocket(server: HttpServer): void {
  wss = new WebSocketServer({ server, path: "/api/ws" });

  wss.on("connection", (ws: WebSocket) => {
    // Attach an empty subscription set to every new connection.
    const subscribedWs = ws as SubscribedWebSocket;
    subscribedWs.subscribedStreams = new Set<string>();

    logger.info("WebSocket client connected");

    ws.on("message", (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        // Ignore malformed frames
        return;
      }

      if (
        typeof msg === "object" &&
        msg !== null &&
        "type" in msg
      ) {
        const typed = msg as Record<string, unknown>;

        if (typed.type === "subscribe" && typeof typed.streamId === "string") {
          subscribedWs.subscribedStreams.add(typed.streamId);
          logger.debug({ streamId: typed.streamId }, "WebSocket client subscribed to stream");
          // Send acknowledgment so the client knows the subscription is active.
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({ type: "subscribed", streamId: typed.streamId }),
              (err) => {
                if (err) {
                  logger.warn({ err }, "Failed to send subscribe ack");
                }
              },
            );
          }
        } else if (typed.type === "unsubscribe" && typeof typed.streamId === "string") {
          subscribedWs.subscribedStreams.delete(typed.streamId);
          logger.debug({ streamId: typed.streamId }, "WebSocket client unsubscribed from stream");
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({ type: "unsubscribed", streamId: typed.streamId }),
              (err) => {
                if (err) {
                  logger.warn({ err }, "Failed to send unsubscribe ack");
                }
              },
            );
          }
        }
      }
    });

    ws.on("close", () => {
      logger.info("WebSocket client disconnected");
    });

    ws.on("error", (error: Error) => {
      logger.error({ err: error }, "WebSocket error");
    });
  });

  logger.info("WebSocket server initialized on /api/ws");
}

/**
 * Send a progress update only to clients that have subscribed to the given
 * streamId.  Clients that have not sent a `subscribe` message for this stream
 * will not receive the payload, preventing cross-user leakage.
 */
export function broadcastStreamProgress(
  streamId: string,
  vestedAmount: number,
  percentComplete: number,
): void {
  if (!wss) {
    return;
  }

  const message: WebSocketMessage = {
    type: "stream_progress",
    streamId,
    vestedAmount,
    percentComplete,
    timestamp: Date.now(),
  };

  const data = JSON.stringify(message);

  wss.clients.forEach((client: WebSocket) => {
    const subscribedClient = client as SubscribedWebSocket;
    if (
      client.readyState === WebSocket.OPEN &&
      subscribedClient.subscribedStreams?.has(streamId)
    ) {
      client.send(data, (error) => {
        if (error) {
          logger.warn({ err: error }, "Failed to send WebSocket message");
        }
      });
    }
  });
}

/**
 * Send an event only to clients that have subscribed to the given streamId.
 * Clients subscribed to other streams will not receive this payload.
 */
export function broadcastStreamEvent(
  streamId: string,
  eventType: string,
  data?: Record<string, any>,
): void {
  if (!wss) {
    return;
  }

  const message = {
    type: eventType,
    streamId,
    data,
    timestamp: Date.now(),
  };

  const payload = JSON.stringify(message);

  wss.clients.forEach((client: WebSocket) => {
    const subscribedClient = client as SubscribedWebSocket;
    if (
      client.readyState === WebSocket.OPEN &&
      subscribedClient.subscribedStreams?.has(streamId)
    ) {
      client.send(payload, (error) => {
        if (error) {
          logger.warn({ err: error }, "Failed to send WebSocket event");
        }
      });
    }
  });
}
