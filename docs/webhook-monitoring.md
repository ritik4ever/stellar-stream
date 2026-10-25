# Webhook Monitoring

This runbook describes the outbound webhook queue monitoring path, the clean-room checks for a bursty delivery queue, and the recovery procedure when the destination remains unavailable.

The monitoring signal is built from queue counts only. It does not select or print webhook payloads, destination URLs, stream IDs, signing secrets, or request bodies.

## Runtime surfaces

| Surface | Purpose |
| --- | --- |
| `GET /api/webhooks/monitoring` | Auth-protected REST endpoint that returns `outcome`, `outcomeCode`, `detail`, `isNormalEmpty`, `latencyMs`, and count-only queue state. |
| `/metrics` | Prometheus gauges for pending deliveries, due retries, scheduled retries, dead letters, and the coarse webhook outcome. |
| `backend/src/services/webhookQueueStats.ts` | Count-only smoke-check helper for pending, due-now, scheduled retry, delivered, and dead-letter totals. |

## Validated settings

These settings are validated during startup in `backend/src/config/validateEnv.ts`. Invalid values fail before the service starts, so there is no partial rollout with broken monitoring thresholds.

| Setting | Default | Validation | Use |
| --- | ---: | --- | --- |
| `WEBHOOK_MONITOR_PENDING_WARN_THRESHOLD` | `100` | positive integer | Warn threshold for a bursty pending queue. |
| `WEBHOOK_MONITOR_RETRY_DUE_WARN_THRESHOLD` | `10` | positive integer | Warn threshold for deliveries due for immediate retry. |
| `WEBHOOK_MONITOR_DEAD_LETTER_ALERT_THRESHOLD` | `1` | positive integer | Alert threshold for dead-lettered deliveries. |
| `WEBHOOK_DESTINATION_URL` | unset | valid URL when present | Receiver endpoint. Validation logs redact sensitive query fields. |
| `WEBHOOK_SIGNING_SECRET` | unset | optional | HMAC signing key. Never log the value. |

If `WEBHOOK_DESTINATION_URL` contains query fields named like `token`, `secret`, `signature`, `password`, or `key`, validation logs redact those fields.

## Outcome classification

| Outcome | Meaning | Owner action |
| --- | --- | --- |
| `success` | Nothing is pending or dead-lettered, or the destination is unconfigured and no work exists. When the queue is empty, `isNormalEmpty` is `true` so the empty case is clearly distinct from a failure. | None. |
| `transient_delay` | Deliveries are pending, with some due now or waiting for backoff, and the retry budget is intact. A temporary `5xx` response is treated as a transient failure with a structured latency and retry signal. | None while the count falls. Watch that `pending == dueNow + scheduledRetries`. |
| `blocked` | A delivery has exhausted retries, or work is queued while no destination URL is configured. | Fix the receiver or config, then requeue dead letters. |

## Clean environment reproduction

From a fresh checkout or isolated service, run:

```bash
cd backend
npm test -- src/services/webhookQueueStats.test.ts src/services/webhookMonitor.test.ts src/services/webhookWorker.test.ts
```

Expected result:

- Queue accounting tests pass without a live webhook receiver.
- The bursty queue case reports pending deliveries as `transient_delay` while retry budget remains.
- Dead-lettered deliveries report `blocked` with a detail string that contains counts only.

## Bursty delivery queue procedure

1. Confirm configuration before sending traffic:
   - `WEBHOOK_DESTINATION_URL` is either intentionally unset or a valid URL.
   - `WEBHOOK_SIGNING_SECRET` is set when signed webhooks are required.
   - Monitoring thresholds are positive integers.
2. Watch count-only metrics during the burst:
   - `pending`
   - `dueNow`
   - `scheduledRetries`
   - `deadLetters`
3. The expected invariant is:

```text
pending == dueNow + scheduledRetries
```

4. A healthy burst drains toward `pending = 0` without `deadLetters` increasing.

## Destination remains unavailable

Detection:

- `outcome = blocked`, or
- `deadLetters >= WEBHOOK_MONITOR_DEAD_LETTER_ALERT_THRESHOLD`, or
- pending deliveries keep returning to `dueNow` without successful delivery.

Recovery:

1. Stop new rollout activity that depends on webhook delivery.
2. Verify the receiver outside this service with a safe health check.
3. Confirm the destination URL and signing secret are correct in the deployment secret store.
4. If the receiver is healthy, requeue dead letters through the existing dead-letter requeue endpoint.
5. Verify that `deadLetters` stops increasing and `pending` drains to zero.

Rollback step:

- If the receiver cannot be made healthy, keep the service running but disable the webhook destination for new deployments, preserve existing dead letters, and restore the last known working receiver configuration before requeueing.

## Delivery and retry semantics

### Safe recovery and rollback semantics (SSB-2026-152)

- **Absence of Duplicate Money-Moving Effects**: Outbound webhook delivery operates strictly after stream lifecycle and money movements commit. Webhook retries never re-trigger, simulate, or duplicate on-chain Soroban transactions, token transfers, escrow mutations, or stream events.
- **Explicit Retry Path on Temporary 5xx and Timeouts**: When an endpoint times out or returns a temporary 5xx (`500`, `502`, `503`, `504`), the worker retains the active delivery row in `pending` status and schedules a retry using configured backoff intervals (`5s`, `15s`, `60s`, `300s`, `900s`). Every retry re-sends the identical `Idempotency-Key` (`stellar-stream-<delivery id>`) header and exact canonical JSON body so endpoints can safely deduplicate received requests.
- **Explicit Dead-Letter Rollback Path**: When attempts reach `max_attempts` without a `2xx` response, the delivery is removed from `webhook_deliveries` and moved to `webhook_dead_letters` in a single transaction. No duplicate entries or dangling delivery rows remain. If a worker restart interrupts the transition, structured signals (`dead_letter_transition_interrupted`) surface the state for operator reconciliation.

- Any `2xx` response marks the delivery `success`. A successful delivery does not increase `attempt`, and `next_retry_at` is cleared because no further retry is scheduled.
- Any non-`2xx` HTTP response, including a temporary `5xx`, and any transport error or timeout count as one failed attempt. The delivery remains pending with the configured backoff until it succeeds or exhausts `max_attempts`, after which it is moved to dead-letter storage. A timeout is ambiguous: the receiver may have processed the request even though this service did not receive its response.
- Retries of the same queue row send the same `Idempotency-Key` (`stellar-stream-<delivery id>`) and the same request body. Receivers should retain processed keys and return the original success for a repeated key to avoid applying a timed-out request twice. A manually requeued dead letter is a new queue row and therefore has a new key.
- `attempt` counts failed attempts, not total requests. Delivery rows and their keys are scoped to this service's database.
