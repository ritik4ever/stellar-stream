#!/usr/bin/env node
// Fails CI if the ZAP JSON report contains any High-severity (riskcode "3") alerts.
const fs = require("node:fs");

const reportPath = process.argv[2];
if (!reportPath || !fs.existsSync(reportPath)) {
  console.error(`ZAP report not found at ${reportPath}`);
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const sites = report.site ?? [];

const highSeverity = [];
for (const site of sites) {
  for (const alert of site.alerts ?? []) {
    if (String(alert.riskcode) === "3") {
      highSeverity.push({
        name: alert.name,
        risk: alert.riskdesc,
        instances: (alert.instances ?? []).length,
      });
    }
  }
}

if (highSeverity.length > 0) {
  console.error(`Found ${highSeverity.length} high-severity ZAP finding(s):`);
  for (const finding of highSeverity) {
    console.error(`  - [${finding.risk}] ${finding.name} (${finding.instances} instance(s))`);
  }
  process.exit(1);
}

console.log("No high-severity ZAP findings. ✔");