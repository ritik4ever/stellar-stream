import { describe, expect, it } from "vitest";
import { formatTokenAmount, formatDuration, formatAddress } from "./format";

describe("formatTokenAmount", () => {
  it("formats XLM with up to 7 decimal places", () => {
    expect(formatTokenAmount(1234.5, "XLM")).toBe("1,234.5");
  });

  it("formats USDC with up to 6 decimal places", () => {
    expect(formatTokenAmount("99.123456789", "USDC")).toBe("99.123457");
  });

  it("falls back to 7 decimals for unknown assets", () => {
    expect(formatTokenAmount(1, "UNKNOWN")).toBe("1");
  });

  it("accepts a raw decimals count", () => {
    expect(formatTokenAmount(1.23456, 2)).toBe("1.23");
  });

  it("returns an em dash for non-finite input", () => {
    expect(formatTokenAmount(NaN)).toBe("—");
    expect(formatTokenAmount("not-a-number")).toBe("—");
  });
});

describe("formatDuration", () => {
  it("formats seconds only", () => {
    expect(formatDuration(45)).toBe("45s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(90)).toBe("1m 30s");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(2 * 3600 + 30 * 60)).toBe("2h 30m");
  });

  it("formats whole days", () => {
    expect(formatDuration(3 * 86400)).toBe("3 days");
  });

  it("formats singular day", () => {
    expect(formatDuration(86400)).toBe("1 day");
  });

  it("formats days with remaining hours", () => {
    expect(formatDuration(86400 + 3600)).toBe("1 day 1h");
  });

  it("handles zero", () => {
    expect(formatDuration(0)).toBe("0s");
  });

  it("returns an em dash for invalid input", () => {
    expect(formatDuration(-5)).toBe("—");
    expect(formatDuration(NaN)).toBe("—");
  });
});

describe("formatAddress", () => {
  it("truncates a long Stellar address", () => {
    expect(formatAddress("GABCDEFGHIJKLMNOPQRSTUVWXYZ234567")).toBe("GABC...4567");
  });

  it("leaves short strings unchanged", () => {
    expect(formatAddress("GABC")).toBe("GABC");
  });

  it("returns an empty string for empty input", () => {
    expect(formatAddress("")).toBe("");
  });
});
