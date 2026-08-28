import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE_URL = process.env.A11Y_BASE_URL ?? "http://localhost:4173";
const OUTPUT_DIR = "a11y-report";

// "Main pages" for the audit — updated to include all react-router-dom routes
const PAGES = [
  { name: "dashboard", path: "/" },
  { name: "sender", path: "/sender" },
  { name: "recipient", path: "/recipient" }
];

const FAILING_IMPACTS = new Set(["critical", "serious"]);

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const allResults = [];

  try {
    for (const page of PAGES) {
      const context = await browser.newContext();
      const tab = await context.newPage();

      await tab.goto(`${BASE_URL}${page.path}`, { waitUntil: "networkidle" });

      // wcag2aa / wcag21aa tags include the color-contrast rule.
      const results = await new AxeBuilder({ page: tab })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();

      for (const violation of results.violations) {
        const failing = FAILING_IMPACTS.has(violation.impact ?? "");

        for (const node of violation.nodes) {
          allResults.push({
            page: page.path,
            violationId: violation.id,
            description: violation.description,
            impact: violation.impact,
            help: violation.helpUrl,
            element: node.target.join(", "),
            failing,
          });
        }
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }

  writeFileSync(`${OUTPUT_DIR}/axe-report.json`, JSON.stringify(allResults, null, 2));

  const critical = allResults.filter((r) => r.failing);

  console.log(
    `Axe scan complete: ${allResults.length} violation instance(s), ${critical.length} critical/serious.`,
  );

  if (critical.length > 0) {
    console.error("Critical or serious accessibility violations detected:");
    for (const v of critical) {
      console.error(`  [${v.impact}] ${v.violationId} on ${v.page} — element: ${v.element}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});