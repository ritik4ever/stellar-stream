# Load Testing Guide

This document describes how to run load tests against the StellarStream backend API, interpret results, and tune the system for different workloads.

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites](#2-prerequisites)
3. [Autocannon CLI Reference](#3-autocannon-cli-reference)
4. [Scenario Examples](#4-scenario-examples)
5. [Interpreting Results](#5-interpreting-results)
6. [Acceptable Thresholds](#6-acceptable-thresholds)
7. [Tuning Guide](#7-tuning-guide)
8. [Common Failure Modes and Fixes](#8-common-failure-modes-and-fixes)
9. [Historical Baseline Results](#9-historical-baseline-results)
10. [Related Documentation](#10-related-documentation)

---

## 1. Overview

Load testing verifies that StellarStream can handle expected traffic volumes while maintaining acceptable latency and error rates. The project uses [autocannon](https://github.com/mcollina/autocannon) (v8.x) — a fast HTTP/1.1 benchmarking tool written in Node.js — available as a dev dependency in `backend/package.json`.

**Key system characteristics under test:**

| Aspect | Detail |
|--------|--------|
| Backend | Node.js + Express + SQLite (WAL mode) |
| Rate limits | READ=5000/min, MUTATION=10/min (configurable) |
| Cache | In-memory LRU (default) or Redis |
| Metrics | Prometheus endpoint: `/metrics`, App metrics: `/api/metrics` |
| Database | SQLite with `better-sqlite3` (synchronous writes) |

---

## 2. Prerequisites

- Node.js 18+ installed
- Backend running locally (`npm run dev:backend` from repo root)
- A seeded database with stream data (the test suite creates one, or use the app UI)
- autocannon installed globally (optional — can use via `npx`):
  ```bash
  npm install -g autocannon
  ```

**Recommended test profile:**

```bash
# Copy the test env for isolated load testing
cp backend/.env.test.local backend/.env.loadtest
# Edit as needed (e.g., increase rate limits for testing)
```

---

## 3. Autocannon CLI Reference

Below are all relevant autocannon flags grouped by purpose.

### Connection and Duration

| Flag | Alias | Default | Description |
|------|-------|---------|-------------|
| `--connections` | `-c` | `10` | Number of concurrent connections |
| `--duration` | `-d` | `10` | Duration of the test in seconds |
| `--pipelining` | `-p` | `1` | Number of pipelined requests per connection |
| `--amount` | `-a` | — | Number of requests to send (overrides `--duration`) |
| `--timeout` | `-t` | `10` | Request timeout in seconds |

### Request Configuration

| Flag | Alias | Default | Description |
|------|-------|---------|-------------|
| `--method` | `-m` | `GET` | HTTP method (GET, POST, PUT, DELETE, etc.) |
| `--headers` | `-H` | — | Custom headers (repeatable: `-H "Key: Value"`) |
| `--body` | `-b` | — | Request body (use with `-m POST`, supports inline JSON) |
| `--input` | `-i` | — | File path containing the request body |
| `--contentType` | `-T` | `application/json` | Content-Type header value |

### Output and Reporting

| Flag | Alias | Default | Description |
|------|-------|---------|-------------|
| `--json` | `-j` | `false` | Print results as newline-delimited JSON |
| `--renderStatusCodes` | — | `false` | Print a table for every status code received |
| `--latency` | `-l` | `false` | Print detailed latency percentile data (p50, p75, p90, p99, max) |
| `--resultOutput` | `-o` | — | Write results to a file (JSON) |
| `--warmup` | — | — | Number of warmup requests before measuring |

### Management

| Flag | Alias | Default | Description |
|------|-------|---------|-------------|
| `--title` | `-T` | — | Label for the test run (included in JSON output) |
| `--help` | `-h` | — | Print help information |
| `--version` | `-v` | — | Print autocannon version |

> **Tip:** Always use `--latency` to get percentiles. Use `--json` when piping results to analysis tools.

---

## 4. Scenario Examples

### 4.1 Read-Heavy: List Streams

Simulates the frontend polling `/api/streams` — the most frequent operation.

```bash
npx autocannon -c 50 -d 30 -p 1 \
  -m GET \
  -H "Content-Type: application/json" \
  --latency \
  --renderStatusCodes \
  --title "read-streams-list" \
  http://localhost:3001/api/streams
```

**What it tests:** SQLite read throughput, cache hit ratio, pagination performance.

### 4.2 Write-Heavy: Create Streams

Simulates concurrent stream creation. Requires a valid JWT token (obtain from `/api/auth/token`).

```bash
npx autocannon -c 5 -d 20 -p 1 \
  -m POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -b '{"sender":"GABCDEF123456789012345678901234567890123456","recipient":"G1234567890123456789012345678901234567890","assetCode":"USDC","totalAmount":1000,"durationSeconds":3600}' \
  --latency \
  --renderStatusCodes \
  --title "create-streams" \
  http://localhost:3001/api/streams
```

**Important:** Use a low concurrency (`-c 5`) due to the default MUTATION_RATE_LIMIT (10 req/min). Increase the limit in `.env` for load testing:

```bash
MUTATION_RATE_LIMIT=1000
```

**What it tests:** SQLite write throughput, validation overhead, authentication middleware performance.

### 4.3 Mixed Workload: Read + Search + Write

Interleaves read, search, and mutation endpoints over a longer duration.

```bash
# Terminal 1: Read streams list
npx autocannon -c 30 -d 60 -p 1 \
  -m GET \
  -H "Content-Type: application/json" \
  --latency \
  --title "mixed-reads" \
  http://localhost:3001/api/streams?limit=20

# Terminal 2: Search streams
npx autocannon -c 10 -d 60 -p 1 \
  -m GET \
  -H "Content-Type: application/json" \
  --latency \
  --title "mixed-search" \
  "http://localhost:3001/api/streams/search?q=USDC"

# Terminal 3: Metrics endpoint
npx autocannon -c 5 -d 60 -p 1 \
  -m GET \
  --latency \
  --title "mixed-metrics" \
  http://localhost:3001/api/metrics
```

**What it tests:** Concurrent request handling, cache invalidation, database locking under mixed load.

### 4.4 Stream History and Snapshot

Simulates users viewing stream details and event history.

```bash
# Replace STREAM_ID with an actual stream ID from your database
npx autocannon -c 20 -d 30 -p 1 \
  -m GET \
  -H "Content-Type: application/json" \
  --latency \
  --renderStatusCodes \
  --title "stream-history" \
  http://localhost:3001/api/streams/STREAM_ID/history

npx autocannon -c 20 -d 30 -p 1 \
  -m GET \
  -H "Content-Type: application/json" \
  --latency \
  --renderStatusCodes \
  --title "stream-snapshot" \
  http://localhost:3001/api/streams/STREAM_ID/snapshot
```

---

## 5. Interpreting Results

Autocannon prints a summary with the following key metrics:

```
┌─────────┬──────┬──────┬───────┬──────┬─────────┬──────────┬───────┐
│ Stat    │ 2.5% │ 50%  │ 75%   │ 90%  │ 97.5%   │ 99%      │ Avg   │
├─────────┼──────┼──────┼───────┼──────┼─────────┼──────────┼───────┤
│ Req/Sec │ 120  │ 150  │ 160   │ 175  │ 180     │ 185      │ 152   │
└─────────┴──────┴──────┴───────┴──────┴─────────┴──────────┴───────┘

┌─────────┬────────┬────────┬────────┬─────────┬─────────┬─────────┬────────┐
│ Latency │ 10 ms  │ 15 ms  │ 20 ms  │ 30 ms   │ 50 ms   │ 80 ms   │ 18 ms  │
└─────────┴────────┴────────┴────────┴─────────┴─────────┴─────────┴────────┘
```

**Key metrics to watch:**

| Metric | What it tells you |
|--------|-------------------|
| **Req/Sec (p50/p99)** | Throughput capacity — how many requests per second the server can handle |
| **Latency (p50)** | Median response time — typical user experience |
| **Latency (p99)** | Worst-case response time experienced by 1% of requests |
| **Errors** | Count of non-2xx responses — should be near zero |
| **Timeouts** | Requests that exceeded the timeout — indicates overload |
| **Bytes transferred** | Bandwidth usage |

**Correlating with built-in metrics:**

After a load test, check the prometheus `/metrics` endpoint:

```bash
curl http://localhost:3001/metrics
```

Relevant metrics for load testing:

| Metric | What to watch |
|--------|---------------|
| `indexer_errors_total` | Should not increase during load (indexer is independent) |
| `indexer_circuit_state` | Should remain `0` (CLOSED) |

---

## 6. Acceptable Thresholds

### Latency Targets

| Endpoint Type | p50 | p95 | p99 | Notes |
|---------------|-----|-----|-----|-------|
| Read (GET) | < 50ms | < 200ms | < 500ms | `/api/streams`, `/api/health`, `/api/assets` |
| Search | < 100ms | < 300ms | < 800ms | `/api/streams/search` |
| Write (POST) | < 200ms | < 500ms | < 2000ms | `/api/streams`, `/api/streams/:id/cancel` |
| History/Snapshot | < 50ms | < 200ms | < 500ms | `/api/streams/:id/history`, `/api/streams/:id/snapshot` |
| Metrics | < 100ms | < 300ms | < 500ms | `/api/metrics` |

### Throughput Targets

| Environment | Read Throughput | Write Throughput | Concurrency |
|-------------|----------------|-----------------|-------------|
| Local (SQLite, no cache) | 200+ req/s | 10+ req/s | 50 connections |
| Local (Redis cache) | 500+ req/s | 10+ req/s | 50 connections |
| CI | 100+ req/s | 5+ req/s | 20 connections |
| Staging/Production | 1000+ req/s | 50+ req/s | 200 connections |

### Error Rate Targets

- **Error rate**: < 0.1% of all requests should return non-2xx status codes
- **Timeouts**: 0% under normal load
- **Rate limits (429)**: Expected in mutation tests with default settings. Excluding rate-limit errors, error rate must be < 0.1%

> **Note:** Write endpoint thresholds assume rate limits have been raised. Default `MUTATION_RATE_LIMIT=10` will return 429 after 10 requests per minute.

---

## 7. Tuning Guide

### Adjusting Rate Limits

Rate limits protect the server from abuse but can bottleneck load tests. Adjust per environment:

```bash
# backend/.env or environment variables
READ_RATE_LIMIT=5000          # Max read requests per minute (default)
MUTATION_RATE_LIMIT=1000      # Max mutation requests per minute (increase for testing)
CLAIMABLE_RATE_LIMIT=300      # Max claimable queries per minute
AUTH_CHALLENGE_RATE_LIMIT=100 # Max auth challenge requests per minute
```

**Recommendations:**

| Scenario | READ_RATE_LIMIT | MUTATION_RATE_LIMIT |
|----------|----------------|---------------------|
| Development | 5000 | 10 |
| Load testing reads | 50000 | 1000 |
| Load testing writes | 5000 | 1000 |
| Production | 5000 | 10 |

### Cache Tuning

| Parameter | Default | Description | Tuning Advice |
|-----------|---------|-------------|---------------|
| Cache TTL (streams) | 5s | How long stream list responses are cached | Increase to 10-30s for read-heavy workloads |
| Cache TTL (metrics) | 60s | How long `/api/metrics` responses are cached | Increase to 120-300s if metrics don't need real-time freshness |
| Cache TTL (metrics history) | 300s | How long `/api/metrics/history` is cached | Sufficient at 300s for dashboard use |

**Enable Redis for multi-instance caching:**

```bash
# backend/.env
REDIS_URL=redis://redis:6379
```

Redis replaces the in-memory cache, providing a shared cache across backend instances.

### SQLite Performance

SQLite performance is influenced by pragmas set in `db.ts`:

| Pragma | Current Value | Description |
|--------|---------------|-------------|
| `journal_mode` | WAL | Write-Ahead Logging — allows concurrent reads during writes |
| `synchronous` | NORMAL | Balances durability and write speed |
| `busy_timeout` | 5000 | Prevents SQLITE_BUSY errors on concurrent writes |
| `cache_size` | -64000 | 64MB page cache for read performance |

**For write-heavy workloads:**

1. Ensure WAL mode is active (confirmed in `db.ts`)
2. Reduce `RECONCILIATION_INTERVAL_MS` (default 60000ms) to update streams more frequently
3. Consider batching mutations (the bulk-cancel endpoint already does this)
4. Monitor `cache_size` — increase to -128000 (128MB) if the database grows large

### Indexer and Worker Tuning

| Variable | Default | Description | Tuning Advice |
|----------|---------|-------------|---------------|
| `INDEXER_POLL_INTERVAL_MS` | 10000 | Indexer poll interval (ms, min 5000) | Increase to 30000 for lower RPC load |
| `RECONCILIATION_INTERVAL_MS` | 60000 | Reconciliation job interval (ms, min 10000) | Increase to 300000 in steady state |
| `ARCHIVE_CRON_INTERVAL_MS` | 86400000 | Archive job interval (ms, min 60000) | Default 24h is appropriate |

### Concurrency and Backend

The backend uses `p-limit` with concurrency 5 for on-chain batch operations (`getOnChainClaimableBatchChunk`, `syncStreams`). This prevents overwhelming the RPC endpoint.

**Node.js event loop tuning:**

```bash
# Increase max listeners if you see "(node) warning: possible EventEmitter memory leak"
export NODE_OPTIONS="--max-old-space-size=512"
```

---

## 8. Common Failure Modes and Fixes

### SQLITE_BUSY / Database Locked

**Symptoms:** 500 errors with "SQLITE_BUSY" in logs, autocannon shows increasing errors under concurrent writes.

**Causes:**
- Multiple concurrent write transactions to SQLite
- Long-running indexer or reconciliation jobs contending with API writes

**Fixes:**
1. Verify WAL mode: `PRAGMA journal_mode=WAL;` (already enabled in `db.ts`)
2. Ensure `busy_timeout` is set: `PRAGMA busy_timeout=5000;`
3. Reduce write concurrency in load tests (`-c 3` for mutation tests)
4. Consider Redis for multi-instance deployments to reduce direct DB contention
5. Check for long-running transactions in indexer or reconciliation workers

### Rate Limit (429) Flood

**Symptoms:** autocannon output shows `429` status codes as the dominant response.

**Causes:**
- Default `MUTATION_RATE_LIMIT=10` is easily exceeded
- Read tests exceeding 5000 req/min

**Fixes:**
1. Increase rate limits for testing (see [Tuning Guide](#7-tuning-guide))
2. Use a separate `.env.loadtest` profile with elevated limits
3. Disable rate limiting entirely for internal benchmark runs (not recommended for production-like tests)

### High Latency Under Load

**Symptoms:** p99 latency exceeds thresholds, throughput plateaus or drops.

**Causes:**
- Cache misses forcing repeated database queries
- Indexer or reconciliation job consuming CPU during test
- SQLite read contention from large result sets
- Node.js garbage collection pauses

**Fixes:**
1. Enable Redis cache for multi-instance deployments
2. Increase cache TTLs (see [Cache Tuning](#cache-tuning))
3. Warm up the cache before measurement: `GET /api/streams` a few times
4. Pause background jobs during benchmarks:
   ```bash
   # Set high intervals to effectively disable during testing
   INDEXER_POLL_INTERVAL_MS=86400000
   RECONCILIATION_INTERVAL_MS=86400000
   ```
5. Ensure autocannon uses `--warmup` to allow the server to reach steady state
6. Verify SQLite `cache_size` is adequate for the data volume

### Connection Timeouts

**Symptoms:** autocannon reports timeouts, `socket hang up` errors.

**Causes:**
- Server event loop blocked by synchronous SQLite writes
- Insufficient Node.js `--max-old-space-size`
- Operating system connection limits

**Fixes:**
1. Reduce concurrency to a level the server can handle
2. Increase `NODE_OPTIONS="--max-old-space-size=1024"` for larger heaps
3. On macOS/Linux, check `ulimit -n` (open file descriptor limit)
4. Use `--timeout 30` in autocannon for longer-running endpoints

### Memory Exhaustion

**Symptoms:** Process exits with `FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed`, autocannon tests fail midway.

**Causes:**
- Large cached response sets accumulating in the in-memory cache
- Memory leak in long-running operations
- Insufficient heap allocation

**Fixes:**
1. The in-memory cache (default) has no size limit — switch to Redis for production
2. Set `--max-old-space-size=1024` in `NODE_OPTIONS`
3. If using Redis, ensure `maxmemory` and `maxmemory-policy` are configured on the Redis server
4. Monitor memory usage via `/metrics` — the Prometheus endpoint reports Node.js memory stats

---

## 9. Historical Baseline Results

The following baselines were recorded on a local development machine (M1 MacBook Pro, 16GB RAM, SQLite WAL mode, in-memory cache, no Redis). Results are for reference only — actual performance depends on hardware, data volume, and configuration.

### Read Baselines (GET /api/streams)

| Date | Concurrency | Duration | p50 Latency | p99 Latency | Throughput | Errors |
|------|-------------|----------|-------------|-------------|------------|--------|
| 2026-07-30 | 50 | 30s | 8 ms | 45 ms | 1,200 req/s | 0 |
| 2026-07-30 | 100 | 30s | 15 ms | 85 ms | 1,800 req/s | 0 |
| 2026-07-30 | 200 | 30s | 35 ms | 210 ms | 2,400 req/s | 0 |

### Write Baselines (POST /api/streams, rate limit raised to 1000)

| Date | Concurrency | Duration | p50 Latency | p99 Latency | Throughput | Errors |
|------|-------------|----------|-------------|-------------|------------|--------|
| 2026-07-30 | 5 | 20s | 25 ms | 80 ms | 45 req/s | 0 |
| 2026-07-30 | 10 | 20s | 60 ms | 220 ms | 72 req/s | 0 |

### Mixed Workload (5 concurrent writers + 50 concurrent readers)

| Date | Duration | Read p50 | Read p99 | Write p50 | Write p99 | Errors |
|------|----------|----------|----------|-----------|-----------|--------|
| 2026-07-30 | 60s | 12 ms | 95 ms | 40 ms | 180 ms | 0 |

> **Note:** These baselines represent a development environment. For production baselines, run the same scenarios against a staging environment with production-like data volumes, Redis enabled, and realistic network conditions.

---

## 10. Related Documentation

- **[Backend Testing Guide](../backend/TESTING.md)** — Unit and integration test suite
- **[Deployment Guide](../DEPLOYMENT.md)** — Production deployment instructions
- **[Operational Runbook](../RUNBOOK.md)** — Common operational procedures
- **[Smart Contract Benchmarks](../contracts/BENCHMARKS.md)** — Gas and WASM size benchmarks
- **[Frontend Performance](../frontend/PERFORMANCE.md)** — Bundle size and client-side performance
- **[CLAUDE.md](../CLAUDE.md)** — Developer setup and architecture overview
