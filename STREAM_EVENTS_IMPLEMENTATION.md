# Stream Event History Implementation

## Overview

StellarStream tracks the full lifecycle of every payment stream as an immutable
event history. Each stream produces a chronological list of events (created,
claimed, canceled, paused, resumed, etc.) that is stored in the backend
database, surfaced through REST API endpoints, and rendered in the frontend
timeline / activity feeds.

Events are produced from **two independent sources**:

| Source | Path | Description |
|--------|------|-------------|
| **Off-chain (backend services)** | `backend/src/services/streamStore.ts`, `backend/src/index.ts` | Events recorded synchronously whenever a local action is performed (create, cancel, pause, resume, claim, start-time update, completion) |
| **On-chain (indexer)** | `backend/src/services/indexer.ts` | Background worker that polls Soroban RPC and records events emitted by the smart contract (`contracts/src/lib.rs`) |

This document is the authoritative reference for:

- Every event type and its payload
- How each event is processed by the indexer
- How each event is rendered in the frontend
- How to add a new event type

## Architecture

```
                ┌──────────────────────────────────────────────┐
                │                  Frontend (React)            │
                │  DashboardPage  StreamsTable  SenderDashboard│
                │        │ StreamTimeline / StreamDetailDrawer │
                └───────────────┬──────────────────────────────┘
                                │  GET /api/events
                                │  GET /api/streams/:id/history
                                │  GET /api/streams/:id/snapshot
                                ▼
                ┌──────────────────────────────────────────────┐
                │              Backend API (Express)           │
                │      backend/src/index.ts  (REST routes)     │
                └───────┬──────────────────────────┬───────────┘
                        │                          │
                        │  writes                  │  writes
                        ▼                          ▼
        ┌───────────────────────────┐   ┌─────────────────────────────┐
        │   Off-chain events        │   │  On-chain events (indexer)  │
        │   streamStore.ts /        │   │  backend/src/services/      │
        │   index.ts claim route    │   │  indexer.ts                  │
        └───────────┬───────────────┘   └──────────────┬──────────────┘
                    │                                  │
                    └───────────────┬──────────────────┘
                                    ▼
                    ┌──────────────────────────────┐
                    │  stream_events table (SQLite)│
                    │  backend/src/services/db.ts  │
                    └──────────────────────────────┘
                                    │
                                    ▼
                    ┌──────────────────────────────┐
                    │  eventHistory service        │
                    │  backend/src/services/       │
                    │  eventHistory.ts             │
                    └──────────────────────────────┘
```

### Event lifecycle

1. **Source** — An event fires either when a backend action executes
   (off-chain) or when the smart contract publishes a Soroban contract event
   (on-chain).
2. **Record** — `recordEventWithDb()` inserts a row into `stream_events` inside
   the same transaction as the state change (off-chain) or inside the indexer's
   batch transaction (on-chain). Duplicate `(stream_id, event_type,
   ledger_sequence)` rows are skipped via `INSERT OR IGNORE`.
3. **Expose** — The REST endpoints read events back through the
   `eventHistory.ts` helpers (`getStreamHistory`, `getGlobalEvents`,
   `getStreamEventSummary`, etc.).
4. **Render** — The frontend fetches and displays events in the activity feed
   (`StreamTimeline`), the stream detail drawer, and the sender dashboard.

## Event Type Catalog

### Status legend

- ✅ **Current** — fully implemented end-to-end (recorded, exposed, rendered)
- 🚧 **Planned** — designed and partially wired, but not emitted/processed yet

| Event type | Status | Off-chain source | On-chain source (indexer) | Frontend rendering |
|-----------|--------|------------------|---------------------------|--------------------|
| `created` | ✅ | `createStream()`, reconciliation backfill | `Created` → `created` | ✅ Timeline, drawer, sender feed |
| `claimed` | ✅ | Claim route (`POST /api/streams/:id/claim`) | `Claimed` → `claimed` | ✅ Timeline, drawer, sender feed |
| `canceled` | ✅ | `cancelStream()` | `Canceled` → `canceled` | ✅ Timeline, drawer, sender feed |
| `start_time_updated` | ✅ | `updateStreamStartAt()` | — (off-chain only) | ✅ Timeline, drawer, sender feed |
| `paused` | ✅ | `pauseStream()` | `Paused` → `paused` | ✅ Timeline, drawer, sender feed |
| `resumed` | ✅ | `resumeStream()` | `Resumed` → `resumed` | ✅ Timeline, drawer, sender feed |
| `completed` | ✅ | `refreshStreamStatuses()`, `markStreamComplete()` | — (off-chain only) | ⚠️ Default styling only |
| `transferred` | ✅ | — | `Transfer` → `transferred` | ⚠️ Default styling only |
| `cliff_reached` | 🚧 | not emitted | not indexed | Type declared in `api.ts` only |
| `clawback` | 🚧 | not emitted | `Clawback` emitted on-chain but **not indexed** | — |

> The backend `StreamEventType` union in
> `backend/src/services/eventHistory.ts:3` defines the current canonical set:
> `created | claimed | canceled | start_time_updated | paused | resumed |
> completed | transferred`.

---

### `created`

- **Status:** ✅ Current
- **Triggered when:** A new stream is created (off-chain) or the smart
  contract emits the `Created` event (on-chain).
- **Payload fields**

  | Field | Type | Description |
  |-------|------|-------------|
  | `streamId` | `string` | Stream ID |
  | `eventType` | `"created"` | Event discriminator |
  | `timestamp` | `number` | Unix time (seconds) when the event occurred |
  | `actor` | `string` | Sender address that created the stream |
  | `amount` | `number` | Total amount allocated to the stream |
  | `metadata` | `object` | `recipient`, plus `token`/`startTime`/`endTime` (indexer) or `assetCode`/`durationSeconds`/`source` (off-chain) |
  | `ledgerSequence` | `number?` | Soroban ledger when indexed on-chain |

- **Off-chain emission** — `streamStore.createStream()` writes the stream row
  and the event atomically. Metadata: `{ recipient, assetCode,
  durationSeconds }`. The reconciliation worker also backfills a `created`
  event (with `metadata.source = "reconciliation"`) for streams that predate
  event tracking, guarded by `streamHasEvent(stream.id, "created")`.
- **Indexer processing** — `processEvent()` in `backend/src/services/indexer.ts`
  maps the contract topic `("Stream", "Created")` to `created` and records
  `actor = value.sender`, `amount = value.total_amount`, and metadata
  `{ recipient, token, startTime, endTime }`.
- **Frontend rendering** — StreamTimeline shows the 🚀 icon, title *"Stream
  created"*, and description *"Initiated by {actor} for {amount} tokens"*.
  StreamDetailDrawer shows the ✦ icon and label *"Stream created"*.
  SenderDashboard shows *"Stream created ({amount} {assetCode})"*.

---

### `claimed`

- **Status:** ✅ Current
- **Triggered when:** Tokens are claimed from a stream (off-chain claim
  route) or the smart contract emits the `Claimed` event (on-chain).
- **Payload fields**

  | Field | Type | Description |
  |-------|------|-------------|
  | `streamId` | `string` | Stream ID |
  | `eventType` | `"claimed"` | Event discriminator |
  | `timestamp` | `number` | Unix time (seconds) |
  | `actor` | `string` | Recipient who claimed |
  | `amount` | `number` | Claimed amount |
  | `metadata` | `object` | `{ assetCode }` (off-chain route) |
  | `ledgerSequence` | `number?` | Soroban ledger when indexed on-chain |

- **Off-chain emission** — `POST /api/streams/:id/claim` in
  `backend/src/index.ts` records `claimed` with `amount = vestedAmount` and
  `metadata = { assetCode }` inside an atomic transaction that also guards
  against double claims (409 if already claimed).
- **Indexer processing** — `processEvent()` maps `("Stream", "Claimed")` to
  `claimed` and records `actor = value.recipient`, `amount = value.amount`.
- **Frontend rendering** — StreamTimeline shows the 💸 icon, title *"Stream
  claimed"*, description *"Claim of {amount} tokens processed by {actor}"*.
  StreamDetailDrawer shows the ↓ icon and label *"Tokens claimed"*.
  SenderDashboard shows *"Claimed {amount} {assetCode}"*.

---

### `canceled`

- **Status:** ✅ Current
- **Triggered when:** A stream is canceled (off-chain) or the smart contract
  emits the `Canceled` event (on-chain).
- **Payload fields**

  | Field | Type | Description |
  |-------|------|-------------|
  | `streamId` | `string` | Stream ID |
  | `eventType` | `"canceled"` | Event discriminator |
  | `timestamp` | `number` | Unix time (seconds) |
  | `actor` | `string` | Sender who canceled |
  | `ledgerSequence` | `number?` | Soroban ledger when indexed on-chain |

- **Off-chain emission** — `cancelStream()` in `streamStore.ts` writes the
  canceled stream row and the `canceled` event atomically.
- **Indexer processing** — `processEvent()` maps `("Stream", "Canceled")` to
  `canceled` and records `actor = value.sender`.
- **Frontend rendering** — StreamTimeline shows the ❌ icon, title *"Stream
  canceled"*, description *"Closed by {actor}"*. StreamDetailDrawer shows the
  ✕ icon and label *"Stream canceled"*. SenderDashboard shows *"Stream
  canceled"*.

---

### `start_time_updated`

- **Status:** ✅ Current
- **Triggered when:** The start time of a scheduled (not yet started) stream
  is modified.
- **Payload fields**

  | Field | Type | Description |
  |-------|------|-------------|
  | `streamId` | `string` | Stream ID |
  | `eventType` | `"start_time_updated"` | Event discriminator |
  | `timestamp` | `number` | Unix time (seconds) |
  | `actor` | `string` | Sender who updated the start time |
  | `metadata` | `object` | `{ oldStartAt, newStartAt }` |

- **Off-chain emission** — `updateStreamStartAt()` in `streamStore.ts`
  records `start_time_updated` with `metadata = { oldStartAt, newStartAt }`.
- **Indexer processing** — None. The contract has no start-time update event;
  this event type is off-chain only.
- **Frontend rendering** — StreamTimeline shows the 🕐 icon, title *"Start time
  updated"*, description *"New start time set by {actor}"*. StreamDetailDrawer
  shows the ✎ icon and label *"Start time updated"*. SenderDashboard shows
  *"Start time updated"*.

---

### `paused`

- **Status:** ✅ Current
- **Triggered when:** An active stream is paused (off-chain) or the smart
  contract emits the `Paused` event (on-chain).
- **Payload fields**

  | Field | Type | Description |
  |-------|------|-------------|
  | `streamId` | `string` | Stream ID |
  | `eventType` | `"paused"` | Event discriminator |
  | `timestamp` | `number` | Unix time (seconds) |
  | `actor` | `string` | Sender who paused |
  | `ledgerSequence` | `number?` | Soroban ledger when indexed on-chain |

- **Off-chain emission** — `pauseStream()` in `streamStore.ts` records
  `paused` atomically with the stream row update.
- **Indexer processing** — `processEvent()` maps `("Stream", "Paused")` to
  `paused` and records `actor = value.sender`.
- **Frontend rendering** — StreamTimeline shows the ⏸️ icon, title *"Stream
  paused"*, description *"Stream paused by {actor}"*. StreamDetailDrawer shows
  the ⏸ icon and label *"Stream paused"*. SenderDashboard shows *"Stream
  paused"*.

---

### `resumed`

- **Status:** ✅ Current
- **Triggered when:** A paused stream is resumed (off-chain) or the smart
  contract emits the `Resumed` event (on-chain).
- **Payload fields**

  | Field | Type | Description |
  |-------|------|-------------|
  | `streamId` | `string` | Stream ID |
  | `eventType` | `"resumed"` | Event discriminator |
  | `timestamp` | `number` | Unix time (seconds) |
  | `actor` | `string` | Sender who resumed |
  | `metadata` | `object` | `{ pausedDuration }` (off-chain) |
  | `ledgerSequence` | `number?` | Soroban ledger when indexed on-chain |

- **Off-chain emission** — `resumeStream()` in `streamStore.ts` records
  `resumed` with `metadata = { pausedDuration }`.
- **Indexer processing** — `processEvent()` maps `("Stream", "Resumed")` to
  `resumed` and records `actor = value.sender`.
- **Frontend rendering** — StreamTimeline shows the ▶️ icon, title *"Stream
  resumed"*, description *"Stream resumed by {actor}"*. StreamDetailDrawer
  shows the ▶ icon and label *"Stream resumed"*. SenderDashboard shows *"Stream
  resumed"*.

---

### `completed`

- **Status:** ✅ Current
- **Triggered when:** A stream finishes vesting. `refreshStreamStatuses()`
  auto-completes streams whose `start_at + duration_seconds` has elapsed, and
  `markStreamComplete()` manually completes a fully-vested stream.
- **Payload fields**

  | Field | Type | Description |
  |-------|------|-------------|
  | `streamId` | `string` | Stream ID |
  | `eventType` | `"completed"` | Event discriminator |
  | `timestamp` | `number` | Unix time (seconds) |
  | `actor` | `string` | Sender of the stream |

- **Off-chain emission** — both paths call `recordEventWithDb(db, id,
  "completed", at, sender)`. Guarded with `streamHasEvent(id, "completed")` so
  it is only recorded once per stream.
- **Indexer processing** — None. The contract does not emit a completion
  event; completion is derived locally from timestamps.
- **Frontend rendering** — Falls back to the default 📋 icon / *"Stream event"*
  title in `StreamTimeline` and the default • icon in `StreamDetailDrawer`
  (no dedicated styling yet). Not included in the filter buttons.

---

### `transferred`

- **Status:** ✅ Current
- **Triggered when:** A stream recipient transfers their stream to a new
  recipient on-chain (the smart contract emits the `Transfer` event).
- **Payload fields**

  | Field | Type | Description |
  |-------|------|-------------|
  | `streamId` | `string` | Stream ID |
  | `eventType` | `"transferred"` | Event discriminator |
  | `timestamp` | `number` | Unix time (seconds) |
  | `actor` | `string` | Previous recipient (`old_recipient`) |
  | `metadata` | `object` | `{ new_recipient }` |

- **Indexer processing** — `processEvent()` maps `("Stream", "Transfer")` to
  `transferred` and records `actor = value.old_recipient`, metadata
  `{ new_recipient: value.new_recipient }`.
- **Off-chain emission** — None; this event is indexer-only.
- **Frontend rendering** — Falls back to the default 📋 icon / *"Stream event"*
  title in `StreamTimeline` (no dedicated styling yet). Not included in the
  filter buttons.

---

### `cliff_reached` (planned)

- **Status:** 🚧 Planned
- **Description:** Would fire when a stream with a cliff (`cliff_seconds > 0`)
  reaches its cliff release point. The contract already records
  `cliff_seconds` in `StreamCreated` and the frontend renders a
  `CliffMarker`, but no `cliff_reached` event is emitted today.
- **Current wiring:** `cliff_reached` is declared in the frontend
  `StreamEvent` union (`frontend/src/services/api.ts:286`) but is never
  emitted by the backend, indexed, or rendered. Do not rely on it yet.

### `clawback` (planned)

- **Status:** 🚧 Planned
- **Description:** The smart contract's `clawback()` publishes a `Clawback`
  event (`ClawbackExecuted { stream_id, amount, recipient }`), but the indexer
  currently has **no** case for it, so it is never persisted.
- **Current wiring:** `contracts/src/lib.rs:638` emits it; nothing else
  consumes it.

---

## Indexer Processing

The indexer (`backend/src/services/indexer.ts`) polls Soroban RPC every
**10 seconds** (configurable via `startIndexer(intervalMs)`), starting from the
last processed ledger. It fetches all contract events for the configured
`CONTRACT_ID`, then applies the following mapping:

| Soroban topic | `eventName` (topic[1]) | Recorded `event_type` | Actor | Amount | Metadata |
|---------------|------------------------|-----------------------|-------|--------|----------|
| `("Stream", "Created")` | `Created` | `created` | `value.sender` | `value.total_amount` | `{ recipient, token, startTime, endTime }` |
| `("Stream", "Claimed")` | `Claimed` | `claimed` | `value.recipient` | `value.amount` | — |
| `("Stream", "Canceled")` | `Canceled` | `canceled` | `value.sender` | — | — |
| `("Stream", "Paused")` | `Paused` | `paused` | `value.sender` | — | — |
| `("Stream", "Resumed")` | `Resumed` | `resumed` | `value.sender` | — | — |
| `("Stream", "Transfer")` | `Transfer` | `transferred` | `value.old_recipient` | — | `{ new_recipient }` |
| `("Stream", "Clawback")` | `Clawback` | ⚠️ **not processed** | — | — | — |

Key implementation notes:

- Event topics are `[contract_symbol, event_name]`; events with fewer than two
  topics are skipped.
- `timestamp` is derived from `event.ledgerClosedAt` (Unix seconds).
- `ledger_sequence` is stored so the unique index
  `idx_stream_events_dedup (stream_id, event_type, ledger_sequence)` prevents
  duplicates across indexer restarts.
- The batch (events + cursor advance) runs in a single database transaction
  (`db.transaction(...)`) so a crash mid-batch cannot produce partial state.
- A circuit breaker (`CircuitBreaker`, threshold of 5 failures) pauses polling
  after repeated RPC failures; the state is exposed as an indexer metric.
- Each processed event increments the `eventsIndexedTotal` Prometheus counter;
  failed runs increment `indexerErrorsTotal`.
- `INDEXER_START_LEDGER` can override the starting ledger; `indexer_cursor`
  tracks the last processed ledger across restarts.
- Off-chain event types (`start_time_updated`, `completed`) are **not** part of
  indexer processing — they are recorded by `streamStore.ts` / `index.ts`.

## Frontend Rendering

### `StreamTimeline` (`frontend/src/components/StreamTimeline.tsx`)

Used on the dashboard home page (`DashboardPage`, global feed via
`listAllEvents`) and inside the streams table drawer (`StreamsTable`, per-stream
via `getStreamHistory`).

| Event type | Icon | Title | Description |
|-----------|------|-------|-------------|
| `created` | 🚀 | Stream created | `Initiated by {actor} for {amount} tokens` |
| `claimed` | 💸 | Stream claimed | `Claim of {amount} tokens processed by {actor}` |
| `canceled` | ❌ | Stream canceled | `Closed by {actor}` |
| `start_time_updated` | 🕐 | Start time updated | `New start time set by {actor}` |
| `paused` | ⏸️ | Stream paused | `Stream paused by {actor}` |
| `resumed` | ▶️ | Stream resumed | `Stream resumed by {actor}` |
| *(default)* | 📋 | Stream event | `Action performed by {actor}` |

Filter buttons (`FILTER_BUTTONS`) are rendered for `created`, `claimed`,
`canceled`, `start_time_updated`, `paused`, and `resumed`. Events are sorted
chronologically and each row shows the actor via `CopyableAddress`.

### `StreamDetailDrawer` (`frontend/src/components/StreamDetailDrawer.tsx`)

Renders the per-stream "Event History" list in the detail drawer.

| Event type | Icon | Label |
|-----------|------|-------|
| `created` | ✦ | Stream created |
| `claimed` | ↓ | Tokens claimed |
| `canceled` | ✕ | Stream canceled |
| `start_time_updated` | ✎ | Start time updated |
| `paused` | ⏸ | Stream paused |
| `resumed` | ▶ | Stream resumed |
| *(default)* | • | raw event type |

Rows display the timestamp, actor, amount (when present), and a Stellar
Expert `TxHashLink` when `txHash` is present.

### `SenderDashboard` (`frontend/src/components/SenderDashboard.tsx`)

Shows a "Recent Activity" feed aggregated from all of a sender's streams via
`getSenderEvents()` (fetches each stream's history, merges, sorts newest first,
default limit 10, refetched every 5 s).

| Event type | Label |
|-----------|-------|
| `created` | `Stream created ({amount} {assetCode})` |
| `claimed` | `Claimed {amount} {assetCode}` |
| `canceled` | `Stream canceled` |
| `paused` | `Stream paused` |
| `resumed` | `Stream resumed` |
| `start_time_updated` | `Start time updated` |
| *(default)* | raw event type |

## How to Add a New Event Type

Adding a new stream event touches every layer. Follow these steps in order:

### 1. Contract — emit the event (on-chain events only)

In `contracts/src/lib.rs`, publish the event with a `Stream`-prefixed topic:

```rust
env.events().publish(
    (symbol_short!("Stream"), symbol_short!("EventName")),
    EventPayloadStruct { stream_id, /* ... */ },
);
```

Add a matching event struct via `#[contracttype]`, and add a unit test in
`contracts/src/test.rs` asserting the event is emitted with the correct fields
(see `test_clawback_emits_event()` for the pattern).

### 2. Backend — add the type to the union

Extend `StreamEventType` in `backend/src/services/eventHistory.ts`:

```typescript
export type StreamEventType =
  | "created" | "claimed" | "canceled" | "start_time_updated"
  | "paused" | "resumed" | "completed" | "transferred"
  | "your_new_event";
```

### 3. Backend — record the event

- **On-chain events:** add a `case "EventName":` to `processEvent()` in
  `backend/src/services/indexer.ts`, calling `recordEventWithDb(...)` with the
  same fields as the existing cases (include `event.ledger` as
  `ledgerSequence`).
- **Off-chain events:** call `recordEventWithDb(db, streamId, "your_new_event",
  timestamp, actor, amount, metadata)` inside the same transaction as the
  state mutation in `backend/src/services/streamStore.ts` (or the relevant
  route in `backend/src/index.ts`).

### 4. Backend — expose it

The existing helpers (`getStreamHistory`, `getGlobalEvents`, `getStreamEventSummary`)
are type-generic and need no changes. If the event needs filtering, ensure the
validation schema `listEventsQuerySchema` (`backend/src/validation/schemas.ts`)
accepts the new value.

### 5. Backend — tests

Add/extend tests:

- `backend/src/services/eventHistory.test.ts` — record and query the new type.
- `backend/src/services/indexer.test.ts` — assert the indexer maps the new
  contract topic to the new event type.
- `backend/src/integration.test.ts` — assert the history endpoints return it.

### 6. Frontend — add the type to the union

Extend `StreamEvent["eventType"]` in `frontend/src/services/api.ts`:

```typescript
eventType:
  | "created" | "claimed" | "canceled" | "start_time_updated"
  | "paused" | "resumed" | "cliff_reached" | "your_new_event";
```

### 7. Frontend — render it

- `frontend/src/components/StreamTimeline.tsx` — add cases to
  `getEventIcon()`, `formatEventTitle()`, `getEventDescription()`, and (if it
  should be filterable) `FILTER_BUTTONS`.
- `frontend/src/components/StreamDetailDrawer.tsx` — add cases to
  `eventIcon()` and `eventLabel()`.
- `frontend/src/components/SenderDashboard.tsx` — add a case to
  `getEventLabel()`.

### 8. Frontend — tests

Extend `frontend/src/components/StreamTimeline.test.tsx` and
`StreamDetailDrawer.test.tsx` to cover the new icon/title/description.

### Checklist

- [ ] Contract event published (on-chain only)
- [ ] Backend `StreamEventType` union updated
- [ ] Indexer `processEvent()` case added (on-chain only)
- [ ] Off-chain `recordEventWithDb(...)` call added (off-chain only)
- [ ] Backend tests green (`cd backend && npm run test`)
- [ ] Frontend `StreamEvent` union updated
- [ ] `StreamTimeline` icon/title/description (and filter button if desired)
- [ ] `StreamDetailDrawer` icon/label
- [ ] `SenderDashboard` label
- [ ] Frontend tests green (`cd frontend && npm run test`)
- [ ] This document updated (catalog table, indexer table, rendering table)

## Data Persistence

- Events are stored in the `stream_events` table (SQLite by default,
  PostgreSQL when `DATABASE_URL` is set).
- Schema is defined in `backend/migrations/001_initial_schema.sql`:
  - `id` (auto-increment PK), `stream_id` (FK → streams), `event_type`,
    `ledger_sequence`, `timestamp`, `actor`, `amount`, `metadata` (JSON string)
  - Indexes: `idx_stream_events_stream_id`, `idx_stream_events_timestamp`
  - Partial unique index `idx_stream_events_dedup` on
    `(stream_id, event_type, ledger_sequence) WHERE ledger_sequence IS NOT NULL`
- SQLite uses WAL mode; events persist across backend restarts and the indexer
  resumes from the last processed ledger.
- PostgreSQL writes are translated in `backend/src/services/db.ts`
  (`INSERT OR IGNORE` → `ON CONFLICT ... DO NOTHING`).

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/events` | Global event feed. Query params: `eventType`, `streamId`, `since`, `page`, `pageSize`/`limit`, `cursor` |
| `GET /api/streams/:id/history` | Paginated history for one stream (`page`, `pageSize`; returns `{ data, total, page, pageSize, hasMore }`) |
| `GET /api/streams/:id/history/summary` | Aggregate summary: `totalEvents`, `byType`, `firstEventAt`, `lastEventAt` |
| `GET /api/streams/:id/snapshot` | Stream details + progress + first 50 history events (ascending) |
| `POST /api/streams/:id/claim` | Records a `claimed` event and returns the updated `history` in the response |

`/api/events` and the history routes are read-only and rate limited
(`READ_RATE_LIMIT`); mutation routes are protected by `authMiddleware` where
configured.

## Usage

### Backend

The indexer starts automatically on server startup when `CONTRACT_ID` is set:

```typescript
await initSoroban();
await syncStreams();

const rpcUrl = process.env.RPC_URL || "https://soroban-testnet.stellar.org:443";
const contractId = process.env.CONTRACT_ID;
const networkPassphrase = process.env.NETWORK_PASSPHRASE;

if (contractId) {
  initIndexer(rpcUrl, contractId, networkPassphrase);
  startIndexer(10000); // Poll every 10 seconds
}
```

### Frontend

Use the `StreamTimeline` component (global feed when no `streamId` is given):

```tsx
import { StreamTimeline } from "./components/StreamTimeline";

function StreamDetails({ streamId }: { streamId: string }) {
  return (
    <div>
      <StreamTimeline streamId={streamId} />
    </div>
  );
}
```

Or fetch events directly:

```typescript
import { getStreamHistory, listAllEvents } from "./services/api";

const history = await getStreamHistory("123");
const globalFeed = await listAllEvents();
console.log(history);
```

## Testing

1. Start the backend:
   ```bash
   cd backend
   npm install
   npm run dev
   ```
2. Create a stream via the API.
3. Check the history endpoint:
   ```bash
   curl http://localhost:3001/api/streams/1/history
   ```
4. Cancel, pause, resume, or claim from the stream.
5. Verify new events appear in the history.

Automated tests:

- Backend: `cd backend && npm run test`
- Frontend: `cd frontend && npm run test`

## Acceptance Criteria ✅

- ✅ All event types documented (`created`, `claimed`, `canceled`,
  `start_time_updated`, `paused`, `resumed`, `completed`, `transferred`)
- ✅ How-to for new events is clear (see "How to Add a New Event Type")
- ✅ Current vs planned clearly marked (✅ / 🚧 in the catalog, plus
  `cliff_reached` and `clawback` as planned)
- ✅ Indexer processing documented for every on-chain event type
- ✅ Frontend rendering documented for every event type
- ✅ History endpoints return ordered lifecycle events
- ✅ Events persist across backend restarts (SQLite database)
- ✅ Indexer worker stores event history automatically
