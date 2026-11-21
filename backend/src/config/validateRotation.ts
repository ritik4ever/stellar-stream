export interface RotationConfig {
  previousSecret?: string;
  cutoverAt?: Date;
}

export interface RotationResult {
  errors: string[];
  warnings: string[];
  config: RotationConfig;
}

const MIN_SECRET_LENGTH = 32;

/**
 * Validates JWT secret rotation settings. Never includes secret values in
 * messages, only variable names and rules.
 */
export function validateRotationConfig(
  env: NodeJS.ProcessEnv,
  now: Date = new Date(),
): RotationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const config: RotationConfig = {};

  const previous = env.JWT_SECRET_PREVIOUS?.trim() || undefined;
  const cutoverRaw = env.JWT_ROTATION_CUTOVER_AT?.trim() || undefined;

  // Rotation not configured: behavior unchanged.
  if (!previous && !cutoverRaw) return { errors, warnings, config };

  if (!previous) {
    errors.push(
      "JWT_SECRET_PREVIOUS is required when JWT_ROTATION_CUTOVER_AT is set",
    );
  }
  if (!cutoverRaw) {
    errors.push(
      "JWT_ROTATION_CUTOVER_AT is required when JWT_SECRET_PREVIOUS is set",
    );
  }

  if (previous) {
    if (!env.JWT_SECRET) {
      errors.push("JWT_SECRET must be set when JWT_SECRET_PREVIOUS is set");
    }
    if (previous.length < MIN_SECRET_LENGTH) {
      errors.push(
        `JWT_SECRET_PREVIOUS must be at least ${MIN_SECRET_LENGTH} characters`,
      );
    }
    if (env.JWT_SECRET && previous === env.JWT_SECRET) {
      errors.push("JWT_SECRET_PREVIOUS must differ from JWT_SECRET");
    }
  }

  if (cutoverRaw) {
    const cutover = new Date(cutoverRaw);
    if (Number.isNaN(cutover.getTime())) {
      errors.push(
        "JWT_ROTATION_CUTOVER_AT must be a valid ISO 8601 date, e.g. 2026-10-15T00:00:00Z",
      );
    } else {
      config.cutoverAt = cutover;
      if (cutover.getTime() <= now.getTime()) {
        warnings.push(
          "JWT_ROTATION_CUTOVER_AT has passed; JWT_SECRET_PREVIOUS is ignored. Remove both variables.",
        );
      }
    }
  }

  if (errors.length === 0) config.previousSecret = previous;
  return { errors, warnings, config };
}

/**
 * Secrets accepted for VERIFYING tokens. Always sign with JWT_SECRET only.
 */
export function getAcceptedJwtSecrets(
  env: NodeJS.ProcessEnv,
  now: Date = new Date(),
): string[] {
  const secrets: string[] = [];
  if (env.JWT_SECRET) secrets.push(env.JWT_SECRET);

  const { errors, config } = validateRotationConfig(env, now);
  if (
    errors.length === 0 &&
    config.previousSecret &&
    config.cutoverAt &&
    now.getTime() < config.cutoverAt.getTime()
  ) {
    secrets.push(config.previousSecret);
  }
  return secrets;
}