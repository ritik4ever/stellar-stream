import { describe, it, expect, vi } from "vitest";
import { requireJsonContentType } from "./contentType";
import type { Request, Response } from "express";

describe("requireJsonContentType", () => {
  it("calls next for POST with application/json", () => {
    const req = {
      method: "POST",
      headers: { "content-type": "application/json" },
    } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn();

    requireJsonContentType(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("returns 415 for POST with missing Content-Type", () => {
    const req = {
      method: "POST",
      headers: {},
    } as unknown as Request;

    let statusCode = 0;
    let jsonBody: any;
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: any) {
        jsonBody = payload;
        return this;
      },
    } as unknown as Response;
    const next = vi.fn();

    requireJsonContentType(req, res, next);

    expect(statusCode).toBe(415);
    expect(jsonBody).toEqual({ error: "Content-Type must be application/json" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 415 for POST with text/plain", () => {
    const req = {
      method: "POST",
      headers: { "content-type": "text/plain" },
    } as unknown as Request;

    let statusCode = 0;
    let jsonBody: any;
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: any) {
        jsonBody = payload;
        return this;
      },
    } as unknown as Response;
    const next = vi.fn();

    requireJsonContentType(req, res, next);

    expect(statusCode).toBe(415);
    expect(jsonBody).toEqual({ error: "Content-Type must be application/json" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 415 for PATCH with wrong Content-Type", () => {
    const req = {
      method: "PATCH",
      headers: { "content-type": "text/html" },
    } as unknown as Request;

    let statusCode = 0;
    let jsonBody: any;
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: any) {
        jsonBody = payload;
        return this;
      },
    } as unknown as Response;
    const next = vi.fn();

    requireJsonContentType(req, res, next);

    expect(statusCode).toBe(415);
    expect(jsonBody).toEqual({ error: "Content-Type must be application/json" });
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next for GET with no Content-Type", () => {
    const req = {
      method: "GET",
      headers: {},
    } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn();

    requireJsonContentType(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("calls next for non-POST/PATCH methods", () => {
    const req = {
      method: "DELETE",
      headers: {},
    } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn();

    requireJsonContentType(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
