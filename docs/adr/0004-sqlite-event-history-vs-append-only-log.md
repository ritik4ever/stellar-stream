# ADR 0004: Why SQLite Event History vs Append-Only Log

**Status:** Accepted  
**Date:** 2026-07-29  
**Deciders:** Stellar Stream Team

## Context

StellarStream needs a durable event history for stream lifecycle actions such as create, claim, cancel, and edits. We need a storage approach that supports auditability and fast lookup from the UI.

## Problem

We need event history storage that:

- Preserves an ordered audit trail
- Supports filtering by stream ID and event type
- Can be queried efficiently by the API
- Fits the current SQLite-backed backend
- Is easy to maintain and migrate later

## Options Considered

### Option 1: Structured SQLite Event Table (Chosen)

**Pros:**

- Queryable with SQL indexes
- Fits the current backend storage model
- Easy to join with stream records
- Supports UI timelines and admin inspection
- Keeps history and state in one durable datastore

**Cons:**

- Requires schema design and migrations
- Not as simple as dumping raw text lines

### Option 2: Append-Only Log File

**Pros:**

- Simple conceptual model
- Easy to append new records

**Cons:**

- Poor queryability
- Harder to filter by stream or event type
- More work to reconstruct state from history
- Harder to keep consistent with the main database

### Option 3: External Event Store

**Pros:**

- Strong event-sourcing semantics
- Useful at very large scale

**Cons:**

- More infrastructure than the MVP needs
- Adds operational burden and integration complexity
- Overkill for the current event volume

## Decision

**We store event history in SQLite tables rather than a standalone append-only log.**

### Rationale

1. **Queryable Audit Trail:** The UI and API can fetch event timelines directly with SQL.
2. **Consistency:** History stays in the same transactional database as the stream state.
3. **Maintainability:** The schema remains understandable to future contributors.
4. **MVP Fit:** The current scale does not justify a separate event-store stack.

## Consequences

### Positive

- Fast event lookup for stream detail pages
- Simpler backup and restore
- Easier cross-checks between state and history
- Good fit for SQLite-backed deployments

### Negative

- History is tied to the SQLite schema
- Replaying events as a pure append-only stream is less direct
- Future scale-out may require a specialized event pipeline

## Alternatives Considered

### Alternative 1: File-Based Append Log

Rejected because querying and maintaining consistency would be harder than the current SQL model.

### Alternative 2: Dedicated Event Store

Rejected because it exceeds the operational needs of the MVP.

## References

- Stream persistence: `backend/src/services/streamStore.ts`
- Database schema: `backend/src/services/db.ts`
- Event history endpoints: `README.md`
