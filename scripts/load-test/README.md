# Load Tests

This directory contains load/performance tests for the StellarStream backend API.

## Prerequisites

- [k6](https://k6.io/docs/getting-started/installation/) installed and on your `PATH`.
- The backend server running locally (or a deployed instance).

## Running

Start the backend (see `backend/README.md` or the root `README.md` for setup), then:

```bash
k6 run scripts/load-test/stream-load-test.js
```

Or via the root package script:

```bash
npm run load-test
```

### Configuration

The script reads the following environment variables:

| Variable     | Default                    | Description                                        |
| ------------ | -------------------------- | -------------------------------------------------- |
| `BASE_URL`   | `http://localhost:3001`    | Base URL of the backend API.                       |
| `JWT_SECRET` | `test_secret_for_load_test`| Secret used to sign JWTs. Must match the backend's `JWT_SECRET` so the generated tokens are accepted. |
| `VUS`        | `200`                      | Maximum number of concurrent virtual users.        |
| `DURATION`   | `5m`                       | Duration of the sustained-load phase.              |

Example with a custom target:

```bash
BASE_URL=http://localhost:3001 JWT_SECRET=my-secret VUS=200 DURATION=5m \
  k6 run scripts/load-test/stream-load-test.js
```

## Covered Endpoints

- `POST /api/streams` — create a stream
- `GET /api/streams` — list streams
- `POST /api/streams/:id/cancel` — cancel a stream

## Load Profile

The test ramps from **10** concurrent users up to the configured maximum
(default **200**), holds that load for the configured duration, then ramps
back down to zero.

## SLOs

The following SLOs are enforced via k6 thresholds. The test **fails** if any
threshold is breached:

| SLO                          | Threshold          |
| ---------------------------- | ------------------ |
| p95 latency (all endpoints)  | `< 200 ms`         |
| Error rate (all endpoints)   | `< 0.5%`           |

## Report

k6 emits a summary report at the end of the run with a full percentile
breakdown (`p50`, `p90`, `p95`, `p99`, `max`) for each covered endpoint via
custom `Trend` metrics:

- `http_req_duration_create`
- `http_req_duration_list`
- `http_req_duration_cancel`

For a JSON report, add `--summary-export=report.json`:

```bash
k6 run --summary-export=report.json scripts/load-test/stream-load-test.js
```

## Data Integrity

The test creates a stream and immediately cancels it in the same iteration,
so no orphaned streams accumulate. Each virtual user uses a distinct JWT, and
the test asserts on HTTP status codes to detect unexpected failures. To verify
no data corruption under load, inspect the backend logs and the stream list
after the run (e.g. `GET /api/streams`) to confirm all created streams were
either cancelled or are in a valid state.
