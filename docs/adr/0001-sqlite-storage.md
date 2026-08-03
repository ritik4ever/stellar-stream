# ADR 0001: SQLite vs PostgreSQL for Stream Storage

**Status:** Accepted (Extended with PostgreSQL Support)  
**Date:** 2026-05-27 (Updated 2026-06-30)  
**Deciders:** Stellar Stream Team

## Context

The Stellar Stream backend needs a persistent data store for stream records, events, and metadata. The choice of database technology affects scalability, deployment complexity, operational overhead, and development velocity.

## Problem

We need to select a database that:

- Persists stream state reliably across restarts
- Supports concurrent reads and writes
- Enables efficient querying of streams by sender, recipient, and status
- Minimizes operational complexity for self-hosted deployments
- Supports event sourcing patterns for audit trails
- Can scale from single-instance to multi-instance deployments

## Options Considered

### Option 1: SQLite (Chosen)

**Pros:**

- Zero operational overhead: single file, no separate server process
- Excellent for single-instance deployments and development
- ACID transactions with WAL (Write-Ahead Logging) mode for concurrent access
- Sufficient performance for typical stream volumes (thousands of streams)
- Easy backups: copy the database file
- No authentication/networking complexity
- Excellent TypeScript support via better-sqlite3
- Minimal dependencies

**Cons:**

- Limited concurrent write capacity (one writer at a time)
- Not ideal for high-throughput multi-instance deployments
- Requires shared storage in multi-instance setups (NFS, S3, etc.)
- No built-in replication or failover

### Option 2: PostgreSQL

**Pros:**

- Excellent multi-instance support with native replication
- High concurrent write throughput
- Advanced features (JSONB, full-text search, etc.)
- Mature ecosystem and tooling
- Scales to very large datasets

**Cons:**

- Requires separate server process and operational management
- More complex deployment (Docker, managed services, etc.)
- Additional authentication and networking configuration
- Higher resource overhead
- Overkill for typical stream volumes
- Adds operational burden for self-hosted deployments

### Option 3: JSON File Storage

**Pros:**

- Simplest possible implementation
- No external dependencies

**Cons:**

- No ACID guarantees
- Poor concurrent access patterns
- Inefficient querying
- Not suitable for production use

## Decision

**We choose SQLite with WAL mode for the initial implementation.**

### Rationale

1. **Deployment Simplicity:** SQLite requires zero operational overhead, making it ideal for self-hosted deployments and development environments.

2. **Sufficient for Current Scale:** Stream volumes are expected to be in the thousands, well within SQLite's capabilities.

3. **Development Velocity:** SQLite enables rapid iteration without database setup complexity.

4. **Multi-Instance Path:** While SQLite has write limitations, we can:
   - Use Redis for caching to reduce database load
   - Implement read replicas with eventual consistency
   - Migrate to PostgreSQL when needed (schema is database-agnostic)

5. **Operational Simplicity:** Single file backup, no authentication, no networking issues.

## Consequences

### Positive

- Faster time to market with minimal operational complexity
- Excellent developer experience (no database setup required)
- Easy local development and testing
- Simple backup and restore procedures
- Lower resource requirements

### Negative

- Limited to one concurrent writer (mitigated by Redis caching)
- Multi-instance deployments require shared storage or eventual consistency
- May need migration to PostgreSQL for very high-throughput scenarios

## Migration Path to PostgreSQL

When the application outgrows SQLite:

1. **Schema Compatibility:** The current schema uses standard SQL compatible with both SQLite and PostgreSQL.

2. **Migration Steps:**
   - Create PostgreSQL database with identical schema
   - Implement dual-write pattern (write to both SQLite and PostgreSQL)
   - Migrate historical data
   - Switch reads to PostgreSQL
   - Decommission SQLite

3. **Timeline:** Expected when stream volume exceeds 100k+ concurrent streams or write throughput exceeds SQLite's capacity.

## Implementation Details

### Current Setup

- **Database:** SQLite with WAL mode enabled
- **Location:** `backend/data/streams.db`
- **Schema:** Defined in `backend/src/services/db.ts`
- **Migrations:** Inline schema creation on startup

### Tables

- `streams`: Main stream records with status tracking
- `stream_events`: Event history (created, claimed, canceled, start_time_updated)
- `stream_archive`: Completed streams > 30 days old
- `webhook_deliveries`: Pending webhook deliveries with retry tracking
- `webhook_dead_letters`: Failed webhooks after max retries
- `indexer_cursor`: Last processed ledger sequence

### Performance Optimizations

- WAL mode for concurrent reads during writes
- Indexes on frequently queried columns (sender, recipient, status)
- Connection pooling via better-sqlite3
- Redis caching layer for hot data (stream lists, stats)

## PostgreSQL Support Implementation (June 2026)

To scale the application for multi-instance deployments, optional support for PostgreSQL has been implemented:

1. **Activation:** PostgreSQL is automatically activated when the `DATABASE_URL` environment variable is set. If not set, the application defaults to SQLite.
2. **Synchronous Repository Adapter:** To avoid altering the existing synchronous database access pattern in the backend services, a synchronous `PostgresDatabase` wrapper class was created. It uses a background `Worker` thread to connect to PostgreSQL asynchronously via the `pg` driver, communicating query requests and results back to the main thread synchronously using a `SharedArrayBuffer` and `Atomics.wait`/`Atomics.notify`.
3. **Dialect Compatibility Translation:**
   - **Types:** `INTEGER` maps to `BIGINT` and `REAL` maps to `DOUBLE PRECISION` on the fly.
   - **Primary Keys:** `INTEGER PRIMARY KEY AUTOINCREMENT` is rewritten to `SERIAL PRIMARY KEY`.
   - **Conflict Resolution:** `INSERT OR IGNORE` clauses are translated to standard PostgreSQL `ON CONFLICT (...) DO NOTHING` clauses.
   - **Full-Text Search:** The SQLite `fts5` virtual table indexing is bypassed on PostgreSQL, and query matches are executed using native, case-insensitive `ILIKE` clauses on the main table.

## Related Decisions

- **ADR 0002:** Freighter wallet integration for recipient signing
- **ADR 0003:** Polling as the MVP refresh strategy
- **ADR 0004:** SQLite event history over an append-only log
- **ADR 0005:** Multi-asset support as a first-class stream property

## References

- [SQLite WAL Mode](https://www.sqlite.org/wal.html)
- [better-sqlite3 Documentation](https://github.com/WiseLibs/better-sqlite3)
- [PostgreSQL vs SQLite Comparison](https://www.sqlite.org/whentouse.html)
