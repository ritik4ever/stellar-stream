import { expect, type Locator, type Page } from "@playwright/test";
import { SCREENSHOT_OPTIONS, VisualScene, VisualTestId } from "../constants";
import { MOCK_STREAM_ID } from "../fixtures/mock-api-data";

export async function openDashboard(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "load" });
  await expect(page.getByRole("heading", { name: "StellarStream" })).toBeVisible();
  await expect(page.getByTestId(VisualTestId.Dashboard)).toBeVisible();
  await expect(page.getByText("Total Streams")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Live Streams" })).toBeVisible();
  await expect(page.getByTestId(VisualTestId.CreateForm)).toBeVisible();
  await expect(page.getByTestId(VisualTestId.Timeline)).toBeVisible();
  await expect(page.locator(".activity-item").first()).toBeVisible();
}

export async function openStreamDetail(page: Page): Promise<Locator> {
  await openDashboard(page);
  await page.getByRole("button", { name: `▼ ${MOCK_STREAM_ID}` }).click();
  const drawer = page.getByTestId(VisualTestId.StreamDetail);
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "Stream Detail" })).toBeVisible();
  await expect(drawer.getByText("Metadata")).toBeVisible();
  await expect(drawer.locator(".drawer-skeleton")).toHaveCount(0);
  return drawer;
}

export async function expectVisualSnapshot(
  target: Page | Locator,
  scene: VisualScene,
): Promise<void> {
  await expect(target).toHaveScreenshot(`${scene}.png`, SCREENSHOT_OPTIONS);
}
