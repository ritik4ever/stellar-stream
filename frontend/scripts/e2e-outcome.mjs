import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const timeoutPattern = /(?:Timeout|timed out)[^\n]*\b\d+\s*ms\b/i;

function flattenTests(suites = []) {
  return suites.flatMap((suite) => [
    ...(suite.tests ?? []),
    ...flattenTests(suite.suites ?? []),
  ]);
}

export function classifyOutcome(report, readiness = 'ready', waitSeconds = 0) {
  if (readiness === 'blocked') {
    return {
      outcome: 'blocked',
      timedOutTests: 0,
      flakyTests: 0,
      waitSeconds,
      signal: 'Services did not become ready within the configured wait window.',
      ownerAction: 'Check the Compose service health and startup logs, then rerun the workflow.',
    };
  }

  const tests = flattenTests(report?.suites);
  const timedOutTests = tests.filter((test) => test.status !== 'flaky' &&
    (test.results ?? []).some((result) =>
      result.status === 'timedOut' || (result.errors ?? []).some((error) =>
        timeoutPattern.test(error.message ?? ''),
      ),
    ),
  ).length;
  const flakyTests = Number(report?.stats?.flaky ?? tests.filter((test) => test.status === 'flaky').length);
  const unexpectedTests = Number(report?.stats?.unexpected ?? tests.filter((test) => test.status === 'unexpected').length);

  if (timedOutTests > 0 || unexpectedTests > 0 || tests.length === 0) {
    return {
      outcome: 'blocked',
      timedOutTests,
      flakyTests,
      waitSeconds,
      signal: timedOutTests > 0
        ? 'One or more browser tests reached their timeout.'
        : 'One or more browser tests failed or no test results were recorded.',
      ownerAction: 'Open the Playwright HTML report and follow the Frontend Browser CI Outcome Signal runbook.',
    };
  }

  if (flakyTests > 0 || readiness === 'delayed') {
    return {
      outcome: 'transient_delay',
      timedOutTests,
      flakyTests,
      waitSeconds,
      signal: flakyTests > 0
        ? 'A browser test passed after retry.'
        : 'Services became ready after one or more readiness polls.',
      ownerAction: 'Review the readiness duration and flaky test in the Playwright report; rerun once and track repeated delays.',
    };
  }

  return {
    outcome: 'success',
    timedOutTests,
    flakyTests,
    waitSeconds,
    signal: 'Services were ready and all browser tests passed on the first attempt.',
    ownerAction: 'None.',
  };
}

export function formatOutcome(result) {
  return [
    '### Frontend Browser CI Outcome',
    '',
    `- Outcome: **${result.outcome}**`,
    `- Signal: ${result.signal}`,
    `- Timed-out tests: ${result.timedOutTests}`,
    `- Tests passing after retry: ${result.flakyTests}`,
    `- Service readiness wait: ${result.waitSeconds}s`,
    `- Owner action: ${result.ownerAction}`,
    '',
  ].join('\n');
}

async function main() {
  const readiness = process.env.E2E_READINESS ?? 'blocked';
  const waitSeconds = Number(process.env.E2E_READINESS_WAIT_SECONDS ?? 0);
  const resultsPath = process.env.PLAYWRIGHT_RESULTS ?? path.join('test-results', 'e2e-results.json');
  let report;

  if (readiness !== 'blocked') {
    try {
      report = JSON.parse(await readFile(resultsPath, 'utf8'));
    } catch {
      report = null;
    }
  }

  const result = classifyOutcome(report, readiness, waitSeconds);
  const summary = formatOutcome(result);

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `outcome=${result.outcome}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  }
  if (!process.env.GITHUB_STEP_SUMMARY) {
    process.stdout.write(summary);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
