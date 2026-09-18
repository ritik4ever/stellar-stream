import { describe, expect, it, vi, afterEach } from "vitest";
import { ApiError, listStreams, setAuthToken, createStream } from "./api";

describe("api error handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws ApiError with statusCode and details when API returns 400", async () => {
    const details = { field: "amount", message: "must be positive" };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Validation failed", details }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const promise = listStreams();
    await expect(promise).rejects.toThrow(ApiError);
    await expect(promise).rejects.toMatchObject({
      statusCode: 400,
      message: "Validation failed",
      details: { error: "Validation failed", details },
    });
  });

  it("throws ApiError with 404 status code when resource not found", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Stream not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(listStreams()).rejects.toMatchObject({
      statusCode: 404,
      message: "Stream not found",
    });
  });

  it("throws generic ApiError for 500 internal server error without leaking details", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Internal Server Error", {
        status: 500,
        statusText: "Internal Server Error",
      }),
    );

    const promise = listStreams();
    await expect(promise).rejects.toThrow(ApiError);
    await expect(promise).rejects.toMatchObject({
      statusCode: 500,
      message: "Internal Server Error",
    });
  });
});

describe("api authentication", () => {
  afterEach(() => {
    setAuthToken(null);
    vi.restoreAllMocks();
  });

  it("sends Authorization header when token is set", async () => {
    setAuthToken("test-jwt-token");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "1" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await createStream({
      sender: "GSENDER123456789012345678901234567890123456789012345678",
      recipient: "GRECIPIENT12345678901234567890123456789012345678901234",
      assetCode: "XLM",
      totalAmount: 100,
      durationSeconds: 3600,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-jwt-token",
        }),
      }),
    );
  });
});

