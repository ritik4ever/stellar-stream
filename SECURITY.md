# Security Policy

## Supported Versions

The following versions of Stellar Stream are currently supported with security updates:

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take the security of Stellar Stream seriously. If you believe you have found a security vulnerability, please report it privately.

**Please do not open a public issue for security vulnerabilities.**

### Private Reporting Process

Please use the **[GitHub Security Advisory](https://github.com/stellar-stream/stellar-stream/security/advisories/new)** form to report vulnerabilities privately. 

This is the preferred method as it allows us to communicate with you privately and coordinate a fix before public disclosure.

### Our Commitment (SLA)

Once a report is received through the GitHub Security Advisory form, we commit to the following response timeline:

- **48 hours**: Acknowledgement of receipt of the report.
- **7 days**: Initial assessment and confirmation of the vulnerability.
- **30 days**: Target for providing a fix or public disclosure (depending on complexity).

## GitHub Security Advisories

Maintainers: Please ensure that **GitHub Security Advisories** are enabled for this repository to allow researchers to submit reports privately.

## Content Security Policy (CSP)

The frontend build injects a Content Security Policy to limit script execution and network connections, reducing the impact of cross-site scripting (XSS) against wallet connection state.

### Policy

```
default-src 'self';
connect-src 'self' https://rpc-futurenet.stellar.org
```

- **`default-src 'self'`** — Scripts, styles, images, and other subresources load only from the application origin.
- **`connect-src`** — `fetch`/XHR/WebSocket connections are limited to the app origin (API proxy) and the configured Stellar Futurenet RPC endpoint.

### Rollout

1. **Report-only (default)** — The Vite build sends `Content-Security-Policy-Report-Only` in development, preview, and production builds. Violations are logged by the browser but not blocked.
2. **Enforcement** — Set `VITE_CSP_ENFORCE=true` when building or serving the frontend to send `Content-Security-Policy` instead. Monitor the browser console for violations before enabling in production.

### Configuration

| Variable | Effect |
| -------- | ------ |
| (unset) | Report-only CSP via meta tag and HTTP headers |
| `VITE_CSP_ENFORCE=true` | Enforcing CSP |

Implementation: `frontend/vite.config.ts` (`content-security-policy` plugin and dev/preview headers).

## Stellar-Specific Security Considerations

### Testnet vs Mainnet Safety Checklist

Before deploying or interacting with contracts, confirm which network you're targeting:

- [ ] Verify `NETWORK_PASSPHRASE` matches the intended network (Testnet: `Test SDF Network ; September 2015`, Mainnet: `Public Global Stellar Network ; September 2015`).
- [ ] Confirm the Horizon/RPC endpoint URL points to the correct network before signing transactions.
- [ ] Never reuse Testnet keypairs for Mainnet accounts — treat them as fully separate identities.
- [ ] Double-check contract IDs; a valid contract ID on Testnet has no relationship to the same ID on Mainnet.
- [ ] Use a wallet or signer that clearly displays which network is active before every transaction approval.
- [ ] Run integration tests exclusively against Testnet/Futurenet; never point CI against Mainnet.

### Private Key Management Best Practices

- **Never commit secret keys** (`S...` seed values) to source control, `.env` files tracked by git, or CI logs.
- Store signing keys in a hardware wallet (e.g., Ledger) or OS-level secure storage for any Mainnet operations.
- Use multi-signature (multisig) setups for contract admin/upgrade keys rather than a single signer.
- Rotate deployment/admin keys if there's any suspicion of exposure, and prefer short-lived keys for CI/CD automation over long-lived ones.
- For frontend apps, never request or handle raw secret keys — rely on wallet-based signing (Freighter, xBull, etc.) so keys never touch application code.
- Environment variables holding sensitive keys should be scoped narrowly (per-environment) and excluded via `.gitignore`.

### Contract Upgrade Security Considerations

- Restrict upgrade authority to a multisig or governance-controlled address — never a single EOA-equivalent signer.
- Emit an event on every upgrade so upgrades are auditable on-chain.
- Consider a timelock between proposing and executing an upgrade, giving users/auditors time to react.
- Validate that new WASM hashes are reviewed and, where possible, verified against a reproducible build before upgrade execution.
- Ensure upgraded contracts preserve storage layout compatibility to avoid state corruption.
- Document and test a rollback plan in case an upgrade introduces a critical bug.

### Oracle Manipulation Attack Vectors and Mitigations

**Attack vectors:**
- **Price manipulation via low liquidity**: An attacker manipulates a thinly-traded pair to distort a price feed the contract relies on.
- **Flash-loan-assisted manipulation**: Large, short-term capital is used to skew an on-chain price within a single transaction/block.
- **Stale data reliance**: Contract logic uses outdated oracle data because it doesn't check the data's freshness/timestamp.
- **Single-source dependency**: Relying on one oracle/price feed creates a single point of failure.

**Mitigations:**
- Use decentralized, multi-source oracle aggregation rather than a single feed.
- Enforce staleness checks — reject oracle data older than a defined threshold.
- Apply circuit breakers or maximum deviation checks: reject price updates that swing beyond a sane percentage in a short window.
- Prefer time-weighted average price (TWAP) over spot price for any calculation vulnerable to short-term manipulation.
- Cross-validate critical price data against a secondary source before executing high-value operations.
