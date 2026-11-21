import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Request, Response } from "express";

const logMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock("../logger", () => ({ logger: logMocks }));

import { authorizeAdminApiKey } from "./adminAuth";

const KEY = "signal-admin-api-key-32-chars-min-0001";
const ROTATED = "signal-admin-api-key-32-chars-min-0002";

function mockReq(header?: string, params?: Record<string, string>): Request {
  return {
    header: vi.fn((n: string) => (n.toLowerCase() === "x-admin-key" ? header : undefined)),
    requestId: "req-sig",
    correlationId: "corr-sig",
    method: "DELETE",
    path: "/api/streams/s-42",
    params,
  } as unknown as Request;
}

function mockRes(): Response {
  const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
  (res.status as any).mockReturnValue(res);
  return res;
}

describe("admin auth outcome signals (SSB-2026-169)", () => {
  const original = process.env.ADMIN_API_KEY;
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_API_KEY = KEY;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = original;
  });

  it("logs authorized outcome at info with IDs and latency", () => {
    expect(authorizeAdminApiKey(mockReq(KEY, { id: "s-42" }), mockRes())).toBe(true);
    expect(logMocks.info).toHaveBeenCalledTimes(1);
    const fields = logMocks.info.mock.calls[0][0];
    expect(fields).toMatchObject({
      event: "admin_auth",
      outcome: "authorized",
      requestId: "req-sig",
      correlationId: "corr-sig",
      streamId: "s-42",
    });
    expect(typeof fields.latencyMs).toBe("number");
    expect(fields.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("distinguishes client rejections (warn) from misconfiguration (error)", () => {
    authorizeAdminApiKey(mockReq(undefined), mockRes());
    expect(logMocks.warn.mock.calls[0][0]).toMatchObject({
      outcome: "rejected",
      code: "ADMIN_KEY_MISSING",
    });
    authorizeAdminApiKey(mockReq("bad key"), mockRes());
    expect(logMocks.warn.mock.calls[1][0]).toMatchObject({ code: "ADMIN_KEY_MALFORMED" });

    process.env.ADMIN_API_KEY = "";
    authorizeAdminApiKey(mockReq(KEY), mockRes());
    expect(logMocks.error.mock.calls[0][0]).toMatchObject({
      code: "ADMIN_KEY_NOT_CONFIGURED",
    });
  });

  it("flags a rotated-out key as ADMIN_KEY_INVALID and never logs credentials", () => {
    process.env.ADMIN_API_KEY = ROTATED;
    expect(authorizeAdminApiKey(mockReq(KEY), mockRes())).toBe(false);
    expect(logMocks.warn.mock.calls[0][0]).toMatchObject({ code: "ADMIN_KEY_INVALID" });
    expect(authorizeAdminApiKey(mockReq(ROTATED), mockRes())).toBe(true);

    const logged = JSON.stringify([
      ...logMocks.info.mock.calls,
      ...logMocks.warn.mock.calls,
      ...logMocks.error.mock.calls,
    ]);
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain(ROTATED);
  });
});
