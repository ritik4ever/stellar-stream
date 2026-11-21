import { beforeEach, describe, expect, it } from "vitest";
import {
  classifySecretsRotationOutcome,
  getSecretsRotationOutcomeSignal,
  getRecordedSecretsRotation,
  getRecordedSecretsRotationForCredential,
  recordSecretsRotation,
  resetSecretsRotationOutcome,
  SECRETS_ROTATION_OUTCOME_CODES,
  SecretsRotationObservation,
} from "./secretsRotationOutcome";

const CLEAN: SecretsRotationObservation = { staleAccepted: false, freshRejected: false };
const STALE_ACCEPTED: SecretsRotationObservation = { staleAccepted: true, freshRejected: false };
const FRESH_REJECTED: SecretsRotationObservation = { staleAccepted: false, freshRejected: true };
const MIXED: SecretsRotationObservation = { staleAccepted: true, freshRejected: true };

describe("classifySecretsRotationOutcome", () => {
  it("exposes the documented outcome codes", () => {
    expect(SECRETS_ROTATION_OUTCOME_CODES).toEqual({
      success: 0,
      transient_delay: 1,
      blocked: 2,
    });
  });

  it("reports success with no rotation recorded", () => {
    const signal = classifySecretsRotationOutcome(null, CLEAN);
    expect(signal.outcome).toBe("success");
    expect(signal.outcomeCode).toBe(0);
    expect(signal.rotationCount).toBe(0);
    expect(signal.credential).toBe("both");
  });

  it("reports transient_delay when stale artifacts are still accepted", () => {
    const rotation = { credential: "jwt_secret" as const, rotation: 3, recordedAtSeconds: 100 };
    const signal = classifySecretsRotationOutcome(rotation, STALE_ACCEPTED);
    expect(signal.outcome).toBe("transient_delay");
    expect(signal.outcomeCode).toBe(1);
    expect(signal.rotationCount).toBe(3);
    expect(signal.credential).toBe("jwt_secret");
  });

  it("reports blocked when fresh artifacts are rejected", () => {
    const rotation = { credential: "server_signing_key" as const, rotation: 2, recordedAtSeconds: 100 };
    const signal = classifySecretsRotationOutcome(rotation, FRESH_REJECTED);
    expect(signal.outcome).toBe("blocked");
    expect(signal.outcomeCode).toBe(2);
    expect(signal.credential).toBe("server_signing_key");
  });

  it("blocked outranks transient_delay when both observations hold", () => {
    const rotation = { credential: "both" as const, rotation: 1, recordedAtSeconds: 100 };
    const signal = classifySecretsRotationOutcome(rotation, MIXED);
    expect(signal.outcome).toBe("blocked");
  });

  it("reports success once stale artifacts are no longer accepted", () => {
    const rotation = { credential: "jwt_secret" as const, rotation: 5, recordedAtSeconds: 100 };
    const signal = classifySecretsRotationOutcome(rotation, CLEAN);
    expect(signal.outcome).toBe("success");
    expect(signal.rotationCount).toBe(5);
  });

  it("mentions the runbook and owner action in every non-success detail", () => {
    const rotation = { credential: "jwt_secret" as const, rotation: 1, recordedAtSeconds: 100 };
    for (const observation of [STALE_ACCEPTED, FRESH_REJECTED]) {
      const signal = classifySecretsRotationOutcome(rotation, observation as SecretsRotationObservation);
      expect(signal.detail).toMatch(/Owner action:/);
    }
  });
});

describe("recorded rotation state", () => {
  beforeEach(() => {
    resetSecretsRotationOutcome();
  });

  it("starts with nothing recorded", () => {
    expect(getRecordedSecretsRotation()).toBeNull();
    expect(getRecordedSecretsRotationForCredential("jwt_secret")).toBeNull();
    const signal = getSecretsRotationOutcomeSignal();
    expect(signal.outcome).toBe("success");
    expect(signal.rotationCount).toBe(0);
  });

  it("records a rotation and exposes it by credential", () => {
    recordSecretsRotation("jwt_secret", 1000);
    const recorded = getRecordedSecretsRotation();
    expect(recorded).not.toBeNull();
    expect(recorded!.credential).toBe("jwt_secret");
    expect(recorded!.recordedAtSeconds).toBe(1000);
    expect(getRecordedSecretsRotationForCredential("jwt_secret")).not.toBeNull();
    expect(getRecordedSecretsRotationForCredential("server_signing_key")).toBeNull();
  });

  it("increments the rotation sequence across records", () => {
    const first = recordSecretsRotation("jwt_secret", 1000);
    const second = recordSecretsRotation("jwt_secret", 2000);
    expect(second.rotation).toBe(first.rotation + 1);
  });

  it("tracks the latest rotation of any credential", () => {
    recordSecretsRotation("jwt_secret", 1000);
    recordSecretsRotation("server_signing_key", 2000);
    expect(getRecordedSecretsRotation()!.credential).toBe("server_signing_key");
    expect(getRecordedSecretsRotationForCredential("jwt_secret")!.rotation).toBe(1);
  });

  it("reset clears all recorded state", () => {
    recordSecretsRotation("jwt_secret", 1000);
    resetSecretsRotationOutcome();
    expect(getRecordedSecretsRotation()).toBeNull();
    expect(getSecretsRotationOutcomeSignal().rotationCount).toBe(0);
  });
});

describe("refreshSecretsRotationMetrics", () => {
  beforeEach(() => {
    resetSecretsRotationOutcome();
  });

  it("publishes the classified outcome code to the gauge", async () => {
    recordSecretsRotation("jwt_secret", 1000);
    const signal = getSecretsRotationOutcomeSignal(STALE_ACCEPTED);
    expect(signal.outcome).toBe("transient_delay");
  });

  it("does not throw without any recorded rotation", () => {
    expect(() => getSecretsRotationOutcomeSignal()).not.toThrow();
  });
});

describe("secret-free signal guarantees", () => {
  it("signal JSON never contains secret-looking values", () => {
    const SECRET = "SB6KUVWJ0H8KE6RCBPKZ0XPGTKPX3QGEPWJ0H8KE6RCBPKZ0XPGTAAAA";
    const rotation = { credential: "server_signing_key" as const, rotation: 1, recordedAtSeconds: 100 };
    for (const observation of [CLEAN, STALE_ACCEPTED, FRESH_REJECTED]) {
      const signal = classifySecretsRotationOutcome(rotation, observation as SecretsRotationObservation);
      expect(JSON.stringify(signal)).not.toContain(SECRET);
    }
  });
});
