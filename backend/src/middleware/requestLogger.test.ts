import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { requestLogger } from "./requestLogger";
import { logger } from "../logger";
import type { Request, Response } from "express";

describe("requestLogger", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const loggerInfoSpy = vi.spyOn(logger, "info").mockImplementation(() => logger);
  vi.spyOn(logger, "child").mockImplementation(() => logger);

  beforeEach(() => {
    loggerInfoSpy.mockClear();
    process.env.NODE_ENV = "development";
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("should not log Authorization headers", () => {
    const authHeader = "Bearer secret-token";
    const req = {
      method: "POST",
      originalUrl: "/api/streams",
      headers: {
        authorization: authHeader,
      },
    } as unknown as Request;

    const res = new EventEmitter() as Response;
    (res as any).statusCode = 201;
    (res as any).setHeader = vi.fn();

    const next = vi.fn();

    requestLogger(req, res, next);
    expect(next).toHaveBeenCalled();

    res.emit("finish");

    expect(loggerInfoSpy).toHaveBeenCalledTimes(1);
    const logPayload = loggerInfoSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(logPayload).toMatchObject({
      method: "POST",
      route: "/api/streams",
      statusCode: 201,
    });
    expect(JSON.stringify(logPayload)).not.toContain(authHeader);
    expect(JSON.stringify(logPayload).toLowerCase()).not.toContain("authorization");
  });

  it("should set X-Correlation-ID and X-Request-ID response headers", () => {
    const req = {
      method: "GET",
      originalUrl: "/api/streams",
      headers: {},
    } as unknown as Request;

    const res = new EventEmitter() as Response;
    (res as any).statusCode = 200;
    (res as any).setHeader = vi.fn();

    const next = vi.fn();

    requestLogger(req, res, next);
    expect(next).toHaveBeenCalled();
    expect((res as any).setHeader).toHaveBeenCalledWith("X-Correlation-ID", expect.any(String));
    expect((res as any).setHeader).toHaveBeenCalledWith("X-Request-ID", expect.any(String));
    expect(req.correlationId).toBeDefined();
    expect(req.requestId).toBeDefined();
    expect(req.correlationId).toBe(req.requestId);
  });

  it("should use existing X-Correlation-ID from headers", () => {
    const existingCorrelationId = "existing-correlation-id-123";
    const req = {
      method: "GET",
      originalUrl: "/api/streams",
      headers: {
        "x-correlation-id": existingCorrelationId,
      },
    } as unknown as Request;

    const res = new EventEmitter() as Response;
    (res as any).statusCode = 200;
    (res as any).setHeader = vi.fn();

    const next = vi.fn();

    requestLogger(req, res, next);
    expect(next).toHaveBeenCalled();
    expect((res as any).setHeader).toHaveBeenCalledWith("X-Correlation-ID", existingCorrelationId);
    expect((res as any).setHeader).toHaveBeenCalledWith("X-Request-ID", existingCorrelationId);
    expect(req.correlationId).toBe(existingCorrelationId);
  });

  it("should use X-Correlation-ID over X-Request-ID when both present", () => {
    const correlationId = "correlation-id-priority";
    const requestId = "request-id-secondary";
    const req = {
      method: "GET",
      originalUrl: "/api/streams",
      headers: {
        "x-correlation-id": correlationId,
        "x-request-id": requestId,
      },
    } as unknown as Request;

    const res = new EventEmitter() as Response;
    (res as any).statusCode = 200;
    (res as any).setHeader = vi.fn();

    const next = vi.fn();

    requestLogger(req, res, next);
    expect(next).toHaveBeenCalled();
    expect((res as any).setHeader).toHaveBeenCalledWith("X-Correlation-ID", correlationId);
    expect(req.correlationId).toBe(correlationId);
    expect(req.requestId).toBe(correlationId);
  });

  it("should fall back to X-Request-ID when X-Correlation-ID not provided", () => {
    const requestId = "fallback-request-id";
    const req = {
      method: "GET",
      originalUrl: "/api/streams",
      headers: {
        "x-request-id": requestId,
      },
    } as unknown as Request;

    const res = new EventEmitter() as Response;
    (res as any).statusCode = 200;
    (res as any).setHeader = vi.fn();

    const next = vi.fn();

    requestLogger(req, res, next);
    expect(next).toHaveBeenCalled();
    expect((res as any).setHeader).toHaveBeenCalledWith("X-Correlation-ID", requestId);
    expect((res as any).setHeader).toHaveBeenCalledWith("X-Request-ID", requestId);
    expect(req.correlationId).toBe(requestId);
  });

  it("should generate new UUID for invalid correlation ID format", () => {
    const invalidCorrelationId = "invalid@id#with!special";
    const req = {
      method: "GET",
      originalUrl: "/api/streams",
      headers: {
        "x-correlation-id": invalidCorrelationId,
      },
    } as unknown as Request;

    const res = new EventEmitter() as Response;
    (res as any).statusCode = 200;
    (res as any).setHeader = vi.fn();

    const next = vi.fn();

    requestLogger(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.correlationId).toBeDefined();
    expect(req.correlationId).not.toBe(invalidCorrelationId);
    // Should be a valid UUID format
    expect(req.correlationId).toMatch(/^[a-f0-9-]{36}$/);
  });

  it("should handle array of correlation IDs by using first value", () => {
    const req = {
      method: "GET",
      originalUrl: "/api/streams",
      headers: {
        "x-correlation-id": ["first-id", "second-id"],
      },
    } as unknown as Request;

    const res = new EventEmitter() as Response;
    (res as any).statusCode = 200;
    (res as any).setHeader = vi.fn();

    const next = vi.fn();

    requestLogger(req, res, next);
    expect(next).toHaveBeenCalled();
    expect((res as any).setHeader).toHaveBeenCalledWith("X-Correlation-ID", "first-id");
    expect((res as any).setHeader).toHaveBeenCalledWith("X-Request-ID", "first-id");
    expect(req.correlationId).toBe("first-id");
  });

  it("should include correlation_id in log entry", () => {
    const req = {
      method: "GET",
      originalUrl: "/api/streams",
      headers: {},
    } as unknown as Request;

    const res = new EventEmitter() as Response;
    (res as any).statusCode = 200;
    (res as any).setHeader = vi.fn();

    const next = vi.fn();

    requestLogger(req, res, next);
    expect(next).toHaveBeenCalled();

    res.emit("finish");

    expect(loggerInfoSpy).toHaveBeenCalledTimes(1);
    const logPayload = loggerInfoSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(logPayload).toHaveProperty("correlation_id");
    expect(typeof logPayload.correlation_id).toBe("string");
  });
});
