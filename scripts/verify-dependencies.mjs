import { appendFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;

if (!npmCli) {
  console.error('Run this check with npm run verify:dependencies.');
  process.exit(1);
}

const results = [];

function record(area, check, status, detail = '') {
  results.push({ area, check, status, detail });
  console.log(`${status}: ${area} ${check}${detail ? ` — ${detail}` : ''}`);
}

function isTransientMessage(message = '') {
  return /(?:ECONNRESET|ECONNREFUSED|ENETUNREACH|EAI_AGAIN|ETIMEDOUT|network|registry|timeout|5\d\d|audit service)/i.test(message);
}

function failureStatus(message = '') {
  return isTransientMessage(message) ? 'TRANSIENT' : 'FAIL';
}

function safeDetail(message = '') {
  return message
    .replace(/https?:\/\/[^\s]+/gi, '[url redacted]')
    .replace(/(?:token|password|authorization|npm_[^=\s]*)[=:][^\s]+/gi, '[secret redacted]')
    .slice(0, 240);
}

function readJson(path) {
  const contents = readFileSync(path, 'utf8');
  if (!contents.trim()) throw new Error(`${path} is empty`);
  return JSON.parse(contents);
}

function checkLock(area, directory) {
  try {
    const manifest = readJson(join(directory, 'package.json'));
    const lock = readJson(join(directory, 'package-lock.json'));
    if (lock.lockfileVersion !== 3 || !lock.packages?.['']) {
      throw new Error('expected an npm v3 lockfile with a root package entry');
    }

    const lockedRoot = lock.packages[''];
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      const declared = manifest[section] ?? {};
      const locked = lockedRoot[section] ?? {};
      for (const name of new Set([...Object.keys(declared), ...Object.keys(locked)])) {
        if (declared[name] !== locked[name]) {
          throw new Error(`${section}.${name} differs between package.json and package-lock.json`);
        }
      }
    }
    record(area, 'manifest/lockfile', 'PASS');
    return true;
  } catch (error) {
    record(area, 'manifest/lockfile', 'BLOCKED', safeDetail(error.message));
    return false;
  }
}

function runNpm(area, directory, check, args) {
  console.log(`\n${area}: npm ${args.join(' ')}`);
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd: directory,
    env: { ...process.env, CI: 'true' },
    stdio: 'inherit',
  });
  const passed = result.status === 0;
  const detail = passed ? '' : safeDetail(result.error?.message ?? `exit ${result.status}`);
  record(area, check, passed ? 'PASS' : failureStatus(detail), detail);
  return passed;
}

function audit(area, directory) {
  console.log(`\n${area}: npm audit --package-lock-only --audit-level=high --json`);
  const result = spawnSync(process.execPath, [npmCli, 'audit', '--package-lock-only', '--audit-level=high', '--json'], {
    cwd: directory,
    env: { ...process.env, CI: 'true' },
    encoding: 'utf8',
  });
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    const detail = result.error?.message ?? (result.stderr.trim() || `exit ${result.status}: no audit JSON`);
    record(area, 'high/critical audit', failureStatus(detail), safeDetail(detail));
    return;
  }

  const high = report.metadata?.vulnerabilities?.high;
  const critical = report.metadata?.vulnerabilities?.critical;
  if (report.error) {
    const detail = report.error.summary || report.error.message || 'audit service returned an error';
    record(area, 'high/critical audit', failureStatus(detail), safeDetail(detail));
  } else if (typeof high !== 'number' || typeof critical !== 'number') {
    const detail = report.error?.summary || report.error?.message || result.stderr.trim() || 'audit returned no vulnerability totals';
    record(area, 'high/critical audit', failureStatus(detail), safeDetail(detail));
  } else if (high + critical > 0) {
    record(area, 'high/critical audit', 'FAIL', `${high} high, ${critical} critical (run npm audit in ${area} for details)`);
  } else if (result.status === 0) {
    record(area, 'high/critical audit', 'PASS', '0 high, 0 critical');
  } else {
    record(area, 'high/critical audit', failureStatus(`audit exited ${result.status}`), `audit exited ${result.status} despite zero high/critical findings`);
  }
}

console.log('Dependency update verification (npm ci, CI checks, and high/critical audit)');

for (const area of ['backend', 'frontend']) {
  const directory = join(root, area);
  if (!checkLock(area, directory)) {
    record(area, 'install/CI checks', 'BLOCKED', 'fix manifest or lockfile first');
    try {
      readJson(join(directory, 'package.json'));
      const lock = readJson(join(directory, 'package-lock.json'));
      if (!lock.packages?.['']) throw new Error('lockfile has no root package entry');
      console.log(`${area}: auditing the existing lockfile despite manifest drift`);
      audit(area, directory);
    } catch {
      record(area, 'high/critical audit', 'SKIP', 'manifest or lockfile cannot be audited');
    }
    continue;
  }

  const installed = runNpm(area, directory, 'clean install', ['ci', '--no-audit', '--no-fund']);
  if (installed) {
    runNpm(area, directory, 'typecheck', ['exec', '--', 'tsc', '--noEmit']);
    runNpm(area, directory, 'lint', ['run', 'lint']);
    if (area === 'backend') {
      runNpm(area, directory, 'tests with CI coverage thresholds', ['exec', '--', 'vitest', 'run', '--coverage', '--coverage.thresholds.lines=80', '--coverage.thresholds.branches=80']);
    } else {
      runNpm(area, directory, 'tests with coverage', ['test', '--', '--run', '--coverage']);
    }
    runNpm(area, directory, 'build', ['run', 'build']);
  } else {
    record(area, 'CI checks', 'BLOCKED', 'clean install failed; see the install result above');
  }
  audit(area, directory);
}

const failedResults = results.filter((result) => !['PASS', 'SKIP'].includes(result.status));
const outcome = failedResults.length === 0 ? 'PASS' : failedResults.some((result) => result.status === 'TRANSIENT') ? 'TRANSIENT' : failedResults.some((result) => result.status === 'BLOCKED') ? 'BLOCKED' : 'FAIL';
console.log(`\nDependency verification: ${outcome} (${failedResults.length} non-passing check${failedResults.length === 1 ? '' : 's'})`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = results.map(({ area, check, status, detail }) => `| ${area} | ${check} | ${status} | ${detail || ''} |`).join('\n');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Dependency update verification: ${outcome}\n\n| Area | Check | Outcome | Detail |\n| --- | --- | --- | --- |\n${rows}\n`);
}

process.exitCode = outcome === 'PASS' ? 0 : 1;
