# Authentication Challenge Observability

**Batch ID**: SSB-2026-164  
**Area**: `backend`

This document specifies the observable telemetry, operational outcome signals, and runbook procedures for the Stellar SEP-10 Authentication challenge workflow (`verifyChallengeAndIssueToken`), covering:
- Wallet signing for the wrong network (e.g., Mainnet vs. Testnet)
- Reused nonces (replay attacks) vs. expired challenges (timestamp drift)
- Distinguishing normal empty states (unfunded accounts) from authentication failures
- Structured telemetry, latency tracking, and request/stream correlation without credential leakage

---

## 1. Challenge Lifecycle & SEP-10 Overview

Stellar SEP-10 web authentication allows clients to authenticate by proving ownership of a Stellar account. The lifecycle evaluates several states:

| Phase | Boundary / Condition | Classification & Reason | Operator Classification |
|---|---|---|---|
| **Clean Verification** | Valid client signature matching `NETWORK_PASSPHRASE` | `outcome: "success"`, code `0`, `reason: "success"`. | Healthy authentication. Token issued. |
| **Normal Empty Account** | Account has no Horizon record (unfunded account, 0 signers) | `outcome: "success"`, code `0`, `reason: "normal_empty_account"`, `isNormalEmpty: true`. | Expected onboarding state. Falls back to single-signer verification. |
| **Timestamp Drift / Expiry** | `timeDiff > 60s` or TimeBounds exceeded | `outcome: "transient_delay"`, code `1`, `reason: "expired_nonce"`. | Self-healing transient issue. User requests a fresh challenge. |
| **Replay Attack** | Nonce is already present in `nonceStore` | `outcome: "blocked"`, code `2`, `reason: "reused_nonce"`. | Security incident / stale request replayed. Intercepted and blocked. |
| **Wrong Network Signing** | Signature invalid under server network but valid under candidate network (`PUBLIC`, `FUTURENET`, `TESTNET`) | `outcome: "blocked"`, code `2`, `reason: "wrong_network"`. | User wallet misconfiguration. Actionable guidance required. |
| **Invalid Signature / Malformed** | Signature invalid on all candidate networks or corrupt XDR | `outcome: "blocked"`, code `2`, `reason: "invalid_signature"` or `"malformed_challenge"`. | Authentication failure. |

---

## 2. Distinguishing Normal Empty Case from Authentication Failure

When a user connects with a newly generated Stellar account that has not yet been funded on the network, Horizon returns a 404 / null signer set (`fetchAccountSigners` returns `null`).

- **Normal Empty Case**:
  - `accountInfo === null`
  - `isNormalEmpty: true`
  - `outcome: "success"` (`outcomeCode: 0`)
  - `reason: "normal_empty_account"`
  - Verification succeeds using the client's public key as the sole signer, allowing new users to authenticate before acquiring funds.
  - Alerting systems must **not** fire alerts on `normal_empty_account`.

- **Operational Failure**:
  - `isNormalEmpty: false`
  - `outcome: "blocked"` (`outcomeCode: 2`)
  - Verification fails due to wrong network, replay, or invalid signature.

---

## 3. Wrong Network Detection & Diagnosis

A common user issue occurs when a wallet (e.g., Freighter, Albedo, Lobstr) is configured to sign on `Public Global Stellar Network` while the server is running on `Test SDF Network` (or vice-versa).

### Detection Mechanism
1. The challenge transaction is generated and signed by the server under `NETWORK_PASSPHRASE`.
2. When client verification fails under `NETWORK_PASSPHRASE`, candidate networks (`Networks.PUBLIC`, `Networks.TESTNET`, `Networks.FUTURENET`) are tested.
3. If the client signature matches `candidateTx.hash()`, the wrong network is deterministically identified.
4. Outcome is set to `blocked` (code `2`), `reason: "wrong_network"`, and counter `auth_challenge_wrong_network_total` is incremented.

### Operator & User Action
- Instruct the user to open their Stellar wallet extension/application and switch the active network to match the server network (e.g. switch Freighter network from "Public" to "Testnet").
- Verify `NETWORK_PASSPHRASE` environment variable on the server deployment.

---

## 4. Replay Attack vs. Expired Nonce Classification

The authentication workflow enforces strict separation between transient clock drift and actionable replay attacks:

1. **Expired Nonce / Timestamp Drift (`transient_delay`, Code 1)**:
   - Condition: `abs(now - timestamp) > 60` seconds or ledger TimeBounds window elapsed.
   - Self-healing: Client simply re-initiates the challenge endpoint (`GET /api/auth/challenge`).
   - Counter/Gauge: Gauge set to `1`. No replay alert fired.

2. **Replayed Nonce (`blocked`, Code 2)**:
   - Condition: Nonce exists in memory within the 60-second validity window.
   - Security Signal: Counter `auth_challenge_replay_total` is incremented.
   - Gauge set to `2`. Operator should review if traffic originates from a distributed replay attack or automated bot.

---

## 5. Observable Telemetry & Prometheus Metrics

Exported via `/metrics` in `backend/src/services/metrics.ts`:

| Metric Name | Type | Description | Values / Labels |
|---|---|---|---|
| `auth_challenge_outcome` | Gauge | Coarse authentication challenge verification outcome | `0=success`, `1=transient_delay`, `2=blocked` |
| `auth_challenge_duration_seconds` | Gauge | Latency of the most recent authentication challenge verification in seconds | Float seconds |
| `auth_challenge_wrong_network_total` | Counter | Total number of challenge failures caused by wallet signing for the wrong network | Monotonic integer count |
| `auth_challenge_replay_total` | Counter | Total number of challenge verification failures caused by reused nonces (replay attacks) | Monotonic integer count |

---

## 6. Structured Logging & Context Correlation

Structured logs are emitted via `logger` with explicit correlation linking:

```json
{
  "level": 40,
  "event": "auth_challenge_outcome",
  "outcome": "blocked",
  "outcomeCode": 2,
  "reason": "wrong_network",
  "isNormalEmpty": false,
  "latencyMs": 42,
  "accountId": "GDUKMGUGDZQK6YHYA5Z6AY2G4KDS2TNDG746L4Q2",
  "expectedNetwork": "Test SDF Network ; September 2015",
  "detectedNetwork": "Public Global Stellar Network ; September 2015",
  "correlation_id": "784d2e9e-572f-4fbd-b508-e55c6a7fae5e",
  "streamId": "34f191b2-c1ec-46da-a887-8df7d9d2fa07",
  "msg": "Auth challenge failed: Wallet signed for wrong network (Public Global Stellar Network ; September 2015 instead of expected Test SDF Network ; September 2015)"
}
```

### Context Linking
- **`correlation_id`**: Retrieved automatically from `AsyncLocalStorage` (`correlationContext.ts`) or `options.correlationId`. Links incoming HTTP request traces with auth verification logs.
- **`streamId`**: Passed via `options.streamId` or request body/query when authentication is initiated in context of a stream operation.

---

## 7. Privacy & Zero-Credential Redaction

To adhere to security best practices and prevent credential leakage:
- **No Private Keys**: Secret keys matching `^S[0-9A-Z]{55}$` are strictly prohibited from logs, metric labels, and outcome signals.
- **No Seed Phrases or Bearer Tokens**: Raw tokens and challenge seed secrets are never included.
- **Public Identifiers Only**: Only public Stellar account IDs (`^G[0-9A-Z]{55}$`), network passphrases, latency numbers, and enum codes are emitted.

---

## 8. Outcome Classification & Operator Actions

| Outcome | Code | Reason | Meaning | Operator Action |
|---|---|---|---|---|
| `success` | 0 | `success` | Valid challenge signed on expected network. | None. Token issued. |
| `success` | 0 | `normal_empty_account` | Unfunded account fallback. | None. Expected onboarding state. |
| `transient_delay` | 1 | `expired_nonce` | Timestamp older than 60s or TimeBounds passed. | None. User requests fresh challenge. |
| `blocked` | 2 | `wrong_network` | Wallet signed for wrong Stellar network. | Prompt user to change network in wallet settings. |
| `blocked` | 2 | `reused_nonce` | Nonce already consumed. | Monitor `auth_challenge_replay_total` for replay patterns. |
| `blocked` | 2 | `invalid_signature` | Signatures do not match account signers on any network. | Ensure client holds correct private key for account. |
| `blocked` | 2 | `malformed_challenge` | Missing timestamp/nonce or corrupted XDR. | Inspect client SEP-10 library version and request format. |

---

## 9. Verification & Clean-Room Testing

Run unit and boundary regression tests:

```bash
cd backend
npx vitest run src/services/auth.test.ts src/services/auth.observability.test.ts
npx eslint src/services/auth.ts src/services/authChallengeOutcome.ts src/services/metrics.ts src/services/auth.observability.test.ts
```

All boundary cases (wrong network, normal empty case, replay attack, expired challenge, secret redaction, and metric counters) are covered.
