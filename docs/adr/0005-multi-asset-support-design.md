# ADR 0005: Multi-Asset Support Design Decision

**Status:** Accepted  
**Date:** 2026-07-29  
**Deciders:** Stellar Stream Team

## Context

StellarStream supports streams that can be denominated in more than one asset code. The product needs a design that lets the app grow beyond a single token without fragmenting the data model.

## Problem

We need multi-asset support that:

- Keeps the core stream model simple
- Works with per-stream asset selection
- Supports asset filtering in the UI
- Avoids hard-coding a single token into the database schema
- Leaves room for future contract and backend expansion

## Options Considered

### Option 1: Asset-Agnostic Stream Records With Per-Stream Asset Codes (Chosen)

**Pros:**

- Simple record model
- Each stream remains one asset denomination
- Easy to filter and display in the UI
- Works with allowlists and validation
- Leaves room to add more assets without schema churn

**Cons:**

- Still requires asset validation and normalization
- Cross-asset reporting must group by asset code

### Option 2: Single-Asset Product Model

**Pros:**

- Very simple initially
- Minimal validation logic

**Cons:**

- Blocks expansion to other assets
- Forces a future migration when the product widens

### Option 3: Fully General Multi-Asset Ledger Abstraction

**Pros:**

- Powerful and flexible
- Could support complex asset behaviors

**Cons:**

- Over-engineered for the MVP
- Harder to understand and test
- Adds unnecessary schema and contract complexity

## Decision

**We model each stream with a normalized `assetCode` and keep the rest of the stream logic asset-agnostic.**

### Rationale

1. **Practical Flexibility:** We can support multiple assets without changing the core stream lifecycle model.
2. **Minimal Schema Impact:** The existing records already carry asset information cleanly.
3. **Validation Friendly:** Allowed assets can be checked at the boundary and normalized before storage.
4. **Future Ready:** The design can expand toward richer asset metadata later if needed.

## Consequences

### Positive

- Users can create streams in supported assets
- Reporting and filtering stay straightforward
- Future asset expansion is easier
- The system avoids a premature architecture jump

### Negative

- Asset-specific behavior must be handled carefully at validation and claim time
- Additional supported assets increase test coverage needs

## Alternatives Considered

### Alternative 1: Hard-Code One Asset Only

Rejected because it would limit the product and force a later migration.

### Alternative 2: Build a Generalized Asset Engine Up Front

Rejected because the complexity is not justified for the current MVP scope.

## References

- Asset allowlist endpoint: `README.md`
- Asset validation: `frontend/src/validation/schemas.ts`
- Stream storage model: `backend/src/services/streamStore.ts`
