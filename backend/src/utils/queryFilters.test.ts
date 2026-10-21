import { describe, it, expect, vi, afterEach } from "vitest";
import { logger } from "../logger";
import { reportUnsupportedQueryFilters } from "./queryFilters";

const allowed = new Set(["q", "asset"]);

const fakeReq = (query: Record<string, unknown>) =>
  ({ query }) as unknown as Parameters<typeof reportUnsupportedQueryFilters>[0];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reportUnsupportedQueryFilters", () => {
  it("returns [] and does not warn when every key is allowed", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const result = reportUnsupportedQueryFilters(
      fakeReq({ q: "alice", asset: "USDC" }),
      "/api/streams/search",
      allowed,
    );
    expect(result).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warns with the structured signal when an unknown key is present", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const result = reportUnsupportedQueryFilters(
      fakeReq({ q: "alice", asset: "USDC", bogusFilter: "x" }),
      "/api/streams/search",
      allowed,
    );
    expect(result).toEqual(["bogusFilter"]);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    const payload = warnSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.event).toBe("stream_search_unsupported_filter");
    expect(payload.endpoint).toBe("/api/streams/search");
    expect(payload.unsupportedFilters).toEqual(["bogusFilter"]);
    expect(payload.outcome).toBe("ignored");
  });

  it("never logs the value of an unsupported key", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const secretishValue = "SDFSDFSDFSDFSDFSDFSDFSDFSDFSDFSDFSDFSDFSDFSDFSDFSDFSDFSDF";
    reportUnsupportedQueryFilters(
      fakeReq({ secretFilter: secretishValue }),
      "/api/streams",
      allowed,
    );
    const serialized = JSON.stringify(warnSpy.mock.calls[0][0]);
    expect(serialized).not.toContain(secretishValue);
    // key name is fine to log
    expect(serialized).toContain("secretFilter");
  });

  it("reports multiple unsupported keys together", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const result = reportUnsupportedQueryFilters(
      fakeReq({ a: "1", b: "2", q: "x" }),
      "/api/streams",
      allowed,
    );
    expect(result.sort()).toEqual(["a", "b"]);
    const payload = warnSpy.mock.calls[0][0] as Record<string, unknown>;
    expect((payload.unsupportedFilters as string[]).sort()).toEqual(["a", "b"]);
  });
});
