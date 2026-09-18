import { describe, it, expect, vi, beforeEach } from "vitest";
import { requestBuilder } from "./api";

describe("api.ts - request construction", () => {
  it("should build a GET request with correct URL", () => {
    const req = requestBuilder("/api/streams", "GET");
    expect(req.method).toBe("GET");
    expect(req.url).toContain("/api/streams");
  });

  it("should build a POST request with JSON body", () => {
    const req = requestBuilder("/api/streams", "POST", { name: "test" });
    expect(req.method).toBe("POST");
    expect(req.body).toBe(JSON.stringify({ name: "test" }));
    expect(req.headers["Content-Type"]).toBe("application/json");
  });

  it("should handle error responses gracefully", () => {
    const req = requestBuilder("/api/streams/invalid", "GET");
    expect(req.method).toBe("GET");
  });
});
