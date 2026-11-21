# Frontend CI: browser test timeouts

This runbook covers how the **Playwright E2E** workflow
(`.github/workflows/playwright-e2e.yml`) handles a browser test that times out
on a pull request that changes frontend components or styles.

The unit test and build checks in **Frontend CI** (`frontend-ci.yml`) are
unchanged.

## What runs

The workflow starts the Docker Compose stack, waits until it is healthy, and
then runs [`scripts/e2e-run.sh`](../scripts/e2e-run.sh). That script wraps
`npm run test:e2e` in `frontend/`.

| Phase | Behaviour |
|-------|-----------|
| Preflight | Checks the tunables and confirms that `http://localhost:3001/api/health` and `http://localhost:3000` both respond. If either check fails, the script exits `2` without running any browser test. |
| Run | Runs Playwright under a hard wall-clock limit (`E2E_RUN_TIMEOUT`, 600s in CI), so a hung browser cannot use up the whole job. |
| Detection | Classifies a failed run as a **timeout** or a **test failure** (see below). |
| Recovery | Retries only timeouts, at most `E2E_MAX_RETRIES` times (1 in CI, never more than 2). A retry only happens after the stack passes its health check again. |
| Result | Either `RESULT: PASS` (exit `0`), or `RESULT: FAIL` (exit `1`) with a rollback step printed. |

### What counts as a timeout

A failed run is retried only if one of these happened:

- The hard limit killed the run (exit `124`/`137` from `timeout`).
- The Playwright output contains `Test timeout of Nms exceeded`,
  `Timeout Nms exceeded` (from an action, navigation or `page.goto`),
  `Global timeout of Nms exceeded` or `browserType.launch: Timeout`.

Everything else is a **test failure** and is never retried. That includes
web-first assertion timeouts (`Timed out Nms waiting for expect(...)`), which
are how a missing or changed element shows up. Retrying them would hide a real
regression in the components or styles under review.

## Safe retry boundaries

- Only timeouts are retried. At most one retry in CI, and never more than 2
  retries under any setting.
- There is no retry if the stack is unhealthy after a timeout. The run stops
  and the stack logs are dumped.
- Each attempt's HTML report is kept as `frontend/playwright-report-attempt-N`.
  All of them are uploaded as the `playwright-report` artifact, so a retry does
  not overwrite the evidence.
- A pass that needed a retry is still green, but it logs a flaky warning and a
  GitHub `::warning` annotation. Treat it as a bug to investigate, not as
  healthy.
- The job has a limit of `timeout-minutes: 45` as an outer safety net.

## Rollback

When the script ends with `RESULT: FAIL`:

1. The workflow's teardown step always runs
   `docker compose down --volumes --remove-orphans`. On a local run, run that
   command yourself.
2. Do not merge the pull request under test until the job is green.
3. Open the `playwright-report` artifact. If every attempt shows the same
   timeout, the change probably slowed down or broke that page. Fix it rather
   than raising the timeout.

## Running it locally

```bash
bash scripts/compose-up.sh          # or: docker compose up -d --build
cd frontend && npx playwright install chromium && cd ..
npm run e2e:run                     # bash scripts/e2e-run.sh
```

| Variable | Default | Meaning |
|----------|---------|---------|
| `E2E_RUN_TIMEOUT` | `600` | Hard limit per attempt, in seconds |
| `E2E_MAX_RETRIES` | `1` | Extra attempts after a timeout (maximum 2) |
| `E2E_HEALTH_TIMEOUT` | `60` | Seconds to wait for the stack at each health check |
| `POLL_INTERVAL` | `5` | Seconds between health polls |
| `BACKEND_HEALTH_URL` | `http://localhost:3001/api/health` | Backend health URL |
| `FRONTEND_URL` | `http://localhost:3000` | Frontend URL |

The script's behaviour is covered by `npm run test:e2e-run`
(`scripts/e2e-run.test.sh`). That test uses stubs, needs no browser or Docker,
and runs in CI as the **E2E Run Script** job.
