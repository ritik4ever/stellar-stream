const COMMENT_MARKER = "<!-- stellar-stream-visual-regression -->";
const APPROVE_LABEL = "approve-visual-baselines";

function collectFiles(fs, path, dir, suffix) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fs, path, fullPath, suffix));
      continue;
    }
    if (entry.name.endsWith(suffix)) {
      results.push(fullPath);
    }
  }
  return results;
}

function sceneName(filePath, path) {
  const base = path.basename(filePath).replace(/-diff\.png$|-actual\.png$|-expected\.png$/, "");
  return base;
}

function buildBody({
  failed,
  passed,
  updateMode,
  runUrl,
  artifactHint,
  diffs,
}) {
  const statusLine = failed
    ? "Visual regression **failed**. Unintended UI changes were caught against committed baselines."
    : updateMode
      ? "Visual baselines were **regenerated**. Review the updated screenshots and commit them to approve."
      : "Visual regression **passed**. All scenes match the committed baselines.";

  const diffSection =
    diffs.length > 0
      ? [
          "### Changed scenes",
          "",
          "| Scene | Files |",
          "| --- | --- |",
          ...diffs.map((name) => `| \`${name}\` | expected / actual / diff |`),
          "",
          artifactHint,
        ].join("\n")
      : artifactHint;

  const decision = failed
    ? [
        "### Approve or reject",
        "",
        "- **Reject:** keep this check failing and restore the UI to match `frontend/tests/visual/__screenshots__/`.",
        `- **Approve:** add the \`${APPROVE_LABEL}\` label (or run this workflow with *update snapshots*), then commit the regenerated PNG baselines on the PR branch.`,
        "",
        "Local approval:",
        "",
        "```bash",
        "cd frontend && npm ci && npx playwright install chromium && npm run build && npm run test:visual:update",
        "```",
      ].join("\n")
    : "";

  return [
    COMMENT_MARKER,
    "## Playwright visual regression",
    "",
    statusLine,
    "",
    `| Dashboard | Stream detail | Create form | Timeline |`,
    `| --- | --- | --- | --- |`,
    `| ${passed.includes("dashboard") && !diffs.includes("dashboard") ? "pass" : "see artifacts"} | ${passed.includes("stream-detail") && !diffs.includes("stream-detail") ? "pass" : "see artifacts"} | ${passed.includes("create-form") && !diffs.includes("create-form") ? "pass" : "see artifacts"} | ${passed.includes("timeline") && !diffs.includes("timeline") ? "pass" : "see artifacts"} |`,
    "",
    diffSection,
    "",
    decision,
    "",
    `[Workflow run](${runUrl})`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

module.exports = async function postVisualDiffComment({ github, context, core }) {
  const fs = require("fs");
  const path = require("path");

  if (!context.payload.pull_request) {
    core.info("Skipping visual comment: not a pull_request event.");
    return;
  }

  const frontendRoot = path.join(process.env.GITHUB_WORKSPACE || process.cwd(), "frontend");
  const testResultsDir = path.join(frontendRoot, "test-results");
  const screenshotDir = path.join(frontendRoot, "tests/visual/__screenshots__");

  const diffFiles = collectFiles(fs, path, testResultsDir, "-diff.png");
  const diffs = [...new Set(diffFiles.map((file) => sceneName(file, path)))];
  const passed = collectFiles(fs, path, screenshotDir, ".png").map((file) =>
    path.basename(file, ".png"),
  );

  const failed = process.env.VISUAL_JOB_CONCLUSION === "failure" || diffs.length > 0;
  const updateMode = process.env.VISUAL_UPDATE_SNAPSHOTS === "true";
  const runUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`;
  const artifactHint = failed || updateMode
    ? "Download the **visual-regression-report** and **visual-snapshot-diffs** artifacts on the workflow run to inspect expected / actual / diff images."
    : "No visual diffs were produced.";

  const body = buildBody({
    failed,
    passed,
    updateMode,
    runUrl,
    artifactHint,
    diffs,
  });

  const { owner, repo } = context.repo;
  const issue_number = context.payload.pull_request.number;
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number,
  });
  const existing = comments.find((comment) => comment.body?.includes(COMMENT_MARKER));

  if (existing) {
    await github.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    });
    return;
  }

  await github.rest.issues.createComment({
    owner,
    repo,
    issue_number,
    body,
  });
};
