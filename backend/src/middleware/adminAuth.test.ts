import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Request, Response, NextFunction } from "express";
import { ADMIN_CALLER, adminAuth, authorizeAdminApiKey } from "./adminAuth";

function mockReq(
  headerValue?: string | string[],
  options?: {
    body?: unknown;
    rawHeaders?: string[];
    preExistingUser?: unknown;
  },
): Partial<Request> & { user?: unknown } {
  const req: Record<string, unknown> = {
    header: vi.fn((name: string) =>
      name.toLowerCase() === "x-admin-key" ? headerValue : undefined,
    ),
    requestId: "req-test",
    correlationId: "corr-test",
  };
  if (options?.body !== undefined) {
    req.body = options.body;
  }
  if (options?.rawHeaders !== undefined) {
    req.rawHeaders = options.rawHeaders;
  }
  if (options?.preExistingUser !== undefined) {
    req.user = options.preExistingUser;
  }
  return req as unknown as Partial<Request> & { user?: unknown };
}

function mockRes(): { res: Partial<Response>; status: any; json: any } {
  const status = vi.fn();
  const json = vi.fn();
  const res = { status, json } as unknown as Partial<Response>;
  (status as any).mockReturnValue(res);
  return { res, status, json };
}

describe("adminAuth middleware (#1109 / SSB-2026-170)", () => {
  const original = process.env.ADMIN_API_KEY;
  const VALID_KEY = "a".repeat(32);
  const ROTATED_KEY = "r".repeat(32);

  beforeEach(() => {
    process.env.ADMIN_API_KEY = VALID_KEY;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = original;
  });

  it("passes through on a matching key and stores authorized caller on req.user", () => {
    const req = mockReq(VALID_KEY);
    const { res } = mockRes();
    const next = vi.fn();
    adminAuth(req as Request, res as Response, next as NextFunction);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.user).toEqual(ADMIN_CALLER);
  });

  it("401 ADMIN_KEY_MISSING when header absent and clears any pre-existing req.user", () => {
    const req = mockReq(undefined, { preExistingUser: { accountId: "stale" } });
    const { res, status, json } = mockRes();
    const next = vi.fn();
    adminAuth(req as Request, res as Response, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "ADMIN_KEY_MISSING", statusCode: 401 }),
    );
  });

  it("401 ADMIN_KEY_MALFORMED when header is empty", () => {
    const req = mockReq("");
    const { res, status, json } = mockRes();
    const next = vi.fn();
    adminAuth(req as Request, res as Response, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "ADMIN_KEY_MALFORMED" }),
    );
  });

  it("401 ADMIN_KEY_MALFORMED when header is whitespace only", () => {
    const req = mockReq("   ");
    const { res, status, json } = mockRes();
    const next = vi.fn();
    adminAuth(req as Request, res as Response, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "ADMIN_KEY_MALFORMED" }),
    );
  });

  it("401 ADMIN_KEY_MALFORMED when header is repeated (array)", () => {
    const req = mockReq([VALID_KEY, "b".repeat(32)]);
    const { res, status, json } = mockRes();
    const next = vi.fn();
    adminAuth(req as Request, res as Response, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "ADMIN_KEY_MALFORMED" }),
    );
  });

  it("401 ADMIN_KEY_MALFORMED when rawHeaders contain duplicate X-Admin-Key entries", () => {
    const req = mockReq(`${VALID_KEY}, ${VALID_KEY}`, {
      rawHeaders: ["X-Admin-Key", VALID_KEY, "x-admin-key", VALID_KEY],
    });
    const { res, status, json } = mockRes();
    const next = vi.fn();
    adminAuth(req as Request, res as Response, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "ADMIN_KEY_MALFORMED" }),
    );
  });

  it("401 ADMIN_KEY_MALFORMED when header contains internal whitespace, comma, or control characters", () => {
    for (const malformed of [
      "Bearer " + VALID_KEY,
      `${VALID_KEY},extra`,
      `${VALID_KEY}\u0000`,
      `part1\tpart2`,
    ]) {
      const req = mockReq(malformed);
      const { res, status, json } = mockRes();
      const next = vi.fn();
      adminAuth(req as Request, res as Response, next as NextFunction);
      expect(next).not.toHaveBeenCalled();
      expect(req.user).toBeUndefined();
      expect(status).toHaveBeenCalledWith(401);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "ADMIN_KEY_MALFORMED" }),
      );
    }
  });

  it("401 ADMIN_KEY_INVALID when key does not match", () => {
    const req = mockReq("b".repeat(32));
    const { res, status, json } = mockRes();
    const next = vi.fn();
    adminAuth(req as Request, res as Response, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "ADMIN_KEY_INVALID" }),
    );
  });

  it("401 ADMIN_KEY_NOT_CONFIGURED when env is unset or whitespace-only", () => {
    for (const envValue of [undefined, "", "   "]) {
      if (envValue === undefined) delete process.env.ADMIN_API_KEY;
      else process.env.ADMIN_API_KEY = envValue;

      const req = mockReq(VALID_KEY);
      const { res, status, json } = mockRes();
      const next = vi.fn();
      adminAuth(req as Request, res as Response, next as NextFunction);
      expect(next).not.toHaveBeenCalled();
      expect(req.user).toBeUndefined();
      expect(status).toHaveBeenCalledWith(401);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "ADMIN_KEY_NOT_CONFIGURED" }),
      );
    }
  });

  it("response body includes requestId and correlationId from req", () => {
    const req = mockReq(undefined);
    const { res, json } = mockRes();
    const next = vi.fn();
    adminAuth(req as Request, res as Response, next as NextFunction);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req-test",
        correlationId: "corr-test",
      }),
    );
  });

  it("validates body.apiKey and header combinations in authorizeAdminApiKey", () => {
    // Missing both header and body
    {
      const req = mockReq(undefined, { body: {} });
      const { res, status, json } = mockRes();
      expect(authorizeAdminApiKey(req as Request, res as Response, { allowBodyKey: true })).toBe(false);
      expect(status).toHaveBeenCalledWith(401);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: "ADMIN_KEY_MISSING" }));
      expect(req.user).toBeUndefined();
    }

    // Malformed body.apiKey (non-string, empty, whitespace, conflicting with header)
    for (const badBody of [
      { apiKey: "" },
      { apiKey: "   " },
      { apiKey: 12345 },
      { apiKey: null },
      { apiKey: [VALID_KEY] },
      { apiKey: "key with spaces" },
    ]) {
      const req = mockReq(undefined, { body: badBody });
      const { res, status, json } = mockRes();
      expect(authorizeAdminApiKey(req as Request, res as Response, { allowBodyKey: true })).toBe(false);
      expect(status).toHaveBeenCalledWith(401);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: "ADMIN_KEY_MALFORMED" }));
      expect(req.user).toBeUndefined();
    }

    // Conflicting header and body keys -> ADMIN_KEY_MALFORMED
    {
      const req = mockReq(VALID_KEY, { body: { apiKey: ROTATED_KEY } });
      const { res, status, json } = mockRes();
      expect(authorizeAdminApiKey(req as Request, res as Response, { allowBodyKey: true })).toBe(false);
      expect(status).toHaveBeenCalledWith(401);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: "ADMIN_KEY_MALFORMED" }));
      expect(req.user).toBeUndefined();
    }

    // Matching body key -> authorized
    {
      const req = mockReq(undefined, { body: { apiKey: VALID_KEY } });
      const { res, status } = mockRes();
      expect(authorizeAdminApiKey(req as Request, res as Response, { allowBodyKey: true })).toBe(true);
      expect(status).not.toHaveBeenCalled();
      expect(req.user).toEqual(ADMIN_CALLER);
    }
  });

  it("enforces rotated keys immediately without retaining stale keys", () => {
    // Before rotation: VALID_KEY accepted, ROTATED_KEY rejected
    const preReqValid = mockReq(VALID_KEY);
    const preResValid = mockRes();
    const preNextValid = vi.fn();
    adminAuth(preReqValid as Request, preResValid.res as Response, preNextValid as NextFunction);
    expect(preNextValid).toHaveBeenCalledOnce();
    expect(preReqValid.user).toEqual(ADMIN_CALLER);

    const preReqNew = mockReq(ROTATED_KEY);
    const preResNew = mockRes();
    const preNextNew = vi.fn();
    adminAuth(preReqNew as Request, preResNew.res as Response, preNextNew as NextFunction);
    expect(preNextNew).not.toHaveBeenCalled();
    expect(preResNew.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "ADMIN_KEY_INVALID" }),
    );

    // Rotate key
    process.env.ADMIN_API_KEY = ROTATED_KEY;

    // After rotation: old VALID_KEY rejected with ADMIN_KEY_INVALID, ROTATED_KEY accepted
    const postReqOld = mockReq(VALID_KEY);
    const postResOld = mockRes();
    const postNextOld = vi.fn();
    adminAuth(postReqOld as Request, postResOld.res as Response, postNextOld as NextFunction);
    expect(postNextOld).not.toHaveBeenCalled();
    expect(postReqOld.user).toBeUndefined();
    expect(postResOld.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "ADMIN_KEY_INVALID" }),
    );

    const postReqNew = mockReq(ROTATED_KEY);
    const postResNew = mockRes();
    const postNextNew = vi.fn();
    adminAuth(postReqNew as Request, postResNew.res as Response, postNextNew as NextFunction);
    expect(postNextNew).toHaveBeenCalledOnce();
    expect(postReqNew.user).toEqual(ADMIN_CALLER);
  });
});
