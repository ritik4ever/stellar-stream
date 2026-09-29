# Contributing to StellarStream

Thank you for your interest in contributing to StellarStream! This guide will help you get started with our development process.

Check out the [FAQ.md](FAQ.md) for common contributor questions and troubleshooting tips.

---

## Local Setup Checklist

Follow these steps to go from zero to a running local environment with passing tests.

### Prerequisites

- [ ] **Node.js 18+** and **npm 9+**
- [ ] **Git**
- [ ] **Rust toolchain** (only needed for contract work) — install via [rustup.rs](https://rustup.rs)

### Step-by-Step

1. **Fork the repository** — Click the **Fork** button at the top of the [StellarStream repo](https://github.com/ritik4ever/stellar-stream) on GitHub.

2. **Clone your fork**
   ```bash
   git clone https://github.com/YOUR_USERNAME/stellar-stream.git
   cd stellar-stream
   ```

3. **Install all dependencies** (backend + frontend)
   ```bash
   npm run install:all
   ```

4. **Set up environment variables**
   ```bash
   cp backend/.env.example backend/.env
   ```
   Edit `backend/.env` and fill in required values. For local-only development (no deployed contract), set:
   ```
   SOROBAN_DISABLED=true
   ```

5. **Start the development servers**
   ```bash
   # Start both backend and frontend
   npm run dev

   # Or start individually:
   npm run dev:backend   # API on http://localhost:3001
   npm run dev:frontend  # UI on http://localhost:3000
   ```

6. **Run backend tests**
   ```bash
   cd backend && npm test
   ```

7. **Run frontend tests**
   ```bash
   cd frontend && npm test
   ```

8. **Run contract tests** (requires Rust toolchain)
   ```bash
   cd contracts && cargo test
   ```

9. **Run all contract tests including snapshot updates**
   ```bash
   cd contracts && cargo insta review
   ```

---

## Soroban Local Testnet Setup

If you need to work with on-chain stream operations, set up a local Soroban testnet environment.

### Prerequisites

- **Rust toolchain** with `wasm32-unknown-unknown` target:
  ```bash
  rustup target add wasm32-unknown-unknown
  ```
- **soroban-cli** (Stellar CLI):
  ```bash
  cargo install soroban-cli
  ```
- **Stellar testnet account** funded with testnet XLM

### Step-by-Step

1. **Fund a testnet account** using Friendbot:
   ```bash
   curl "https://friendbot.stellar.org/?addr=YOUR_PUBLIC_KEY"
   ```
   Replace `YOUR_PUBLIC_KEY` with your testnet account's public key (G...).

2. **Deploy the contract** to testnet:
   ```bash
   SECRET_KEY="S..." npm run deploy:contract
   ```
   This builds the contract with `wasm-opt -O4` optimization and deploys it to Stellar testnet. The contract ID is saved to `contracts/contract_id.txt` (git-ignored — copy it from the script output; never commit the file).

3. **Copy the contract ID** to your backend `.env`:
   ```
   CONTRACT_ID=<paste-contract-id-here>
   ```

4. **Set your server private key** in `.env`:
   ```
   SERVER_PRIVATE_KEY=S...
   ```

5. **Generate TypeScript bindings** for the frontend:
   ```bash
   CONTRACT_ID=$(cat contracts/contract_id.txt) npm run gen:bindings
   ```

6. **Verify everything works** — restart the backend and run the full test suite:
   ```bash
   cd backend && npm test
   ```

### Soroban Disabled Mode

For frontend or API-only development without a contract, set `SOROBAN_DISABLED=true` in your backend `.env`. Never use this mode in production.

---

## Common Setup Errors and Fixes

### 1. Port already in use

**Error:** `EADDRINUSE: address already in use :::3001`

**Fix:** Stop the process using the port, or configure a different port via the `PORT` env var:
```bash
# Find and kill the process
netstat -ano | findstr :3001
taskkill /PID <PID> /F

# Or use a different port
#   macOS / Linux:
PORT=3002 npm run dev:backend
#   Windows (PowerShell):
$env:PORT=3002; npm run dev:backend
```

### 2. Missing or invalid `.env` file

**Error:** `FATAL: Missing required environment variable: XXX`

**Fix:** Copy the example env file and fill in the values:
```bash
cp backend/.env.example backend/.env
```
Set `SOROBAN_DISABLED=true` if you're not deploying the contract locally.

### 3. Friendbot not funding the account

**Error:** `tx_bad_seq` or `Account not found` when deploying

**Fix:** Ensure the account has been funded before deploying. Verify using Horizon:
```bash
curl "https://horizon-testnet.stellar.org/accounts/YOUR_PUBLIC_KEY"
```
The response should show a `balances` array with a positive XLM balance. If the account exists but isn't funded, use Friendbot again.

### 4. Indexer circuit breaker open

**Error:** `[Circuit Breaker] State Transition: OPEN`

**Fix:** The circuit breaker prevents flooding a failing Stellar RPC node. Wait 60 seconds for automatic recovery. If it persists:
- Check your internet connection to Stellar testnet
- Verify `STELLAR_RPC_URL` in your `.env`
- Set `SOROBAN_DISABLED=true` for local-only development

### 5. Cargo build fails — missing `wasm32-unknown-unknown` target

**Error:** `error[E0463]: can't find crate for core`

**Fix:** Add the WebAssembly target and rebuild:
```bash
rustup target add wasm32-unknown-unknown
cargo build -p stellar-stream-contract --release
```

---

## PR Checklist

### Dependency update verification

After changing the Stellar SDK, frontend dependencies, or an npm lockfile, run this from the repository root:

```bash
npm run verify:dependencies
```

The command checks the backend and frontend manifest/lockfile pairs. For each valid pair it runs `npm ci`, the CI typecheck, lint and test commands (including coverage), the build, and `npm audit --package-lock-only --audit-level=high`. It prints `PASS`, `FAIL`, or `SKIP` for each check and exits with code 1 if any check fails. `npm ci` removes the corresponding `node_modules`, so save any local changes there first. An npm registry connection is needed for a fresh install and the audit.

Treat a failed clean install, typecheck, lint, test, build, or high/critical audit as a failed verification report. An audit service error is also a failure, but it is not evidence of a vulnerability. If the manifest and lockfile disagree, the command still audits the existing lockfile; those findings describe locked packages and may differ from the intended manifest.

#### Recovering a failed dependency update

Start an update on a clean branch and record its starting commit with `git rev-parse HEAD`. Run `npm run verify:dependencies` **before** editing dependencies. Record baseline failures. Continue only if this update is meant to repair one of them; otherwise stop and report them. The verifier checks both backend and frontend, so an unrelated failure in either area still makes the full report fail.

For an attempted update, use the following sequence for only the affected `backend/` or `frontend/` package pair:

1. **Detect.** Run `npm run verify:dependencies` and read each `FAIL` or `SKIP`. A manifest/lockfile mismatch or `npm ci` `EUSAGE` is drift. For an audit failure, run `npm audit` in the affected directory and `npm explain <package>` to identify the vulnerable dependency and its parent. A registry timeout or audit service error is an unknown result, not a clean audit.
2. **Repair one cause.** For drift, decide whether the intended change is in `package.json` or the lockfile, then run `npm install --package-lock-only --ignore-scripts` in that directory and review `git diff` for its two dependency files. For a confirmed advisory with a compatible fix, use `npm audit fix --package-lock-only --ignore-scripts`, inspect the diff, and add focused compatibility tests if an SDK or API changes. If the only fix requires a major upgrade, a new Node runtime, or `--force`, stop and plan that compatibility change separately; do not apply it as an automatic retry.
3. **Verify.** Run `npm ci` in the affected directory, then `npm run verify:dependencies` from the repository root. Accept the update only when the verifier exits zero, the relevant SDK/frontend tests pass, and the manifest and lockfile are committed together. Do not treat an audit of a stale lockfile, a skipped check, or a passing install alone as a healthy result.
4. **Stop or roll back.** Do not rerun a deterministic drift, advisory, test, or build failure without changing its cause. For `ECONNRESET`, registry 5xx, or an audit service outage, retry the *same command* at most once after the service recovers, with no dependency-file edits between attempts. If it fails again, stop. For an uncommitted attempt that changed only the dependency pair, restore just those files with `git restore --source=<starting-commit> -- <area>/package.json <area>/package-lock.json`. If the attempt also changed tests or code, review `git diff` and restore only its files; do not discard another contributor's edits. For a committed attempt, use `git revert <update-commit>`. Never use `git reset --hard` or `npm audit fix --force` as a recovery shortcut. Run `npm ci` again after rollback and report any baseline failures that remain.

Before submitting a pull request, ensure your changes meet the following criteria:

### Code Quality

- [ ] Code follows existing patterns and conventions in the repository
- [ ] No debug logs, `console.log`, or `TODO` comments left in production code
- [ ] Error handling follows the `sendApiError` pattern (consistent error responses)
- [ ] New environment variables are documented in `.env.example` (if applicable)
- [ ] Database migrations use the `addColumnIfMissing` pattern in `db.ts` (if applicable)

### Testing

- [ ] Backend tests pass: `cd backend && npm test`
- [ ] Frontend tests pass: `cd frontend && npm test`
- [ ] Contract tests pass (if applicable): `cd contracts && cargo test`
- [ ] New features include test coverage
- [ ] Snapshot tests updated (if contract events changed): `cargo insta review`
- [ ] Manual testing done in a local environment

### Documentation

- [ ] Public API changes are reflected in the OpenAPI/Swagger spec
- [ ] `FAQ.md` updated if adding new common questions or errors
- [ ] `README.md` updated if changing setup instructions or architecture

### CI & Linting

- [ ] Linting passes: `npx eslint .` (backend) and `cd frontend && npm run lint`
- [ ] CI workflows pass (triggered automatically on push)
- [ ] No new secrets or credentials committed (checked by gitleaks)

### PR Metadata

- [ ] PR title follows conventional commit format: `type(scope): description`
- [ ] PR description explains the motivation and approach
- [ ] Related issue(s) referenced in the description using `Fixes: #<issue>` or `Closes: #<issue>`
- [ ] Changes scoped to a single logical feature or fix (avoid unrelated changes)
