#!/usr/bin/env node
/**
 * Wraps a Node process with `clinic doctor`, drives load against it with
 * autocannon, and fails if resident memory (RSS) grows past the configured
 * threshold over the sampling window. `clinic doctor` produces an HTML
 * report with a memory usage graph as a side effect, uploaded as a CI
 * artifact regardless of pass/fail.
 *
 * Usage:
 *   node scripts/memory-leak-check.js \
 *     --target=dist/index.js --port=3001 --duration=300 \
 *     --max-growth-mb=50 --report-dir=.clinic/baseline [--expect-failure]
 */
const { spawn, execSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");

function arg(name, fallback) {
  const match = process.argv.find((a) => a.startsWith(`--${name}=`));
  return match ? match.split("=").slice(1).join("=") : fallback;
}

const TARGET = arg("target");
const PORT = Number(arg("port", "3001"));
const DURATION_SECONDS = Number(arg("duration", "300"));
const MAX_GROWTH_MB = Number(arg("max-growth-mb", "50"));
const REPORT_DIR = arg("report-dir", ".clinic/report");
const EXPECT_FAILURE = process.argv.includes("--expect-failure");
const SAMPLE_INTERVAL_MS = 2000;
const READY_TIMEOUT_MS = 15000;

if (!TARGET) {
  console.error("Missing required --target=<path to entry file>");
  process.exit(2);
}

function readRssBytes(pid) {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
    const line = status.split("\n").find((l) => l.startsWith("VmRSS:"));
    if (!line) return null;
    const kb = Number(line.replace("VmRSS:", "").trim().split(/\s+/)[0]);
    return kb * 1024;
  } catch {
    return null;
  }
}

function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get({ host: "localhost", port, path: "/", timeout: 1000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) {
          reject(new Error(`Server on port ${port} did not become ready in time.`));
        } else {
          setTimeout(attempt, 500);
        }
      });
    };
    attempt();
  });
}

async function main() {
  fs.mkdirSync(path.dirname(REPORT_DIR + "/x"), { recursive: true });

  const clinic = spawn(
    "npx",
    ["clinic", "doctor", "--dest", REPORT_DIR, "--", "node", TARGET],
    { env: { ...process.env, PORT: String(PORT) }, stdio: "inherit" },
  );

  await waitForPort(PORT, READY_TIMEOUT_MS);

  // clinic doctor re-execs node, so resolve the real server PID by port
  // rather than the wrapper CLI's own PID.
  const pid = Number(
    execSync(`lsof -t -i:${PORT} -sTCP:LISTEN`).toString().trim().split("\n")[0],
  );

  const samples = [];
  const sampleTimer = setInterval(() => {
    const rss = readRssBytes(pid);
    if (rss != null) samples.push({ t: Date.now(), rssBytes: rss });
  }, SAMPLE_INTERVAL_MS);

  console.log(`Running autocannon load against port ${PORT} for ${DURATION_SECONDS}s...`);
  execSync(
    `npx autocannon -d ${DURATION_SECONDS} -c 20 http://localhost:${PORT}/api/health`,
    { stdio: "inherit" },
  );

  clearInterval(sampleTimer);
  clinic.kill("SIGINT");
  await new Promise((resolve) => clinic.on("exit", resolve));

  if (samples.length < 4) {
    console.error("Not enough memory samples collected to evaluate growth.");
    process.exit(2);
  }

  const window = Math.max(1, Math.floor(samples.length * 0.1));
  const baseline = samples.slice(0, window).reduce((s, x) => s + x.rssBytes, 0) / window;
  const final = samples.slice(-window).reduce((s, x) => s + x.rssBytes, 0) / window;
  const growthMb = (final - baseline) / (1024 * 1024);

  console.log(`Baseline RSS: ${(baseline / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Final RSS:    ${(final / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Growth:       ${growthMb.toFixed(1)} MB (threshold: ${MAX_GROWTH_MB} MB)`);

  const leakDetected = growthMb > MAX_GROWTH_MB;

  if (EXPECT_FAILURE) {
    if (!leakDetected) {
      console.error("Expected the injected leak to be detected, but it wasn't.");
      process.exit(1);
    }
    console.log("Injected leak correctly detected. ✔");
    process.exit(0);
  }

  if (leakDetected) {
    console.error("RSS growth exceeded threshold — possible memory leak.");
    process.exit(1);
  }

  console.log("Memory growth within threshold. ✔");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});