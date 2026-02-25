# Stream Event History Implementation

## Overview
This implementation adds comprehensive event history tracking for stream lifecycle actions (create, claim, cancel, start time updates).

## Components

### 1. Database Schema (`backend/src/services/db.ts`)
Added `stream_events` table:
- `id`: Auto-incrementing primary key
- `stream_id`: Foreign key to streams table
- `event_type`: Type of event (created, claimed, canceled, start_time_updated)
- `timestamp`: Unix timestamp when event occurred
- `actor`: Address of the account that triggered the event
- `amount`: Amount involved (for created/claimed events)
- `metadata`: JSON metadata for additional context

Indexes on `stream_id` and `timestamp` for efficient queries.

### 2. Event History Service (`backend/src/services/eventHistory.ts`)
Core functions:
- `recordEvent()`: Store a new event in the database
- `getStreamHistory()`: Retrieve all events for a specific stream
- `getAllEvents()`: Retrieve recent events across all streams

### 3. Event Indexer (`backend/src/services/indexer.ts`)
Background worker that:
- Polls Soroban RPC for contract events every 10 seconds
- Processes StreamCreated, StreamClaimed, and StreamCanceled events
- Stores events in the database with proper timestamps and metadata
- Tracks last processed ledger to avoid duplicates
- Handles errors gracefully with logging

### 4. Stream Store Updates (`backend/src/services/streamStore.ts`)
Modified to record events when:
- Stream is created (with sender, amount, and metadata)
- Stream is canceled (with actor)
- Start time is updated (with old/new values in metadata)

### 5. API Endpoint (`backend/src/index.ts`)
New endpoint: `GET /api/streams/:id/history`
- Returns ordered list of lifecycle events for a stream
- Events sorted by timestamp ascending
- No authentication required (read-only)

Indexer initialization:
- Starts automatically on server startup if CONTRACT_ID is configured
- Polls every 10 seconds for new events
- Logs warnings if configuration is missing

### 6. Frontend API Service (`frontend/src/services/api.ts`)
Added:
- `StreamEvent` interface matching backend event structure
- `getStreamHistory()` function to fetch events for a stream

### 7. Timeline Component (`frontend/src/components/StreamTimeline.tsx`)
React component that:
- Displays stream events in chronological order
- Shows event icons (🎉 created, 💰 claimed, ❌ canceled, ⏰ updated)
- Formats timestamps in local time
- Handles loading and error states
- Auto-refreshes when stream ID changes

## Usage

### Backend
The indexer starts automatically when the server starts:
```typescript
await initSoroban();
await syncStreams();

// Initialize and start event indexer
const rpcUrl = process.env.RPC_URL || "https://soroban-testnet.stellar.org:443";
const contractId = process.env.CONTRACT_ID;
const networkPassphrase = process.env.NETWORK_PASSPHRASE;

if (contractId) {
  initIndexer(rpcUrl, contractId, networkPassphrase);
  startIndexer(10000); // Poll every 10 seconds
}
```

### Frontend
Use the StreamTimeline component:
```tsx
import { StreamTimeline } from "./components/StreamTimeline";

function StreamDetails({ streamId }: { streamId: string }) {
  return (
    <div>
      {/* Other stream details */}
      <StreamTimeline streamId={streamId} />
    </div>
  );
}
```

Or fetch events directly:
```typescript
import { getStreamHistory } from "./services/api";

const events = await getStreamHistory("123");
console.log(events);
```

## Event Types

### created
- Triggered when a new stream is created
- Includes: sender, total amount, recipient, asset code, duration

### claimed
- Triggered when tokens are claimed from a stream
- Includes: recipient, claimed amount

### canceled
- Triggered when a stream is canceled
- Includes: sender who canceled

### start_time_updated
- Triggered when start time is modified (scheduled streams only)
- Includes: sender, old and new start times in metadata

## Data Persistence
- Events are stored in SQLite database (`data/streams.db`)
- Database uses WAL mode for better concurrency
- Events persist across backend restarts
- Indexer resumes from last processed ledger

## Testing
To test the implementation:

1. Start the backend:
```bash
cd backend
npm install
npm run dev
```

2. Create a stream via API
3. Check the history endpoint:
```bash
curl http://localhost:3001/api/streams/1/history
```

4. Cancel or claim from the stream
5. Verify new events appear in the history

## Acceptance Criteria ✅
- ✅ History endpoint returns ordered lifecycle events
- ✅ Events persist across backend restarts (SQLite database)
- ✅ Frontend can display stream timeline data (StreamTimeline component)
- ✅ Events emitted for create/cancel/claim actions
- ✅ Indexer worker stores event history automatically
