# Backend CI

`Backend CI` (`.github/workflows/backend-ci.yml`) runs the backend's type check,
lint, and unit/integration tests with coverage on every push or pull request
that changes `backend/**`. This document records what the workflow runs, how to
reproduce it from a clean checkout, and the known state of the backend suite.

## What the workflow runs

| Step | Command |
| --- | --- |
| Validate workflow configuration | `node scripts/check-backend-ci.mjs` |
| Install | `npm ci` (from `backend/`) |
| Type-check | `npx tsc --noEmit` |
| Lint | `npm run lint` |
| Unit tests with coverage | `npx vitest run --coverage --coverage.thresholds.lines=80 --coverage.thresholds.branches=80` |

## Reproducing from a clean checkout

The goal is that this sequence works on a fresh clone with no pre-existing
`node_modules`, cached artifacts, or locally-edited lockfiles:

```bash
git clone https://github.com/ritik4ever/stellar-stream.git
cd stellar-stream/backend
node --version          # must be >= 22 (see below)
npm ci                  # clean install, no --legacy-peer-deps needed
npx tsc --noEmit
npm run lint
npx vitest run --coverage --coverage.thresholds.lines=80 --coverage.thresholds.branches=80
```

`scripts/check-backend-ci.mjs` (also `npm run verify:backend-ci` from the repo
root) asserts the two properties that made the pre-#1184 workflow impossible to
run from a clean checkout: a supported `setup-node` cache and a Node version
that satisfies the backend engines.

## Root causes repaired for #1184

1. **Unsupported cache manager.** The workflow declared `cache: 'nmp'`, which
   `actions/setup-node` rejects before any step runs. Corrected to `npm`.
2. **Node 18.** The toolchain now needs Node >= 22: `vitest@5` declares
   `engines.node = "^22.12.0 || ^24.0.0 || >=26.0.0"` and `better-sqlite3@13`
   declares `>=22`. The workflow pinned `18`, so install and tests could never
   succeed. Raised to `22`.
3. **Stale lockfile.** `backend/package-lock.json` was out of sync with
   `backend/package.json` (`vite` was declared but absent from the lock root,
   and the lock resolved `vite@8.3.1`), so `npm ci` aborted with `EUSAGE`
   before installing anything. Regenerated the lockfile.
4. **TypeScript 7 vs the repo tooling.** `typescript@^7.0.2` is incompatible
   with the pinned `typescript-eslint@8.x`, which aborts `npm run lint` with
   *"typescript-eslint does not support TS 7.0"*, and TS 7 removed the
   `moduleResolution: "node"` option used by `backend/tsconfig.json`, so
   `npx tsc --noEmit` fails with `TS5108`. Aligned `typescript` to `^6.0.3`
   (the range `typescript-eslint` supports) and marked the CommonJS resolver
   deprecation with `"ignoreDeprecations": "6.0"`.

With these fixes the workflow installs and reaches every check in a clean
environment instead of failing during setup.

## Known pre-existing failures

After the workflow can run, the backend surfaces failures that are unrelated to
CI configuration and are **not** repaired by this change. Counts are from a
clean checkout on Node 22 with the regenerated lockfile:

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | 47 errors across 17 files |
| `npm run lint` | 20 errors across 8 files |
| `npx vitest run` | 15 of 47 test files fail (56 of 640 tests) |

Representative failures:

- `src/services/stats.test.ts` requires `./stats`, which does not exist.
- `src/services/streamStore.updateStartAt.test.ts` redeclares `cacheMocks` and
  duplicates an object property, which fails the transform.
- `src/services/webhook.test.ts` references a misspelled `TEST_DB_PATE`.
- `src/indexer.ts` has `rpcServer` possibly-null errors and passes `"clawback"`
  where `StreamEventType` is expected.

These are tracked separately; see the follow-ups in the pull request that
introduced this document.

## Notes

- Each test file sets its own `DB_PATH` under `backend/data/`, and
  `vitest.config.ts` runs each file in an isolated fork (`pool: "forks"`,
  `isolate: true`). Repeated local runs produced the same failing set, i.e. the
  current failures are deterministic rather than flaky.
