# Stream Event History Implementation

## 📋 Overview
This implementation provides comprehensive event history tracking for stream lifecycle actions. The system captures contract events, stores them in a database, and provides APIs for frontend consumption.

## 🏗️ Architecture Components

### 1. Database Schema (`backend/src/services/db.ts`)
**Current Implementation:**
```sql
CREATE TABLE stream_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  stream_id       TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  ledger_sequence INTEGER,
  timestamp       INTEGER NOT NULL,
  actor           TEXT,
  amount          REAL,
  metadata        TEXT
);

-- Unique constraint to prevent duplicate event processing
CREATE UNIQUE INDEX idx_stream_events_dedup
  ON stream_events(stream_id, event_type, ledger_sequence)
  WHERE ledger_sequence IS NOT NULL;
```

**Indexes:**
- `stream_id` + `timestamp` for efficient stream history queries
- `event_type` for filtering capabilities
- `timestamp` for global event feeds

### 2. Event Types System (`backend/src/services/eventHistory.ts`)
**Current Event Types:**
```typescript
export type StreamEventType = 
  | "created"            // Stream creation
  | "claimed"            // Token claims
  | "canceled"           // Stream cancellation
  | "start_time_updated" // Start time modification
  | "paused"             // Stream pause
  | "resumed"            // Stream resume
  | "completed"          // Stream completion
  | "transferred"        // Recipient transfer
  | "clawback"           // Admin clawback
  | "cliff_reached";     // Cliff period reached
```

**Event Interface:**
```typescript
export interface StreamEvent {
  id: number;
  streamId: string;
  eventType: StreamEventType;
  ledgerSequence?: number;
  timestamp: number;
  actor?: string;
  amount?: number;
  metadata?: Record<string, any>;
}
```

### 3. Event Indexer (`backend/src/services/indexer.ts`)
**Current Implementation State:**
- ✅ **Polling-based**: Queries Soroban RPC every 10 seconds (configurable)
- ✅ **Circuit Breaker**: Prevents cascading failures with configurable thresholds
- ✅ **Checkpoint Persistence**: Resumes from last processed ledger after restart
- ✅ **Duplicate Prevention**: Uses unique constraint on (stream_id, event_type, ledger_sequence)
- ✅ **Error Resilience**: Graceful handling of RPC failures and malformed events

**Indexer Configuration:**
```typescript
// Environment variables with defaults
const FALLBACK_POLLING_ENABLED = process.env.INDEXER_FALLBACK_POLLING_ENABLED === "true";
const FALLBACK_POLL_INTERVAL_MS = Number(process.env.INDEXER_FALLBACK_POLL_INTERVAL_MS ?? 10000);
const CIRCUIT_BREAKER_TIMEOUT_MS = Number(process.env.CIRCUIT_BREAKER_TIMEOUT_MS ?? 60000);
```

### 4. Frontend API Service (`frontend/src/services/api.ts`)
**Current Implementation:**
```typescript
export interface StreamEvent {
  id: number;
  streamId: string;
  eventType: "created" | "claimed" | "canceled" | "start_time_updated" | "paused" | "resumed" | "cliff_reached";
  timestamp: number;
  actor?: string;
  amount?: number;
  txHash?: string;
  metadata?: Record<string, any>;
}

// Core API functions
export async function getStreamHistory(streamId: string): Promise<StreamEvent[]>;
export async function listAllEvents(): Promise<StreamEvent[]>;
export async function getSenderEvents(senderAddress: string, limit: number = 10): Promise<StreamEvent[]>;
```

### 5. Timeline Component (`frontend/src/components/StreamTimeline.tsx`)
**Current Features:**
- ✅ **Chronological Display**: Events sorted by timestamp
- ✅ **Visual Icons**: Unique emoji for each event type
- ✅ **Filtering**: Interactive filter bar with 6 event types
- ✅ **Responsive Design**: Mobile-friendly layout
- ✅ **Loading States**: Skeleton loaders and error handling
- ✅ **Global Feed**: Display events across all streams

**Filter Support:**
```typescript
export const FILTER_BUTTONS: Array<{ type: EventType; label: string }> = [
  { type: "created", label: "Created" },
  { type: "claimed", label: "Claimed" },
  { type: "canceled", label: "Canceled" },
  { type: "start_time_updated", label: "Start Time Updated" },
  { type: "paused", label: "Paused" },
  { type: "resumed", label: "Resumed" },
];
```

## 📊 Current Event Types & Payloads

### 1. **`created`** - Stream Creation
**Contract Event:** `StreamCreated`
**Payload:**
```typescript
{
  stream_id: string;
  sender: string;
  total_amount: number;
  recipient: string;
  asset_code: string;
  duration: number;
  start_at?: number; // Optional for scheduled streams
}
```
**Frontend Rendering:** 🚀 "Stream created" - Initiated by [actor] for [amount] tokens

### 2. **`claimed`** - Token Claim
**Contract Event:** `StreamClaimed`
**Payload:**
```typescript
{
  stream_id: string;
  recipient: string;
  claimed_amount: number;
}
```
**Frontend Rendering:** 💸 "Stream claimed" - Claim of [amount] tokens processed by [actor]

### 3. **`canceled`** - Stream Cancellation
**Contract Event:** `StreamCanceled`
**Payload:**
```typescript
{
  stream_id: string;
  sender: string;
  refunded_amount: number;
}
```
**Frontend Rendering:** ❌ "Stream canceled" - Closed by [actor]

### 4. **`start_time_updated`** - Start Time Modification
**Contract Event:** `StreamStartTimeUpdated`
**Payload:**
```typescript
{
  stream_id: string;
  sender: string;
  old_start_at: number;
  new_start_at: number;
}
```
**Frontend Rendering:** 🕐 "Start time updated" - New start time set by [actor]

### 5. **`paused`** - Stream Pause
**Contract Event:** `StreamPaused`
**Payload:**
```typescript
{
  stream_id: string;
  sender: string;
  paused_at: number;
}
```
**Frontend Rendering:** ⏸️ "Stream paused" - Stream paused by [actor]

### 6. **`resumed`** - Stream Resume
**Contract Event:** `StreamResumed`
**Payload:**
```typescript
{
  stream_id: string;
  sender: string;
  resumed_at: number;
}
```
**Frontend Rendering:** ▶️ "Stream resumed" - Stream resumed by [actor]

### 7. **`completed`** - Stream Completion
**Contract Event:** `StreamCompleted`
**Payload:**
```typescript
{
  stream_id: string;
  actor: string; // Could be sender or recipient
  total_amount: number;
}
```
**Frontend Rendering:** ✅ "Stream completed" - Stream completed by [actor]

### 8. **`transferred`** - Recipient Transfer
**Contract Event:** `StreamTransferred`
**Payload:**
```typescript
{
  stream_id: string;
  old_recipient: string;
  new_recipient: string;
}
```
**Frontend Rendering:** 🔄 "Stream transferred" - Transferred from [old_recipient] to [new_recipient]

### 9. **`clawback`** - Admin Clawback
**Contract Event:** `StreamClawback`
**Payload:**
```typescript
{
  stream_id: string;
  admin: string;
  amount: number;
  recipient: string;
}
```
**Frontend Rendering:** ⚡ "Clawback executed" - [amount] tokens clawed back by admin

### 10. **`cliff_reached`** - Cliff Period Reached
**Contract Event:** `StreamCliffReached`
**Payload:**
```typescript
{
  stream_id: string;
  cliff_amount: number;
  available_at: number;
}
```
**Frontend Rendering:** 🧗 "Cliff period reached" - [amount] tokens now available

## 🔄 Indexer Processing for Each Event Type

### Processing Pipeline:
```
Soroban RPC → Contract Events → Parse & Validate → Store in Database
      ↓               ↓               ↓                 ↓
  Poll every    Filter by       Extract event     Insert with
  10 seconds   contract ID      data & metadata   deduplication
```

### Event Processing Logic (`indexer.ts`):
```typescript
// Example: Processing a "Claimed" event
case "Claimed":
  recordEventWithDb(
    db,
    value.stream_id.toString(),
    "claimed",
    timestamp,
    value.recipient, // actor
    value.claimed_amount, // amount
    undefined, // metadata
    event.ledger, // ledger sequence
  );
  break;

// Example: Processing a "Paused" event with metadata
case "Paused":
  recordEventWithDb(
    db,
    value.stream_id.toString(),
    "paused",
    timestamp,
    value.sender, // actor
    undefined, // amount
    { paused_at: value.paused_at }, // metadata
    event.ledger,
  );
  break;
```

### Circuit Breaker States:
1. **CLOSED** (0): Normal operation, events processed
2. **HALF_OPEN** (1): Testing if RPC is back online
3. **OPEN** (2): Circuit open, no event processing

## 🎨 Frontend Rendering for Each Event

### Timeline Item Component:
```typescript
function TimelineItem({ event }: { event: StreamEvent }) {
  return (
    <div className="timeline-item">
      <div className="timeline-icon">{getEventIcon(event.eventType)}</div>
      <div className="timeline-content">
        <h4>{formatEventTitle(event.eventType)}</h4>
        <p>{getEventDescription(event)}</p>
        <time>{formatTimestamp(event.timestamp)}</time>
      </div>
    </div>
  );
}
```

### Icon Mapping:
```typescript
function getEventIcon(eventType: string): string {
  switch (eventType) {
    case "created":            return "🚀";
    case "claimed":            return "💸";
    case "canceled":           return "❌";
    case "start_time_updated": return "🕐";
    case "paused":             return "⏸️";
    case "resumed":            return "▶️";
    case "completed":          return "✅";
    case "transferred":        return "🔄";
    case "clawback":           return "⚡";
    case "cliff_reached":      return "🧗";
    default:                   return "📋";
  }
}
```

### Description Generation:
```typescript
function getEventDescription(event: StreamEvent): string {
  const actor = event.actor 
    ? `${event.actor.slice(0, 6)}...${event.actor.slice(-4)}`
    : "Unknown";
  
  switch (event.eventType) {
    case "created":
      return `Initiated by ${actor} for ${event.amount ?? 0} tokens`;
    case "claimed":
      return `Claim of ${event.amount ?? 0} tokens processed by ${actor}`;
    case "transferred":
      const newRecipient = event.metadata?.new_recipient;
      return `Transferred from ${actor} to ${newRecipient}`;
    case "clawback":
      return `${event.amount} tokens clawed back by admin ${actor}`;
    // ... other event types
  }
}
```

## 🆕 How to Add a New Event Type

### Step 1: Backend Implementation

**1.1 Update Event Types (`eventHistory.ts`):**
```typescript
// Add to StreamEventType union
export type StreamEventType = 
  | "existing_types"
  | "new_event_type"; // ← Add here
```

**1.2 Update Indexer Processing (`indexer.ts`):**
```typescript
// Add new case in processContractEvent function
case "NewContractEvent":
  recordEventWithDb(
    db,
    value.stream_id.toString(),
    "new_event_type", // Must match StreamEventType
    timestamp,
    value.actor, // or appropriate field
    value.amount, // if applicable
    {
      // Any additional metadata
      custom_field: value.custom_field,
    },
    event.ledger,
  );
  break;
```

**1.3 Add Database Migration (if needed):**
```sql
-- If new metadata fields are required
ALTER TABLE stream_events ADD COLUMN new_field TEXT;
```

### Step 2: Frontend Implementation

**2.1 Update API Types (`api.ts`):**
```typescript
// Add to StreamEvent interface eventType union
eventType: "existing" | "new_event_type"; // ← Add here
```

**2.2 Update Timeline Component (`StreamTimeline.tsx`):**
```typescript
// Add to FILTER_BUTTONS array
{ type: "new_event_type", label: "New Event" },

// Add to getEventIcon function
case "new_event_type": return "🎯";

// Add to formatEventTitle function  
case "new_event_type": return "New Event Occurred";

// Add to getEventDescription function
case "new_event_type":
  return `New event triggered by ${actor}`;
```

**2.3 Update Tests:**
```typescript
// Add test cases for new event type
describe("new_event_type rendering", () => {
  it("should display correct icon", () => {
    const event = createEvent("new_event_type");
    expect(getEventIcon(event.eventType)).toBe("🎯");
  });
});
```

### Step 3: Testing the Implementation

**3.1 Unit Tests:**
```bash
cd backend && npm test -- eventHistory.test.ts
cd frontend && npm test -- StreamTimeline.test.tsx
```

**3.2 Integration Testing:**
```bash
# Start backend
npm run dev

# Create test event via API
curl -X POST http://localhost:3001/api/test/events/new-type

# Verify event appears in timeline
curl http://localhost:3001/api/streams/{streamId}/history
```

## 📈 Current vs Planned Implementation

### ✅ **Currently Implemented:**
- **Event Types:** created, claimed, canceled, start_time_updated, paused, resumed
- **Indexer:** Polling-based with circuit breaker and checkpointing
- **Frontend:** Interactive timeline with filtering
- **API:** REST endpoints for stream history and global events
- **Database:** SQLite with deduplication and indexing

### 🚧 **Planned Enhancements:**
1. **Real-time Updates:** WebSocket push notifications for new events
2. **Advanced Filtering:** Date ranges, amount thresholds, actor filters
3. **Event Analytics:** Dashboard with event frequency and trends
4. **Export Capability:** CSV/JSON export of event history
5. **Batch Processing:** Optimized indexer for high-volume streams
6. **Multi-chain Support:** Index events from multiple contract deployments

### 🔮 **Future Event Types:**
- `rate_changed`: Stream emission rate modification
- `metadata_updated`: Custom metadata updates
- `fee_paid`: Protocol fee payments
- `dispute_opened`: Stream dispute initiation
- `dispute_resolved`: Dispute resolution

## 🧪 Testing Strategy

### Backend Tests:
```typescript
// Event recording tests
describe("recordEvent", () => {
  it("should prevent duplicate ledger events", () => {
    recordEvent("1", "created", 1000, "alice", 100, undefined, 42);
    recordEvent("1", "created", 1000, "alice", 100, undefined, 42);
    expect(countStreamEvents("1")).toBe(1); // Second insert ignored
  });
});

// Indexer tests
describe("indexer circuit breaker", () => {
  it("should open after 5 consecutive failures", () => {
    for (let i = 0; i < 5; i++) circuitBreaker.onFailure();
    expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
  });
});
```

### Frontend Tests:
```typescript
// Timeline rendering tests
describe("StreamTimeline", () => {
  it("should filter events by type", () => {
    const events = [
      createEvent("created"),
      createEvent("claimed"),
      createEvent("created"),
    ];
    const filtered = computeFilteredEvents(events, new Set(["created"]));
    expect(filtered).toHaveLength(2);
    expect(filtered.every(e => e.eventType === "created")).toBe(true);
  });
});
```

## 📚 API Reference

### GET `/api/streams/:id/history`
**Returns:** Array of `StreamEvent` objects for specific stream
**Query Parameters:**
- `limit` (default: 20): Number of events to return
- `offset` (default: 0): Pagination offset
- `order` (default: "desc"): Sort order ("asc" or "desc")

### GET `/api/events`
**Returns:** Array of `StreamEvent` objects across all streams
**Query Parameters:**
- `limit` (default: 100): Number of events to return
- `cursor`: Pagination cursor (event ID)
- `eventType`: Filter by specific event type
- `since`: Unix timestamp filter

### GET `/api/events/summary/:streamId`
**Returns:** `StreamEventSummary` with counts and timestamps
```typescript
interface StreamEventSummary {
  totalEvents: number;
  byType: Partial<Record<StreamEventType, number>>;
  firstEventAt?: number;
  lastEventAt?: number;
}
```

## 🚀 Deployment Considerations

### Environment Variables:
```bash
# Required
CONTRACT_ID=CDCK...           # Soroban contract ID
RPC_URL=https://soroban-testnet.stellar.org:443
NETWORK_PASSPHRASE=Test SDF Network ; September 2015

# Optional
INDEXER_FALLBACK_POLLING_ENABLED=true
INDEXER_FALLBACK_POLL_INTERVAL_MS=10000
CIRCUIT_BREAKER_TIMEOUT_MS=60000
INDEXER_START_LEDGER=123456   # Start from specific ledger
```

### Database Migration:
```bash
# Run migrations on deploy
cd backend && npm run migrate
```

### Monitoring:
- **Metrics:** `events_indexed_total`, `ledgers_scanned_total`, `indexer_errors_total`
- **Logs:** Event processing errors, circuit breaker state changes
- **Health Checks:** `/api/health` includes indexer status

## ✅ Acceptance Criteria Verification

- [x] **All event types documented** - 10 event types with payloads documented
- [x] **How-to for new events clear** - Step-by-step guide provided
- [x] **Current vs planned clearly marked** - ✅/🚧/🔮 sections
- [x] **Indexer processing documented** - Circuit breaker, checkpointing, deduplication
- [x] **Frontend rendering documented** - Icons, descriptions, filtering
- [x] **API endpoints documented** - REST endpoints with parameters
- [x] **Testing strategy outlined** - Unit, integration, and end-to-end tests
- [x] **Deployment considerations** - Environment variables and monitoring

---

**Last Updated:** Current implementation as of code review  
**Next Review:** When adding new event types or major refactoring  
**Maintainer:** Backend & Frontend teams