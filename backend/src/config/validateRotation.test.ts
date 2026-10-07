import { describe, it, expect } from "vitest";
import {
  validateRotationConfig,
  getAcceptedJwtSecrets,
} from "./validateRotation";

const CURRENT = "c".repeat(40);
const PREVIOUS = "p".repeat(40);
const NOW = new Date("2026-10-02T00:00:00Z");
const FUTURE = "2026-10-15T00:00:00Z";
const PAST = "2026-09-01T00:00:00Z";

const env = (o: Record<string, string>) => ({ JWT_SECRET: CURRENT, ...o }) as NodeJS.ProcessEnv;

describe("validateRotationConfig", () => {
  it("is a no-op when rotation is not configured", () => {
    const r = validateRotationConfig(env({}), NOW);
    expect(r.errors).toEqual([]);
    expect(r.config).toEqual({});
  });

  it("accepts a valid config", () => {
    const r = validateRotationConfig(
      env({ JWT_SECRET_PREVIOUS: PREVIOUS, JWT_ROTATION_CUTOVER_AT: FUTURE }),
      NOW,
    );
    expect(r.errors).toEqual([]);
    expect(r.config.previousSecret).toBe(PREVIOUS);
  });

  it("fails when only the previous secret is set", () => {
    const r = validateRotationConfig(env({ JWT_SECRET_PREVIOUS: PREVIOUS }), NOW);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("fails when only the cutover time is set", () => {
    const r = validateRotationConfig(env({ JWT_ROTATION_CUTOVER_AT: FUTURE }), NOW);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("fails on a short previous secret", () => {
    const r = validateRotationConfig(
      env({ JWT_SECRET_PREVIOUS: "short", JWT_ROTATION_CUTOVER_AT: FUTURE }),
      NOW,
    );
    expect(r.errors.join(" ")).toContain("at least 32");
  });

  it("fails when previous equals current", () => {
    const r = validateRotationConfig(
      env({ JWT_SECRET_PREVIOUS: CURRENT, JWT_ROTATION_CUTOVER_AT: FUTURE }),
      NOW,
    );
    expect(r.errors.join(" ")).toContain("must differ");
  });

  it("fails on an invalid cutover date", () => {
    const r = validateRotationConfig(
      env({ JWT_SECRET_PREVIOUS: PREVIOUS, JWT_ROTATION_CUTOVER_AT: "not-a-date" }),
      NOW,
    );
    expect(r.errors.join(" ")).toContain("ISO 8601");
  });

  it("never leaks secret values in errors or warnings", () => {
    const cases = [
      env({ JWT_SECRET_PREVIOUS: CURRENT, JWT_ROTATION_CUTOVER_AT: FUTURE }),
      env({ JWT_SECRET_PREVIOUS: "short" }),
      env({ JWT_SECRET_PREVIOUS: PREVIOUS, JWT_ROTATION_CUTOVER_AT: PAST }),
    ];
    for (const c of cases) {
      const r = validateRotationConfig(c, NOW);
      const text = [...r.errors, ...r.warnings].join(" ");
      expect(text).not.toContain(CURRENT);
      expect(text).not.toContain(PREVIOUS);
    }
  });

  it("warns when the cutover has already passed", () => {
    const r = validateRotationConfig(
      env({ JWT_SECRET_PREVIOUS: PREVIOUS, JWT_ROTATION_CUTOVER_AT: PAST }),
      NOW,
    );
    expect(r.errors).toEqual([]);
    expect(r.warnings.length).toBe(1);
  });
});

describe("getAcceptedJwtSecrets", () => {
  const rotating = env({ JWT_SECRET_PREVIOUS: PREVIOUS, JWT_ROTATION_CUTOVER_AT: FUTURE });

  it("accepts the previous secret before cutover", () => {
    expect(getAcceptedJwtSecrets(rotating, NOW)).toEqual([CURRENT, PREVIOUS]);
  });

  it("rejects the previous secret after cutover", () => {
    const after = new Date("2026-10-16T00:00:00Z");
    expect(getAcceptedJwtSecrets(rotating, after)).toEqual([CURRENT]);
  });

  it("only returns the current secret when not rotating", () => {
    expect(getAcceptedJwtSecrets(env({}), NOW)).toEqual([CURRENT]);
  });
});