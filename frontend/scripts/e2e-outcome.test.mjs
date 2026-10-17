import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyOutcome, formatOutcome } from './e2e-outcome.mjs';

const passingReport = {
  stats: { expected: 1, unexpected: 0, flaky: 0 },
  suites: [{ tests: [{ status: 'expected', results: [{ status: 'passed' }] }] }],
};

test('classifies first-attempt browser success', () => {
  const result = classifyOutcome(passingReport, 'ready', 0);
  assert.equal(result.outcome, 'success');
  assert.match(formatOutcome(result), /Owner action: None\./);
});

test('classifies recovered browser retries and delayed readiness as transient', () => {
  const flakyReport = {
    ...passingReport,
    stats: { expected: 0, unexpected: 0, flaky: 1 },
    suites: [{ tests: [{ status: 'flaky', results: [{ status: 'timedOut' }, { status: 'passed' }] }] }],
  };
  assert.equal(classifyOutcome(flakyReport, 'ready', 0).outcome, 'transient_delay');
  assert.equal(classifyOutcome(passingReport, 'delayed', 10).outcome, 'transient_delay');
});

test('classifies persistent timeout as blocked without exposing error content', () => {
  const report = {
    stats: { expected: 0, unexpected: 1, flaky: 0 },
    suites: [{ tests: [{
      status: 'unexpected',
      results: [{ status: 'timedOut', errors: [{ message: 'Timeout 60000ms exceeded SECRET_SENTINEL' }] }],
    }] }],
  };
  const result = classifyOutcome(report, 'ready', 0);
  const summary = formatOutcome(result);
  assert.equal(result.outcome, 'blocked');
  assert.equal(result.timedOutTests, 1);
  assert.doesNotMatch(summary, /SECRET_SENTINEL/);
});

test('classifies exhausted service readiness as blocked without browser output', () => {
  const result = classifyOutcome(null, 'blocked', 150);
  assert.equal(result.outcome, 'blocked');
  assert.match(result.ownerAction, /Compose service health/);
});

test('classifies missing browser results as blocked', () => {
  assert.equal(classifyOutcome(null, 'ready', 0).outcome, 'blocked');
});
