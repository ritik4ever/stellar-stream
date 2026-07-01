# StellarStream

StellarStream is a basic payment-streaming MVP for the Stellar ecosystem.
It includes:
* A React dashboard to create and monitor streams
* A Node.js/Express API for stream lifecycle operations
* A Soroban smart contract scaffold for on-chain stream logic
* A backlog folder with implementation task drafts

This repository is intentionally lightweight and easy to extend.
For common questions and troubleshooting, see our `FAQ.md`.
For production setup and operations, see `DEPLOYMENT.md` and `RUNBOOK.md`.
For security policy and reporting vulnerabilities, see `SECURITY.md`.
We are committed to a welcoming environment; see our `CODE_OF_CONDUCT.md`.

1) What The Project Does

StellarStream models a payment stream where a sender allocates a total amount over a fixed duration.
As time passes, the recipient "vests" value continuously.

**Current MVP behavior:**
* Create stream
* List streams with live progress
* Cancel stream
* Show computed metrics (active/completed/vested)
* Track and display event history for stream lifecycle actions

2) Current Architecture

### Frontend (`frontend`, port 3000)
* React + Vite app
* Uses `/api` proxy to call backend
* Polls stream list every 5 seconds

### Backend (`backend`, port 3001)
* Express REST API
* SQLite database for persistent storage
* Event indexer worker for tracking stream lifecycle
* Computes progress in real time from timestamps
* Cryptographically signs outbound webhooks using HMAC-SHA256 for secure lifecycle notifications

### Contract (`contracts`)
* Soroban contract scaffold in Rust
* Supports `create_stream`, `claimable`, `claim`, and `cancel`
* Not yet integrated with backend runtime in this MVP

> **See also:** Event Flow for detailed sequence diagrams of the contract-to-frontend pipeline and webhook delivery system.

---

### Event Flow

#### On-Chain Event Pipeline
The following sequence diagram shows how events flow from the Soroban contract through the indexing pipeline to the frontend:

```mermaid
sequenceDiagram
    participant User
    participant Contract as Soroban Contract
    participant Indexer as Indexer Worker
    participant SQLite as SQLite Database
    participant API as Backend API
    participant Frontend as React Frontend

    User->>Contract: create_stream()
    Contract->>Contract: Transfer tokens (escrow)
    Contract->>Contract: Store stream state
    Contract-->>Stellar: Publish StreamCreated/Claimed/Canceled events
    loop Poll every 10s
        Indexer->>Stellar RPC: Fetch new events
        Stellar RPC-->>Indexer: Stream events (Created, Claimed, Canceled)
        Indexer->>SQLite: Write stream + event(s)
    end
    Frontend->>API: GET /api/streams
    API->>SQLite: Query streams
    SQLite-->>API: Return stream data
    API-->>Frontend: JSON response
    Frontend->>Frontend: Render timeline
    Frontend->>API: GET /api/streams/:id/history
    API->>SQLite: Query stream_events
    SQLite-->>API: Event history
    API-->>Frontend: Event timeline JSON

Webhook Delivery Pipeline
Events from the stream lifecycle are also delivered via HTTP webhooks with retry and dead-letter handling:

sequenceDiagram
    participant Stream as Stream Event
    participant Worker as Webhook Worker
    participant HTTP as HTTP Delivery
    participant Target as Webhook Target
    participant DLQ as Dead Letter Queue (webhook_dead_letters)

    Stream->>Worker: Event detected (created/claimed/canceled)
    Worker->>SQLite: Queue webhook delivery (status='pending')
    loop Retry with fixed delays [5s, 15s, 60s, 300s, 900s]
        Worker->>HTTP: POST payload (application/json)
        HTTP->>Target: Deliver webhook
        Note right of HTTP: Header: X-Webhook-Signature: sha256=<hmac>
        Target-->>HTTP: 200 OK (success)
        HTTP-->>Worker: Success
        Worker->>SQLite: Update status='success'
        alt Failure (timeout/error/5xx)
            Target-->>HTTP: Error
            HTTP-->>Worker: Failure
            Worker->>SQLite: Schedule retry (next_retry_at)
        end
        SQLite->>Worker: next_retry_at
    end
    alt Max retries exceeded
        Worker->>DLQ: INSERT into webhook_dead_letters
        Worker->>SQLite: DELETE from webhook_deliveries
        Worker->>Logs: Error logged
    end

Claim Flow Pipeline
The following diagram details the full claim lifecycle, from UI interaction to on-chain execution and backend reconciliation:

sequenceDiagram
    participant Recipient as Recipient (User)
    participant Frontend as React Frontend
    participant Freighter as Freighter Wallet
    participant Contract as Soroban Contract
    participant Indexer as Indexer Worker
    participant SQLite as SQLite Database
    participant API as Backend API

    Recipient->>Frontend: Click "Claim"
    Frontend->>API: GET /api/streams/:id (query claimable)
    API-->>Frontend: Return claimable amount
    Frontend->>Freighter: Request signature for claim(streamId, amount)
    Freighter->>Recipient: Prompt for approval
    Recipient-->>Freighter: Approve transaction
    Freighter-->>Frontend: Signed Transaction
    Frontend->>Contract: Submit claim() transaction
    Contract->>Contract: Verify recipient & amount
    Contract->>Contract: Transfer tokens from escrow
    Contract-->>Stellar: Publish Claimed event
    loop Poll every 10s
        Indexer->>Stellar RPC: Fetch new events
        Stellar RPC-->>Indexer: Claimed event
        Indexer->>SQLite: Update stream (amount claimed)
        Indexer->>SQLite: Record claim event
    end
    Frontend->>API: GET /api/streams/:id/history (poll)
    API->>SQLite: Query stream_events
    SQLite-->>API: Return updated history
    API-->>Frontend: Return updated history
    Frontend->>Recipient: Show "Claimed ✓"

3) Stream Math Model

For each stream defined by a total amount ($A_{total}$), a start timestamp ($t_{start}$), and a duration in seconds ($d$), the completion timestamp ($t_{end}$) is calculated as:

$$t_{end} = t_{start} + d$$

At any given current time $t$, the elapsed time ($\Delta t$), vesting ratio ($R$), vested amount ($A_{vested}$), and remaining amount ($A_{remaining}$) are calculated using a clamp function to restrict values to the valid stream window:

$$\Delta t = \max(0, \min(t - t_{start}, d))$$

$$R = \frac{\Delta t}{d}$$

$$A_{vested} = A_{total} \times R$$

$$A_{remaining} = A_{total} - A_{vested}$$

Status Rules

scheduled: when $t < t_{start}$

active: when $t_{start} \le t < t_{end}$

completed: when $t \ge t_{end}$

canceled: when the stream was explicitly terminated early

4) API Reference
Interactive API documentation is available via Swagger UI at:

Swagger UI: /api/docs

Raw OpenAPI spec: /api/docs/openapi.json

Base URL:

Local: http://localhost:3001

Frontend proxy: /api

GET /api/health
Purpose: Service health check

Response: service, status, timestamp

Docker Compose Health Check Configuration:

Interval: 30s

Timeout: 10s

Retries: 3

Start Period: 10s

GET /api/streams
Purpose: List streams sorted by newest first, with optional filtering and pagination

Query params (optional):

status: scheduled | active | completed | canceled

sender: string (exact sender match)

recipient: string (exact recipient match)

asset: string (exact asset code match)

q: string (general search term - searches stream ID, sender, recipient, and asset code, case-insensitive)

page: number (integer >= 1)

limit: number (integer 1..100)

Search behavior: The q parameter performs case-insensitive partial matching across stream ID, sender, recipient, and asset code. Search combines with other filters (all filters are applied together). Empty or whitespace-only search terms are ignored.

Pagination behavior: If both page and limit are omitted, legacy mode applies and all matching rows are returned. If either page or limit is provided, pagination mode applies with defaults page=1 and limit=20.

Validation: Invalid status, page, or limit returns 400.

Response:

{
  "data": "Stream[]",
  "total": "number",
  "page": "number",
  "limit": "number"
}

GET /api/streams/:id
Purpose: Fetch single stream by ID

Response: { "data": Stream }

Error: 404 if stream does not exist

GET /api/recipients/:accountId/streams
Purpose: Fetch all streams for a specific recipient account

Path parameters:

accountId: string (Stellar account ID starting with G, exactly 56 characters)

Validation: Account ID must be a valid Stellar account ID format

Response: { "data": Stream[] } (includes computed progress for each stream)

Error: 400 if account ID is invalid

GET /api/assets
Purpose: Fetch the current allowed asset allowlist

Response: { "data": string[] } (normalized asset codes)

POST /api/streams
Purpose: Create a new stream

Request JSON:

{
  "sender": "string",
  "recipient": "string",
  "assetCode": "string",
  "totalAmount": "number",
  "durationSeconds": "number",
  "startAt": "number (optional unix seconds)"
}

Validation: Sender/recipient must be non-trivial strings. Asset length must be 2..12. Amount must be positive. Duration must be at least 60 seconds.

Response: 201 Created with { "data": Stream }

POST /api/streams/:id/cancel
Purpose: Cancel an existing stream

Response: { "data": Stream } with canceled state

Error: 404 if stream does not exist

GET /api/open-issues
Purpose: Returns implementation backlog items shown in UI

Response: { "data": OpenIssue[] }

GET /api/streams/:id/history
Purpose: Fetch event history timeline for a specific stream

Response: { "data": StreamEvent[] } (ordered by timestamp ascending)

Event types: created, claimed, canceled, start_time_updated

Each event includes: id, streamId, eventType, timestamp, actor (optional), amount (optional), metadata (optional)

5) Smart Contract (Soroban) Behavior
Contract file: contracts/src/lib.rs

Data Key Patterns:

NextStreamId

Stream(stream_id) -> Stream

Implemented methods:

create_stream(...) -> u64

get_stream(stream_id) -> Stream

claimable(stream_id, at_time) -> i128

claim(stream_id, recipient, amount) -> i128

cancel(stream_id, sender)

⚠️ Important note: claim currently updates accounting only. Token transfer wiring is planned as the next implementation step.

6) Run Locally
Prerequisites
Node.js 18+

npm 9+

Optional for contract work: Rust + Soroban toolchain

Option A: Direct npm (Recommended for Development)
From repo root:

npm run install:all
npm run dev:backend
npm run dev:frontend

Manual alternative:

cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev

Frontend: http://localhost:3000

Backend: http://localhost:3001

Option B: Docker Compose with Hot-Reload
For local development with Docker, use the docker-compose.override.yml file which automatically mounts source directories and enables hot-reload:

docker-compose up

Backend hot-reload: Changes to backend/src/ trigger automatic restart via ts-node-dev.

Frontend hot-reload: Changes to frontend/src/ trigger Vite HMR.

Database Volume: Persists across restarts.

Build

npm run build

7) Deploy Contract
Deploy the Soroban contract to Stellar testnet.

Prerequisites
soroban-cli installed

Rust toolchain with wasm32-unknown-unknown target

Stellar testnet account with secret key

Deployment
Set the SECRET_KEY environment variable and run:

SECRET_KEY="S..." npm run deploy:contract

The script will build the contract, deploy to Stellar testnet, output the contract ID, and save it to contracts/contract_id.txt.

After Deployment
Copy the contract ID from contracts/contract_id.txt.

Set CONTRACT_ID in your backend .env file.

Set VITE_CONTRACT_ID in your frontend .env file.

Ensure SERVER_PRIVATE_KEY is set in your backend .env file.

Regenerate contract bindings: CONTRACT_ID=$(cat contracts/contract_id.txt) npm run gen:bindings

Commit the updated bindings to the repository and restart your backend service.

8) Environment And Config
Copy backend/.env.example to backend/.env and fill in the values before starting the server. The backend validates all environment variables at startup. If a required variable is missing or malformed, the process exits immediately with an error.

Database
StellarStream uses SQLite for persistent storage. See ADR 0001: SQLite vs PostgreSQL for design rationale and migration paths.

Soroban / On-chain mode vs. local-only mode

ModeWhen to useHow to enableSoroban enabled (default)Full on-chain integration — contract deployed, indexer runningSet CONTRACT_ID and SERVER_PRIVATE_KEYSoroban disabledLocal UI/API development without a deployed contractSet SOROBAN_DISABLED=true

⚠️ SOROBAN_DISABLED=true is for local development only. Never set it in production or staging.

Webhook Signing & Verification
Header: X-StellarStream-Signature

Format: sha256=<hex-digest>

Digest input: Raw JSON request body string

Algorithm: HMAC-SHA256 using WEBHOOK_SIGNING_SECRET

To verify a payload delivery, compute sha256= + the HMAC-SHA256 hash of the raw request body string using your configured WEBHOOK_SIGNING_SECRET. Perform a constant-time comparison against the value provided in the X-StellarStream-Signature header to protect against timing attacks.

Node.js Verification Example

const crypto = require("crypto");

function verifyWebhook(secret, rawBody, signatureHeader) {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return false;
  }
  
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
    
  const expectedBuffer = Buffer.from("sha256=" + expectedSignature);
  const receivedBuffer = Buffer.from(signatureHeader);
  
  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }
  
  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

Python Verification Example

import hmac
import hashlib

def verify_webhook(secret: str, raw_body: bytes, signature_header: str) -> bool:
    if not signature_header or not signature_header.startswith("sha256="):
        return False
        
    received_digest = signature_header.split("sha256=")[1]
    
    expected_hmac = hmac.new(
        secret.encode("utf-8"),
        raw_body,
        hashlib.sha256
    )
    expected_digest = expected_hmac.hexdigest()
    
    return hmac.compare_digest(expected_digest, received_digest)

⚠️ If WEBHOOK_DESTINATION_URL is set without a WEBHOOK_SIGNING_SECRET, webhooks will be delivered unsigned and a security warning will be logged at server initialization.

9) Project File Map

├── .github/                      # GitHub templates & configurations
├── backend/
│   ├── src/
│   │   ├── config/validateEnv.ts # App bootstrap & environment schema check
│   │   ├── services/streamStore.ts  # Stream business math & storage lifecycle
│   │   ├── services/indexer.ts   # Soroban contract event polling indexer
│   │   └── index.ts              # API entry point & Express routing
│   └── tsconfig.json
├── contracts/
│   ├── src/lib.rs                # Soroban contract implementation
│   └── Cargo.toml
├── docs/                         # Extended project architectural documentation
├── frontend/
│   ├── src/
│   │   ├── components/           # UI Elements (Tables, Forms, Timelines)
│   │   ├── contracts/generated/  # Auto-generated TS bindings for the contract
│   │   ├── App.tsx               # Primary dashboard interface layout
│   │   └── main.tsx
│   └── vite.config.ts
└── scripts/                      # Deployment and binding generation tools

10) Known Limitations
Contract is not fully connected to backend execution path yet.

Wallet sign/transaction flow is not active yet in UI.

No authentication layer on write endpoints.

Event indexer polls every 10 seconds (configurable).

Contract bindings must be regenerated locally after each deployment.

11) Suggested Next Steps
Move stream source of truth from memory to Soroban state.

Add wallet-authenticated transaction signing flow.

Wire frontend application to call the contract client directly.

Add automated contract integration pipelines.

Add real-time event notifications via WebSockets.