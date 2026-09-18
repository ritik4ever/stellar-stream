import { describe, it, expect } from "vitest";
import { streamIdSchema } from "./schemas";
describe("schemas edge cases", () => {
  it("rejects empty id", () => expect(streamIdSchema.safeParse({ id: "" }).success).toBe(false));
  it("rejects null", () => expect(streamIdSchema.safeParse({ id: null }).success).toBe(false));
  it("accepts valid uuid", () => expect(streamIdSchema.safeParse({ id: "550e8400-e29b-41d4-a716-446655440000" }).success).toBe(true));
});
