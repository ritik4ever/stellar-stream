import { test, expect, type Page } from "@playwright/test";

/**
 * Fixed test recipient. Does not need to exist on Horizon — the create form
 * only validates the Stellar address shape client-side (see
 * `useFormValidation.ts::isStellarAccount`), and the backend does not
 * require the recipient to be a funded/known account to create a stream.
 */
const TEST_RECIPIENT = "GCOXJIUS7PEV6UYEDD27JSF6MQEXV3BO2UEKBM4QNCNUHAWHLUYLK4QN";

/** Connects the (mocked) Freighter wallet via the app's real SEP-10 flow. */
async function connectWallet(page: Page): Promise<void> {
  await page.getByRole("button", { name: /connect wallet/i }).click();
  await expect(
    page.getByRole("button", { name: /disconnect/i }),
  ).toBeVisible({ timeout: 15_000 });
}

/**
 * Fills and submits the create-stream form, confirms the fee-preview modal,
 * and returns the newly created stream's ID (captured directly from the
 * POST /api/streams response rather than guessed from the DOM).
 */
async function createStream(
  page: Page,
  opts: { sender: string; totalAmount?: string; durationMinutes?: string },
): Promise<string> {
  await page.locator("#stream-sender").fill(opts.sender);
  await page.locator("#stream-recipient").fill(TEST_RECIPIENT);
  await page.locator("#stream-amount").fill(opts.totalAmount ?? "100");
  await page.locator("#stream-duration").fill(opts.durationMinutes ?? "1440");
  await page.locator("#stream-start").fill("0");

  await page.getByRole("button", { name: "Create Stream" }).click();

  const confirmDialog = page.getByRole("dialog", {
    name: "Confirm stream creation",
  });
  await expect(confirmDialog).toBeVisible();

  const [createResponse] = await Promise.all([
    page.waitForResponse(
      (res) =>
        res.url().endsWith("/api/streams") &&
        res.request().method() === "POST" &&
        res.ok(),
    ),
    confirmDialog.getByRole("button", { name: "Confirm" }).click(),
  ]);

  const body = await createResponse.json();
  const streamId: string = body.data.id;
  expect(streamId).toBeTruthy();
  return streamId;
}

/** Locates the streams-table row whose ID-toggle button matches streamId. */
function tableRow(page: Page, streamId: string) {
  const toggleButton = page.getByRole("button", {
    name: new RegExp(`${streamId}$`),
  });
  return page.locator("tr", { has: toggleButton });
}

/** Opens the stream detail drawer for a given stream ID via the table row. */
async function openDetailDrawer(page: Page, streamId: string) {
  await tableRow(page, streamId)
    .getByRole("button", { name: new RegExp(`${streamId}$`) })
    .click();
  const drawer = page.getByRole("dialog", {
    name: `Stream detail: ${streamId}`,
  });
  await expect(drawer).toBeVisible();
  return drawer;
}

test.describe("Stream create/cancel and pause/resume lifecycle", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toHaveText("StellarStream");
  });

  test("create stream -> verify in list -> cancel -> verify canceled", async ({
    page,
  }) => {
    await connectWallet(page);

    // Sender must be a G... address. Freighter's own connected address
    // (shown truncated in the header) is the wallet address the app uses
    // for the sender-only action gate, so we read it from local state via
    // the wallet button's title attribute rather than re-deriving it.
    const walletAddress = await page
      .getByRole("button", { name: /disconnect/i })
      .locator("xpath=preceding-sibling::span[1]")
      .getAttribute("title");
    expect(walletAddress).toBeTruthy();

    const streamId = await createStream(page, { sender: walletAddress! });

    // Verify in list.
    await expect(tableRow(page, streamId)).toBeVisible();
    await expect(tableRow(page, streamId).locator(".badge-active")).toBeVisible();

    // Cancel via the detail drawer.
    const drawer = await openDetailDrawer(page, streamId);
    await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().endsWith(`/api/streams/${streamId}/cancel`) && res.ok(),
      ),
      drawer.getByRole("button", { name: /cancel stream/i }).click(),
    ]);

    // Verify canceled — both in the drawer and back in the table.
    await expect(drawer.locator(".badge-canceled")).toBeVisible();
    await expect(tableRow(page, streamId).locator(".badge-canceled")).toBeVisible();
  });

  test("pause -> resume -> verify resumed", async ({ page }) => {
    await connectWallet(page);

    const walletAddress = await page
      .getByRole("button", { name: /disconnect/i })
      .locator("xpath=preceding-sibling::span[1]")
      .getAttribute("title");
    expect(walletAddress).toBeTruthy();

    // Long duration so the stream is still "active" for the whole test.
    const streamId = await createStream(page, {
      sender: walletAddress!,
      durationMinutes: "10080", // 7 days
    });

    const drawer = await openDetailDrawer(page, streamId);
    await expect(drawer.locator(".badge-active")).toBeVisible();

    // Pause.
    await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().endsWith(`/api/streams/${streamId}/pause`) && res.ok(),
      ),
      drawer.getByRole("button", { name: /pause/i }).click(),
    ]);
    await expect(drawer.locator(".badge-paused")).toBeVisible();
    await expect(tableRow(page, streamId).locator(".badge-paused")).toBeVisible();

    // Resume.
    await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().endsWith(`/api/streams/${streamId}/resume`) && res.ok(),
      ),
      drawer.getByRole("button", { name: /resume/i }).click(),
    ]);

    // Verify resumed.
    await expect(drawer.locator(".badge-active")).toBeVisible();
    await expect(tableRow(page, streamId).locator(".badge-active")).toBeVisible();
  });
});
