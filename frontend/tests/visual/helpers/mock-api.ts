import type { Page, Route } from "@playwright/test";
import {
  API_PATH,
  ApiRouteKind,
  STREAM_DETAIL_PATH_PATTERN,
  STREAM_HISTORY_PATH_PATTERN,
} from "../constants";
import {
  mockConfig,
  mockEvents,
  mockMetricsHistory,
  mockOpenIssues,
  mockStats,
  mockStream,
  mockStreamsPage,
} from "../fixtures/mock-api-data";

function pathnameOf(url: string): string {
  return new URL(url).pathname.replace(/\/$/, "") || "/";
}

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

export async function mockApi(page: Page): Promise<void> {
  await page.route("**/api/**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    const pathname = pathnameOf(route.request().url());

    if (pathname === API_PATH[ApiRouteKind.Config]) {
      await json(route, mockConfig);
      return;
    }

    if (pathname === API_PATH[ApiRouteKind.StreamsList]) {
      await json(route, mockStreamsPage);
      return;
    }

    if (pathname === API_PATH[ApiRouteKind.Events]) {
      await json(route, { data: mockEvents });
      return;
    }

    if (pathname === API_PATH[ApiRouteKind.OpenIssues]) {
      await json(route, { data: mockOpenIssues });
      return;
    }

    if (pathname === API_PATH[ApiRouteKind.MetricsHistory]) {
      await json(route, { data: mockMetricsHistory });
      return;
    }

    if (pathname === API_PATH[ApiRouteKind.Stats]) {
      await json(route, { data: mockStats });
      return;
    }

    const historyMatch = pathname.match(STREAM_HISTORY_PATH_PATTERN);
    if (historyMatch) {
      await json(route, { data: mockEvents });
      return;
    }

    const detailMatch = pathname.match(STREAM_DETAIL_PATH_PATTERN);
    if (detailMatch) {
      await json(route, { data: { ...mockStream, id: detailMatch[1] } });
      return;
    }

    await json(route, { error: "Not found" }, 404);
  });
}
