# ADR 0003: Why Polling Over WebSocket for MVP

**Status:** Accepted  
**Date:** 2026-07-29  
**Deciders:** Stellar Stream Team

## Context

StellarStream needs to keep the UI fresh as streams change, claims arrive, and history updates are indexed. The main choices are polling, WebSockets, or a hybrid push model.

## Problem

We need an update strategy that:

- Keeps the MVP simple and reliable
- Is easy to reason about in local development
- Handles intermittent network failures gracefully
- Works even when real-time transport is unavailable
- Does not add unnecessary infrastructure for the first release

## Options Considered

### Option 1: Polling (Chosen)

**Pros:**

- Easy to implement and debug
- Predictable failure mode: the next request retries naturally
- Works well with existing REST endpoints
- No long-lived connection management required
- Simple to test in CI and locally

**Cons:**

- Uses more requests than push-based transport
- Can introduce small update delays between polls

### Option 2: WebSocket-Only Push

**Pros:**

- Near real-time updates
- Fewer repeated requests when the app is idle

**Cons:**

- More operational complexity
- Requires connection lifecycle handling and reconnection logic
- Harder to debug network and proxy issues
- Not necessary for the MVP's update cadence

### Option 3: Server-Sent Events

**Pros:**

- Simpler than WebSockets for one-way updates
- Good browser support

**Cons:**

- Still adds connection management complexity
- Less aligned with the current REST-first API shape
- Not clearly better than polling for the current scope

## Decision

**We choose polling as the MVP's primary freshness mechanism.**

### Rationale

1. **Operational Simplicity:** Polling keeps the app architecture straightforward.
2. **Reliable by Default:** If a request fails, the next interval recovers without needing transport recovery logic.
3. **Matches the Current Product Needs:** The UI only needs periodic freshness for stream lists and history, not hard real-time guarantees.
4. **Lower Integration Cost:** The backend already exposes REST endpoints that fit polling naturally.

## Consequences

### Positive

- Easier to ship and maintain
- Easier local debugging
- Fewer moving parts in CI and staging
- Less risk from websocket proxy or reconnect bugs

### Negative

- Updates are not instantaneous
- Slightly higher request volume
- Real-time feel is limited compared with push transport

## Alternatives Considered

### Alternative 1: WebSocket as the Primary Transport

Rejected because the extra complexity is not justified for the MVP.

### Alternative 2: Hybrid Polling + Push

Rejected for the first release because it adds complexity without a clear product necessity.

## References

- Stream polling in the frontend: `frontend/src/components/StreamsTable.tsx`
- Dashboard refresh behavior: `frontend/src/pages/DashboardPage.tsx`
- WebSocket server support: `backend/src/services/websocket.ts`
