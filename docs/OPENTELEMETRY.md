# OpenTelemetry tracing

The backend emits distributed traces for inbound HTTP/Express requests,
SQLite/Postgres database operations, and indexer polls. Trace and span IDs are
also included in structured log entries, allowing a request to be followed
from the API through persistence and the Stellar indexer.

## Local Jaeger

The default Docker Compose stack starts Jaeger with OTLP HTTP enabled:

```bash
docker compose up --build
open http://localhost:16686
```

The backend sends traces to `http://jaeger:4318/v1/traces` and registers the
service as `stellar-stream-backend`. To use another collector, set:

```bash
OTEL_SERVICE_NAME=stellar-stream-backend
OTEL_EXPORTER_OTLP_ENDPOINT=https://collector.example/v1/traces
```

The endpoint may include or omit `/v1/traces`; the bootstrap normalizes it.
Collector outages do not prevent the API from starting. Keep request bodies,
authorization headers, wallet secrets, and personal data out of span
attributes. The existing logger redaction remains in force.

## Verification

1. Start the stack and open Jaeger at `http://localhost:16686`.
2. Make an API request and select the `stellar-stream-backend` service.
3. Confirm the trace contains HTTP/Express and `db.query` spans.
4. When indexing is enabled, confirm `stellar.indexer.poll` spans include the
   contract ID and ledger number but no credentials.
