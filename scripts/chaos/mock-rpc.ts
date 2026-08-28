/**
 * mock-rpc.ts
 *
 * In-process mock Soroban RPC server used by the chaos test. It implements the
 * JSON-RPC surface that the real indexer's `rpc.Server` talks to:
 *
 *   - `getLatestLedger` → { sequence, ... }
 *   - `getEvents`       → { events, cursor, latestLedger, ... }
 *
 * Events are served deterministically from a pre-built list, paginated with a
 * cursor token exactly like a real Soroban RPC node. Later pages can be
 * artificially delayed so the chaos script can kill the indexer while it is
 * still mid-poll (page 1 committed, checkpoint not yet saved).
 *
 * `topic` and `value` fields are base64 XDR-encoded ScVals, which is what the
 * stellar-sdk expects when parsing raw `getEvents` responses.
 */
import https from 'https';
import { nativeToScVal } from '@stellar/stellar-sdk';

export type ChaosEventType = 'created' | 'claimed';

export interface ChaosEvent {
  streamId: string;
  eventType: ChaosEventType;
  ledger: number;
  ledgerClosedAt: string;
  amount: number;
}

export interface MockRpcOptions {
  contractId: string;
  events: ChaosEvent[];
  latestLedger: number;
  /** Number of events returned per getEvents page. */
  pageSize: number;
  /** Artificial delay (ms) applied to page 2+ responses. */
  pageDelayMs: number;
  /** PEM cert/key for the self-signed HTTPS server. */
  cert: Buffer;
  key: Buffer;
}

export interface MockRpcServer {
  /** Base URL the indexer worker should point its rpc.Server at. */
  url: string;
  getLatestLedgerCallCount: number;
  getEventsCallCount: number;
  pageServedCount: number;
  totalEventsServed: number;
  close(): Promise<void>;
}

/** Stable 56-char G-addresses used inside event payloads. */
const SENDER = 'GSENDER1234567890123456789012345678901234567890123456';
const RECIPIENT = 'GRECIPI1234567890123456789012345678901234567890123456';
const TOKEN = 'GTOKEN12345678901234567890123456789012345678901234567';

/** A single symbol ScVal as base64 XDR (one element of the event topic). */
function symbolBase64(value: string): string {
  return nativeToScVal(value, { type: 'symbol' } as any).toXDR('base64');
}

/**
 * event `value` as a base64 XDR ScVal map that the indexer can decode.
 *
 * Integer fields are encoded as `u32` (with an explicit type hint) so that
 * `scValToNative` returns plain JS numbers — the indexer's `recordEventWithDb`
 * JSON.stringifies the event metadata, which throws on BigInt values.
 */
function valueBase64(ev: ChaosEvent): string {
  const createdTypeHints: Record<string, [string, string]> = {
    stream_id: ['symbol', 'u32'],
    sender: ['symbol', 'string'],
    recipient: ['symbol', 'string'],
    token: ['symbol', 'string'],
    total_amount: ['symbol', 'u32'],
    start_time: ['symbol', 'u32'],
    end_time: ['symbol', 'u32'],
  };
  const claimedTypeHints: Record<string, [string, string]> = {
    stream_id: ['symbol', 'u32'],
    recipient: ['symbol', 'string'],
    amount: ['symbol', 'u32'],
  };

  const value: Record<string, unknown> =
    ev.eventType === 'created'
      ? {
          stream_id: Number(ev.streamId),
          sender: SENDER,
          recipient: RECIPIENT,
          token: TOKEN,
          total_amount: ev.amount,
          start_time: 1_700_000_000,
          end_time: 1_700_003_600,
        }
      : {
          stream_id: Number(ev.streamId),
          recipient: RECIPIENT,
          amount: ev.amount,
        };

  const typeHints =
    ev.eventType === 'created' ? createdTypeHints : claimedTypeHints;
  return nativeToScVal(value, { type: typeHints } as any).toXDR('base64');
}

function toWireEvent(ev: ChaosEvent): Record<string, unknown> {
  return {
    type: 'contract',
    ledger: ev.ledger,
    ledgerClosedAt: ev.ledgerClosedAt,
    pagingToken: `${ev.ledger}-${ev.streamId}`,
    contractId: '', // empty → the SDK skips Contract construction
    id: `0000000000000000000000000000000000000000000000000000000000${ev.ledger}`,
    topic: [
      symbolBase64('Stream'),
      symbolBase64(ev.eventType === 'created' ? 'Created' : 'Claimed'),
    ],
    value: valueBase64(ev),
    inSuccessfulContractCall: true,
  };
}

export function createMockRpcServer(
  opts: MockRpcOptions,
): Promise<MockRpcServer> {
  const eventsByLedger = [...opts.events].sort((a, b) => a.ledger - b.ledger);

  const state = {
    getLatestLedgerCallCount: 0,
    getEventsCallCount: 0,
    pageServedCount: 0,
    totalEventsServed: 0,
    baseStartLedger: 0,
  };

  const server = https.createServer(
    { key: opts.key, cert: opts.cert },
    (req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
      });
      req.on('end', () => {
        let parsed: { id?: unknown; method?: string; params?: any };
        try {
          parsed = JSON.parse(body);
        } catch {
          respond(res, undefined, undefined, {
            code: -32700,
            message: 'parse error',
          });
          return;
        }
        const id = parsed.id;
        if (parsed.method === 'getLatestLedger') {
          state.getLatestLedgerCallCount++;
          respond(res, id, {
            sequence: opts.latestLedger,
            protocolVersion: 22,
            ledgerCloseTime: new Date().toISOString(),
          });
          return;
        }
        if (parsed.method === 'getEvents') {
          state.getEventsCallCount++;
          handleGetEvents(parsed.params ?? {}, res, id);
          return;
        }
        respond(res, id, undefined, {
          code: -32601,
          message: `method not found: ${parsed.method}`,
        });
      });
    },
  );

  function handleGetEvents(params: any, res: any, id: unknown): void {
    const cursor: string | undefined = params.pagination?.cursor;
    const pageIndex = cursor ? parsePageIndex(cursor) : 0;
    const startLedger = Number(params.startLedger ?? 1);
    if (pageIndex === 0) {
      state.baseStartLedger = startLedger;
    }
    const base =
      state.baseStartLedger > 0 ? state.baseStartLedger : startLedger;
    const fromLedger = base + pageIndex * opts.pageSize;

    const slice = eventsByLedger
      .filter((e) => e.ledger >= fromLedger)
      .slice(0, opts.pageSize);
    state.pageServedCount++;
    state.totalEventsServed += slice.length;

    const hasMore = eventsByLedger.some(
      (e) => e.ledger >= fromLedger + slice.length,
    );
    // Page 1 is served immediately; later pages are delayed so the chaos test
    // has a deterministic window in which the worker is "mid-poll".
    const delayMs = pageIndex === 0 ? 0 : opts.pageDelayMs;

    setTimeout(() => {
      respond(res, id, {
        events: slice.map(toWireEvent),
        cursor: hasMore ? `page-${pageIndex + 1}` : null,
        latestLedger: opts.latestLedger,
        oldestLedger: base,
        latestLedgerCloseTime: new Date().toISOString(),
        oldestLedgerCloseTime: new Date().toISOString(),
      });
    }, delayMs);
  }

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as { port: number };
      resolve({
        url: `https://127.0.0.1:${address.port}`,
        get getLatestLedgerCallCount() {
          return state.getLatestLedgerCallCount;
        },
        get getEventsCallCount() {
          return state.getEventsCallCount;
        },
        get pageServedCount() {
          return state.pageServedCount;
        },
        get totalEventsServed() {
          return state.totalEventsServed;
        },
        close: () =>
          new Promise<void>((closeResolve) => {
            server.close(() => closeResolve());
          }),
      });
    });
  });
}

function parsePageIndex(cursor: string): number {
  const m = /^page-(\d+)$/.exec(cursor);
  return m ? Number(m[1]) : 0;
}

function respond(
  res: any,
  id: unknown,
  result?: unknown,
  error?: { code: number; message: string },
): void {
  res.writeHead(error ? 400 : 200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify(
      error
        ? { jsonrpc: '2.0', id: id ?? null, error }
        : { jsonrpc: '2.0', id: id ?? null, result },
    ),
  );
}
