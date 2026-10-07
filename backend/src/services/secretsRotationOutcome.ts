import { secretsRotationOutcome as secretsRotationOutcomeGauge } from "./metrics";
import { logger } from "../logger";

/**
 * Coarse, secret-free outcome for the operator-visible side of a secrets
 * rotation (JWT_SECRET and/or SERVER_SIGNING_KEY), following the runbook
 * procedure: provision, update the credential, restart, and verify.
 *
 * The signal describes the *rollout* of the new credential — the state an
 * owner has to reason about while old and new artifacts coexist:
 *
 * - `success` — the process is running on the new credential and artifacts
 *   signed with the previous credential are rejected; rotation is complete.
 * - `transient_delay` — the new credential is active but old artifacts are
 *   still being observed (pre-rotation tokens accepted, pre-rotation
 *   challenges verified). Expected for the lifetime of outstanding sessions;
 *   clears on its own as clients re-authenticate. No owner action while the
 *   counts fall toward zero.
 * - `blocked` — rotation cannot complete without an owner: the new secret
 *   failed validation at startup, or the process is still running on a
 *   credential that no longer matches the configured environment (the
 *   restart step was missed).
 *
 * Mirrors the restore outcome vocabulary (`success`, `transient_delay`,
 * `blocked`, `interrupted`) so operational dashboards share one grammar.
 */
export type SecretsRotationOutcome =
  | "success"
  | "transient_delay"
  | "blocked";

/**
 * Stable numeric encoding for the Prometheus gauge and for alert rules.
 * Do not renumber: dashboards and alerts key off these values.
 */
export const SECRETS_ROTATION_OUTCOME_CODES: Record<SecretsRotationOutcome, number> = {
  success: 0,
  transient_delay: 1,
  blocked: 2,
};

/** The credential a rotation event refers to. Never a credential value. */
export type SecretsRotationCredential = "jwt_secret" | "server_signing_key" | "both";

/** Which side of the rotation an observation was made on. */
export type SecretsRotationArtifact = "token" | "challenge";

export interface SecretsRotationEvent {
  /** Credential involved in the rotation. Enumerated, never a value. */
  credential: SecretsRotationCredential;
  /**
   * Monotonic sequence number of the rotation within this process lifetime.
   * Incremented once per recorded restart-with-new-credential observation.
   */
  rotation: number;
  /** Unix seconds at which the rotation was recorded. */
  recordedAtSeconds: number;
}

export interface SecretsRotationObservation {
  /** Whether an artifact signed with the previous credential was still accepted. */
  staleAccepted: boolean;
  /** Whether an artifact signed with the current credential was rejected. */
  freshRejected: boolean;
}

export interface SecretsRotationOutcomeSignal {
  outcome: SecretsRotationOutcome;
  outcomeCode: number;
  /**
   * Owner-actionable explanation. Deliberately carries only enumerated state
   * and counts: never a secret value, a token, a signature, or a raw
   * verification message, so it is safe to log, scrape, and paste into an
   * incident channel.
   */
  detail: string;
  /** Credential the signal refers to, or `both` for a combined rotation. */
  credential: SecretsRotationCredential;
  /** Zero until a rotation has been recorded for this credential. */
  rotationCount: number;
}

const CREDENTIAL_LABELS: Record<SecretsRotationCredential, string> = {
  jwt_secret: "JWT_SECRET",
  server_signing_key: "SERVER_SIGNING_KEY",
  both: "JWT_SECRET and SERVER_SIGNING_KEY",
};

function describeFreshRejection(credential: SecretsRotationCredential): string {
  return credential === "jwt_secret" || credential === "both"
    ? "tokens signed with the configured secret are being rejected"
    : "challenges signed with the configured key are being rejected";
}

/**
 * Classifies the state of a secrets rotation into the three operational
 * outcomes.
 *
 * Precedence matters: a fresh artifact being rejected (`blocked`) outranks a
 * stale artifact still being accepted (`transient_delay`), because a rollout
 * that breaks *new* logins needs a human before old sessions expiring matters.
 */
export function classifySecretsRotationOutcome(
  rotation: SecretsRotationEvent | null,
  observation: SecretsRotationObservation,
): SecretsRotationOutcomeSignal {
  const credential = rotation?.credential ?? "both";
  const rotationCount = rotation?.rotation ?? 0;

  if (observation.freshRejected) {
    return {
      outcome: "blocked",
      outcomeCode: SECRETS_ROTATION_OUTCOME_CODES.blocked,
      credential,
      rotationCount,
      detail:
        `Rotation is blocked: ${describeFreshRejection(credential)}. The ` +
        `configured credential failed validation or the running process has ` +
        `not been restarted since the credential changed. Owner action: follow ` +
        `RUNBOOK.md "Rotate ${CREDENTIAL_LABELS[credential]}": correct the ` +
        `credential value, restart the backend once, then confirm this signal ` +
        `returns to success. Do not loop restarts.`,
    };
  }

  if (!rotation) {
    return {
      outcome: "success",
      outcomeCode: SECRETS_ROTATION_OUTCOME_CODES.success,
      credential,
      rotationCount,
      detail:
        `No secrets rotation has been recorded in this process lifetime; the ` +
        `configured credentials are serving new logins normally. Owner action: ` +
        `none.`,
    };
  }

  if (observation.staleAccepted) {
    return {
      outcome: "transient_delay",
      outcomeCode: SECRETS_ROTATION_OUTCOME_CODES.transient_delay,
      credential,
      rotationCount,
      detail:
        `Rotation ${rotationCount} of ${CREDENTIAL_LABELS[credential]} is in ` +
        `its expected rollout window: artifacts signed with the previous ` +
        `credential are still accepted. Outstanding sessions and in-flight ` +
        `challenges clear as clients re-authenticate; no data is at risk. ` +
        `Owner action: none while the stale-acceptance count falls toward ` +
        `zero; if it persists beyond the session lifetime, restart the ` +
        `backend once and re-read the signal.`,
    };
  }

  return {
    outcome: "success",
    outcomeCode: SECRETS_ROTATION_OUTCOME_CODES.success,
    credential,
    rotationCount,
    detail:
      `Rotation ${rotationCount} of ${CREDENTIAL_LABELS[credential]} is ` +
      `complete: the process runs on the new credential and artifacts signed ` +
      `with the previous credential are rejected. Owner action: none.`,
  };
}

// ── Recorded rotation state (process lifetime) ──────────────────────────────

let recordedRotation: SecretsRotationEvent | null = null;
const recordedRotationsByCredential: Partial<
  Record<SecretsRotationCredential, SecretsRotationEvent>
> = {};
let rotationSequence = 0;

/**
 * Records that the process is running with a (new) credential — the restart
 * step of the runbook rotation procedure. Each call bumps the rotation
 * sequence for the credential, so operators can tell rotations apart in logs.
 */
export function recordSecretsRotation(
  credential: SecretsRotationCredential,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SecretsRotationEvent {
  rotationSequence += 1;
  const event: SecretsRotationEvent = {
    credential,
    rotation: rotationSequence,
    recordedAtSeconds: nowSeconds,
  };
  recordedRotation = event;
  recordedRotationsByCredential[credential] = event;
  logger.info(
    { credential, rotation: event.rotation },
    "secrets rotation recorded",
  );
  return event;
}

/**
 * The most recently recorded rotation regardless of credential, or null when
 * no rotation has been recorded in this process lifetime.
 */
export function getRecordedSecretsRotation(): SecretsRotationEvent | null {
  return recordedRotation;
}

/**
 * The most recently recorded rotation for a specific credential, or null.
 */
export function getRecordedSecretsRotationForCredential(
  credential: SecretsRotationCredential,
): SecretsRotationEvent | null {
  return recordedRotationsByCredential[credential] ?? null;
}

/** Test helper: clears all recorded rotation state between cases. */
export function resetSecretsRotationOutcome(): void {
  recordedRotation = null;
  rotationSequence = 0;
  for (const key of Object.keys(recordedRotationsByCredential) as Array<
    SecretsRotationCredential
  >) {
    delete recordedRotationsByCredential[key];
  }
}

/**
 * Current outcome signal. When a credential is given, the signal describes
 * that credential's latest rotation; otherwise it describes the most recent
 * rotation of any credential (or "no rotation yet" when none was recorded).
 */
export function getSecretsRotationOutcomeSignal(
  observation: SecretsRotationObservation = { staleAccepted: false, freshRejected: false },
  credential?: SecretsRotationCredential,
): SecretsRotationOutcomeSignal {
  const rotation = credential
    ? getRecordedSecretsRotationForCredential(credential)
    : getRecordedSecretsRotation();
  return classifySecretsRotationOutcome(rotation, observation);
}

/**
 * Publishes the current outcome to Prometheus so alerting does not have to
 * re-derive it from auth failure counters. Returns the signal it published.
 */
export function refreshSecretsRotationMetrics(
  observation: SecretsRotationObservation = { staleAccepted: false, freshRejected: false },
  credential?: SecretsRotationCredential,
): SecretsRotationOutcomeSignal {
  const signal = getSecretsRotationOutcomeSignal(observation, credential);
  secretsRotationOutcomeGauge.set(signal.outcomeCode);
  return signal;
}
