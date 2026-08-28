# Stellar Stream Monitoring

Prometheus + Grafana stack for the backend. The backend exposes a Prometheus
endpoint at `GET /metrics` (issue #717).

## Metrics exposed

| Metric                 | Type       | Labels               | Meaning                                        |
| ---------------------- | ---------- | -------------------- | ---------------------------------------------- |
| `request_count`        | Counter    | method, route, status_code | HTTP requests handled                     |
| `request_duration_ms`  | Histogram  | method, route        | HTTP request duration                          |
| `stream_count`         | Gauge      | status               | Streams by current status (scheduled/active/paused/completed/canceled) |
| `claim_count`          | Gauge      | —                    | Total claims recorded                          |
| `cancel_count`         | Gauge      | —                    | Total cancellations recorded                   |
| `indexer_lag_seconds`  | Gauge      | —                    | Seconds since the indexer last successfully polled the chain head |
| `events_indexed_total` | Counter    | —                    | Events indexed by the indexer                  |
| `ledgers_scanned_total`| Counter    | —                    | Ledgers scanned by the indexer                 |
| `indexer_errors_total` | Counter    | —                    | Indexer poll errors                            |
| `indexer_circuit_state`| Gauge      | —                    | Indexer circuit breaker state (0/1/2)          |

## Basic auth

In production the endpoint is protected with HTTP Basic Auth. Set
`METRICS_AUTH` on the backend (format `user:password`, e.g.
`METRICS_AUTH=metrics:super-secret`). Requests without valid credentials
receive `401 Unauthorized`; Prometheus sends the same credentials via its
scrape `basic_auth` block.

## Running the stack

1. Start the backend with `METRICS_AUTH` set.
2. Configure Prometheus credentials (must match the backend):
   ```bash
   export METRICS_USER=metrics
   export METRICS_PASSWORD=super-secret
   ```
3. Bring up the stack:
   ```bash
   docker compose -f monitoring/docker-compose.yml up -d
   ```
4. Open Grafana at http://localhost:3000 (default `admin`/`admin`) — the
   **Stellar Stream — Backend** dashboard is provisioned automatically and
   loads with live data.

## Alerting

Rules live in `monitoring/prometheus/alerts.yml`:

- **StellarStreamIndexerLagHigh** — fires when `indexer_lag_seconds > 60`,
  i.e. the indexer has not successfully polled the chain head for over a
  minute. This is the acceptance-criteria alert from #717.
- **StellarStreamIndexerErrors** — fires when the indexer records errors.
- **StellarStreamHighErrorRate** — fires when API 5xx responses exceed 5%.

Wire the alert to a notification channel (email, Slack, PagerDuty) in Grafana
→ Alerting → Contact points.
