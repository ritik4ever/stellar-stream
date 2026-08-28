import { test as base } from "@playwright/test";
import { installVisualHarness } from "../helpers/install-visual-harness";
import { mockApi } from "../helpers/mock-api";

export const test = base.extend({
  page: async ({ page }, use) => {
    await installVisualHarness(page);
    await mockApi(page);
    await use(page);
  },
});

export { expect } from "@playwright/test";
