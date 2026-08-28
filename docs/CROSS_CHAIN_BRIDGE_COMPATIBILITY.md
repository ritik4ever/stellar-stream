# Cross-Chain Bridge Compatibility Notes

This document describes which wrapped / bridged assets can be used as
**stream tokens** with the StellarStream Soroban contract, how oracle
availability differs per asset, and when to warn users about illiquid assets
with high price volatility.

It complements the [`CONTRACT_ABI.md`](./CONTRACT_ABI.md) reference and the
[multi-asset design decision](./adr/0005-multi-asset-support-design.md).

---

## 1. How a token becomes a stream token

Streams are denominated in a single token. The contract accepts two kinds of
token addresses (see `contracts/src/lib.rs`):

1. **Native Stellar (XLM)** — passed via the native sentinel address
   (`GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF`). It is resolved
   through the `native_token` value stored by `initialize` and never needs to
   be added to the allowlist.
2. **SEP-41 token contracts** — any Stellar Asset (SAC) wrapped or bridged
   asset that implements the SEP-41 interface. It must be present in the
   contract's `allowed_tokens` allowlist (managed via `add_allowed_token` /
   `remove_allowed_token` by the admin) or `create_stream` / `create_split_stream`
   will reject it with `ContractError::TokenNotAllowed`.

In practice every bridged asset arrives on Stellar as a **Stellar Asset
Contract** (`StellarAssetContract`), so the same allowlist + SEP-41 path covers
wrapped assets from Stellar bridges and cross-chain bridges alike.

---

## 2. Bridged asset compatibility table

The table lists bridged assets commonly used on Stellar networks, whether they
are usable as stream tokens, and whether a price oracle is typically available.

| Asset | Issuer / bridge | Contract | Works as stream token | Oracle availability | Notes |
|-------|-----------------|----------|----------------------|---------------------|-------|
| **XLM** | Native | Native (sentinel) | ✅ Yes (native path) | ✅ Stellar DEX + external | No allowlist entry needed. |
| **USDC** | Circle (via bridge / native SAC) | SEP-41 SAC | ✅ Yes | ✅ High (centralized + on-chain feeds) | Deep liquidity on most pairs. |
| **USDT** | Tether (bridged) | SEP-41 SAC | ✅ Yes | ✅ High | Wrapped via bridge; verify the specific issuer contract is allowlisted. |
| **wETH** | Wrapped ETH bridge | SEP-41 SAC | ✅ Yes | ✅ High | On-chain price oracles widely available. |
| **wBTC** | Wrapped BTC bridge | SEP-41 SAC | ✅ Yes | ✅ High | On-chain price oracles widely available. |
| **EURC** | Circle EUR (bridged) | SEP-41 SAC | ✅ Yes | ⚠️ Medium | Oracle support exists but is thinner than USDC. |
| **ARB / OP** | L2 bridged tokens | SEP-41 SAC | ✅ Yes | ⚠️ Medium | Liquidity varies by pair; bridge risk should be reviewed. |
| **Long-tail tokens** (meme / niche wrapped assets) | Various bridges | SEP-41 SAC | ⚠️ Allowed only if allowlisted | ❌ Low / none | High volatility and thin order books; see §4 warnings. |

> **At least 5 bridged assets** (USDC, USDT, wETH, wBTC, EURC) are
> documented above, all of which work as stream tokens once their issuer
> contract is added to the allowlist.

---

## 3. Oracle availability per bridged asset

The contract itself does **not** read price oracles — vesting is time-based and
denominated in the stream token. However, applications built on top of the
contract (dashboard valuations, USD-equivalent reporting, liquidations) need an
oracle for the stream token. Oracle availability drives product decisions:

| Oracle tier | Assets | Implication |
|-------------|--------|-------------|
| **High** | XLM, USDC, USDT, wETH, wBTC | Stable, on-chain or centralized price feeds. Safe to display USD-equivalent values and use for automated logic. |
| **Medium** | EURC, ARB, OP | Feeds exist but are updated less frequently or from fewer sources. Add staleness guards before using in critical paths. |
| **Low / none** | Long-tail wrapped assets | No reliable feed. Avoid USD-equivalent automation; treat valuations as indicative only. |

**Recommendation:** keep an `oracleSupported` / `priceFeed` metadata flag per
allowed asset so the UI can degrade gracefully (hide USD equivalents, warn
before creating streams in unoracled assets).

---

## 4. Liquidity warning criteria

Illiquid assets with high price volatility should surface an explicit warning
before a stream is created. Define the warning using both liquidity and
volatility signals.

### 4.1 Liquidity criteria

Warn when **any** of the following holds for the bridged asset:

- **Thin order book:** 24h traded volume on the primary pair is below
  `MIN_DAILY_VOLUME` (recommended default: **$10,000**), or the maximum sellable
  amount without moving the mid price more than 1% is below `MIN_DEPTH`.
- **Low pool depth:** For AMM pools, total liquidity below
  `MIN_POOL_TVL` (recommended default: **$50,000**).
- **Few active market makers:** fewer than `MIN_ACTIVE_MM` (recommended
  default: **2**) unique market makers quoting the pair in the last 24h.

### 4.2 Volatility criteria

Warn when the asset shows **high volatility**, e.g.:

- 24h price change magnitude exceeds `MAX_24H_CHANGE` (recommended default:
  **±10%**), **or**
- realized volatility (annualized, 30-day window) exceeds
  `MAX_REALIZED_VOL` (recommended default: **60%**).

### 4.3 Warning copy

A stream-denominated-in-an-illiquid-asset stream can be hard to unwind: the
recipient may receive tokens that cannot be sold at the implied price, and the
sender's escrow may lock value in a volatile token. Surface a warning like:

> **Liquidity warning:** `{ASSET}` has low liquidity ({24h volume}) and high
> price volatility ({24h change}). Stream value may fluctuate significantly.

If **both** criteria groups (liquidity AND volatility) trip, treat the asset as
**high risk** and require explicit confirmation before allowing `create_stream`.

---

## 5. Operational guidance

1. **Allowlist only trusted issuers.** Add bridged-asset contracts to
   `allowed_tokens` only after verifying the issuer's provenance (native SAC vs
   third-party bridge) and clawback/authorization flags.
2. **Pin oracle staleness.** For medium-tier assets, reject USD-equivalent
   conversions when the feed is older than `MAX_ORACLE_AGE` (recommended
   default: **10 minutes**).
3. **Test on Testnet first.** Configure `ALLOWED_ASSETS` (backend) and the
   contract allowlist with testnet-issued versions of the bridged assets before
   enabling Mainnet.
4. **Document per-deployment choices.** Record which issuers were allowlisted
   and why in `DEPLOYMENT.md` so a future operator can audit bridge exposure.

---

## 6. References

- [Contract ABI reference](./CONTRACT_ABI.md)
- [Multi-asset support ADR](./adr/0005-multi-asset-support-design.md)
- [Stream math & edge cases](./STREAM_MATH.md)
- [Deployment guide](../DEPLOYMENT.md)
