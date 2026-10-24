# Environment Validation Boundary Behavior

**Batch ID**: SSB-2026-171  
**Area**: `backend`

This document defines the startup boundary behavior, outcome codes, exit semantics, and secret redaction rules implemented in `backend/src/config/validateEnv.ts`.

---

## 1. `SOROBAN_DISABLED` and Contract Credentials Boundary Matrix

| `SOROBAN_DISABLED` | `NODE_ENV` / `STELLAR_NETWORK` | `CONTRACT_ID` / `STELLAR_CONTRACT_ID` | `SERVER_PRIVATE_KEY` | Exit / Outcome | Returned Config & Log Semantics |
|---|---|---|---|---|---|
| Unset / `""` / `"false"` | Any (`testnet` or `mainnet`) | Valid (`^C[A-Z2-7]{55}$`) | Valid (`^S[A-Z2-7]{55}$`) | `outcome: "success"`, `outcomeCode: 0` | `sorobanEnabled: true`, `contractId` and `serverPrivateKey` populated. Secret never logged. |
| Unset / `""` / `"false"` | Any | Missing or whitespace-only | Any / Missing | `exit(1)` · `outcome: "blocked"`, `outcomeCode: 2` | Logs missing variable names (`CONTRACT_ID`, `SERVER_PRIVATE_KEY`); never logs secret values. |
| Unset / `""` / `"false"` | Any | Any / Missing | Missing or whitespace-only | `exit(1)` · `outcome: "blocked"`, `outcomeCode: 2` | Logs missing variable name (`SERVER_PRIVATE_KEY`); never logs secret values. |
| Unset / `""` / `"false"` | Any | Both set to different values | Valid | `exit(1)` · `outcome: "blocked"`, `outcomeCode: 2` | Fails fast with `CONTRACT_ID and STELLAR_CONTRACT_ID must match when both are set`. |
| Unset / `""` / `"false"` | Any | Malformed (`length != 56`, non-`C` prefix, or non-Base32 `[A-Z2-7]`) | Valid | `exit(1)` · `outcome: "blocked"`, `outcomeCode: 2` | Logs `CONTRACT_ID validation failed` without echoing the raw value. |
| Unset / `""` / `"false"` | Any | Valid | Malformed (`length != 56`, non-`S` prefix, or non-Base32 `[A-Z2-7]`) | `exit(1)` · `outcome: "blocked"`, `outcomeCode: 2` | Logs `SERVER_PRIVATE_KEY validation failed` without disclosing the secret value. |
| `"true"` (case/whitespace-insensitive) | Non-production + `testnet` | Unset | Unset | `outcome: "success"`, `outcomeCode: 0` | `sorobanEnabled: false`, `contractId: null`, `serverPrivateKey: null`. |
| `"true"` | Non-production + `testnet` | Configured (valid or placeholder) | Configured or unset | `outcome: "success"`, `outcomeCode: 0` | Warns that `CONTRACT_ID` and/or `SERVER_PRIVATE_KEY` are ignored in disabled mode; returns `contractId: null`, `serverPrivateKey: null`; never logs secrets. |
| `"true"` | `NODE_ENV=production` or `STELLAR_NETWORK=mainnet` | Any | Any | `exit(1)` · `outcome: "blocked"`, `outcomeCode: 2` | Rejects `SOROBAN_DISABLED=true` in production or on mainnet without logging credentials. |
| Non-boolean string (e.g. `"yes"`, `"1"`, `"invalid"`) | Any | Any | Any | `exit(1)` · `outcome: "blocked"`, `outcomeCode: 2` | Fails fast (`SOROBAN_DISABLED must be "true" or "false"`) without silently enabling Soroban or echoing the value. |

---

## 2. RPC URL and Secret Redaction Semantics

- **Protocol & Format Enforcement**: `RPC_URL`, `SOROBAN_RPC_URL`, and `WEBHOOK_DESTINATION_URL` must be valid `http:` or `https:` URLs. `RPC_URL` and `SOROBAN_RPC_URL` are validated in both `SOROBAN_DISABLED=false` and `SOROBAN_DISABLED=true` modes, and must match if both are explicitly configured.
- **Credential Redaction (`redactUrlForConfigLog`)**:
  - For parseable URLs: redacts `username`, `password`, query parameters matching sensitive keys (`secret`, `token`, `password`, `pass`, `signature`, `sig`, `key`, `auth`, `credential`, `bearer`, `private`), and path segments or query values containing Stellar secret seeds (`S[A-Z2-7]{55}`).
  - For malformed URLs: replaces the entire string with `[REDACTED_INVALID_URL]` whenever sensitive parameter names, URL userinfo (`//user:pass@`), or Stellar secret seeds are present.
- **Zero Secret Disclosure**: Validation error payloads strip raw Zod input values (`issue.input`) and never echo `SERVER_PRIVATE_KEY`, `ADMIN_API_KEY`, `JWT_SECRET`, or `WEBHOOK_SIGNING_SECRET`.

---

## 3. Verification

```bash
cd backend
npx vitest run src/config/validateEnv.test.ts
```
