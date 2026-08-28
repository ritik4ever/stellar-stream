import { VisualScene, VisualTestId } from "./constants";
import { test } from "./fixtures/visual-test";
import {
  expectVisualSnapshot,
  openDashboard,
  openStreamDetail,
} from "./helpers/visual-assertions";

test.describe("Visual regression", () => {
  test("dashboard", async ({ page }) => {
    await openDashboard(page);
    await expectVisualSnapshot(
      page.getByTestId(VisualTestId.Dashboard),
      VisualScene.Dashboard,
    );
  });

  test("create form", async ({ page }) => {
    await openDashboard(page);
    await expectVisualSnapshot(
      page.getByTestId(VisualTestId.CreateForm),
      VisualScene.CreateForm,
    );
  });

  test("timeline", async ({ page }) => {
    await openDashboard(page);
    await expectVisualSnapshot(
      page.getByTestId(VisualTestId.Timeline),
      VisualScene.Timeline,
    );
  });

  test("stream detail", async ({ page }) => {
    const drawer = await openStreamDetail(page);
    await expectVisualSnapshot(drawer, VisualScene.StreamDetail);
  });
});
