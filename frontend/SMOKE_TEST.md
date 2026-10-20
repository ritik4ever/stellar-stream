# Frontend Pull Request Smoke Test

Use this checklist after changing frontend components or styles. It reproduces the existing frontend build, Lighthouse accessibility, and Playwright browser checks; these are reported by separate GitHub Actions workflows.

## 1. Build and unit checks

From `frontend/`, using Node.js 20:

```sh
npm ci
npx tsc --noEmit
npm run lint
npm test -- --run --coverage
npm run build
```

**Pass:** every command exits with status 0. This matches the checks in `Frontend CI`.

## 2. Accessibility and Lighthouse

Keep the build from step 1. In `frontend/`, install the same temporary tools used by Lighthouse CI:

```sh
npm install --no-save serve @lhci/cli@0.14.x
```

Start the built site in one terminal:

```sh
npx serve -s dist -p 4173
```

In a second terminal, from `frontend/`, run:

```sh
npx lhci autorun
```

**Pass:** Lighthouse CI completes successfully with accessibility at least 0.90, performance at least 0.80, and best practices at least 0.90. These are the checked-in `lighthouserc.json` assertions. Stop the serving process when finished.

## 3. Browser UI smoke test

From the repository root, make sure `backend/.env` has the CI values below. Preserve any other local settings already in that file:

```dotenv
PORT=3001
SOROBAN_DISABLED=true
ALLOWED_ASSETS=USDC,XLM
```

Start the Docker Compose stack and wait for both readiness checks to return successfully:

```sh
docker compose up -d --build
curl --fail http://localhost:3001/api/health
curl --fail http://localhost:3000
```

On Windows PowerShell, use `curl.exe` for these readiness checks. Wait until both return successfully before starting Playwright. Then, from `frontend/`:

```sh
npx playwright install chromium
npm run test:e2e
```

**Pass:** Playwright exits with status 0. The current suite checks homepage branding and the backend health response. Also review the changed screen at desktop (1280 x 800) and mobile (375 x 812) sizes; pass when the changed controls and text remain visible, usable, and free of overlap or horizontal overflow. Tear down the stack from the repository root when done:

```sh
docker compose down
```

## If the browser check fails

The E2E workflow waits up to 150 seconds for the backend and frontend before starting Playwright. Playwright then allows 60 seconds per test, 5 seconds per expectation, and 15 seconds per browser action. A `ERR_CONNECTION_REFUSED` at `localhost:3000` means the frontend was not accepting connections; it is a readiness/startup failure, not a failed UI assertion. Check `docker compose ps` and `docker compose logs --no-color --tail=100`, then rerun only after both readiness URLs respond.

If services are ready but a test exceeds its timeout, use the Playwright failure report to identify the slow navigation, action, or assertion. Do not increase timeouts unless the test represents an intentionally longer user interaction. The E2E workflow uploads the HTML report when tests fail.
