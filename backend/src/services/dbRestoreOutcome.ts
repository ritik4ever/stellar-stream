import { discoverMigrations, getMigrationsDir } from "./migrations";
import { sqliteRestoreOutcome as sqliteRestoreOutcomeGauge } from "./metrics";

/**
 * Coarse, secret-free outcome for the SQLite schema check performed when a
 * database is opened — the moment a restore from a prior point in time takes
 * effect.
 *
 * - `success` — the database schema matches the running code.
 * - `transient_delay` — the database is behind the running code: pending
 *   migrations exist but startup applies them on its own, so the difference
 *   clears without operator intervention.
 * - `blocked` — the database is ahead of the running code: applied schema
 *   versions this build does not know about cannot be reconciled because
 *   migrations are forward-only, so work must stop until code and snapshot
 *   match again.
 */
export type SqliteRestoreOutcome =
  | "success"
  | "transient_delay"
  | "blocked"
  | "interrupted";

/**
 * Stable numeric encoding for the Prometheus gauge and for alert rules.
 * Do not renumber: dashboards and alerts key off these values.
 */
export const SQLITE_RESTORE_OUTCOME_CODES: Record<SqliteRestoreOutcome, number> = {
  success: 0,
  transient_delay: 1,
  blocked: 2,
  interrupted: 3,
};

export interface RestoreSchemaSnapshot {
  /** Schema versions recorded in the database's `schema_migrations` table. */
  appliedVersions: number[];
  /** Schema versions the running code ships. */
  expectedVersions: number[];
  /** Whether the database integrity check passed. */
  integrityOk?: boolean;
}

export interface RestoreOutcomeCounts {
  /** Migrations recorded as applied in the database. */
  applied: number;
  /** Migrations shipped by the running code. */
  expected: number;
  /** Shipped by the code but not yet recorded in the database. */
  pending: number;
  /** Recorded in the database but unknown to the running code. */
  unknown: number;
}

export interface RestoreOutcomeSignal {
  outcome: SqliteRestoreOutcome;
  outcomeCode: number;
  /**
   * Owner-actionable explanation. Deliberately carries only counts and state:
   * never the database path, migration names, or user data, so it is safe to
   * log, scrape, and paste into an incident channel.
   */
  detail: string;
  counts: RestoreOutcomeCounts;
}

function uniqueSorted(values: number[]): number[] {
  return Array.from(new Set(values.filter((value) => Number.isFinite(value)))).sort(
    (a, b) => a - b,
  );
}

/**
 * Classifies a database-vs-code schema snapshot into the three operational
 * outcomes.
 *
 * Precedence matters: a database that is ahead of the code (`unknown`) is
 * `blocked` and outranks a database that is merely behind (`pending`), because
 * forward-only migrations cannot undo state this build does not understand. A
 * database that is behind is `transient_delay`: startup applies the pending
 * migrations on its own, so the operator does not have to.
 */
export function classifyRestoreOutcome(
  snapshot: RestoreSchemaSnapshot,
): RestoreOutcomeSignal {
  const appliedVersions = uniqueSorted(snapshot.appliedVersions);
  const expectedVersions = uniqueSorted(snapshot.expectedVersions);
  const appliedSet = new Set(appliedVersions);
  const expectedSet = new Set(expectedVersions);

  const pending = expectedVersions.filter((version) => !appliedSet.has(version)).length;
  const unknown = appliedVersions.filter((version) => !expectedSet.has(version)).length;

  const counts: RestoreOutcomeCounts = {
    applied: appliedVersions.length,
    expected: expectedVersions.length,
    pending,
    unknown,
  };

  let outcome: SqliteRestoreOutcome;
  let detail: string;

  if (snapshot.integrityOk === false) {
    outcome = "interrupted";
    detail =
      `The restored database backup was interrupted before completion or corrupted during ` +
      `active writes. Owner action: discard the incomplete backup file, restore a valid ` +
      `complete backup, and confirm this signal returns to success.`;
  } else if (unknown > 0) {
    outcome = "blocked";
    detail =
      `The restored database is ahead of the running code: ${unknown} applied ` +
      `schema version(s) are unknown to this build. Forward-only migrations ` +
      `cannot reconcile a newer snapshot. Owner action: deploy the code version ` +
      `that wrote the snapshot, or restore a snapshot taken with this build, ` +
      `then confirm this signal returns to success.`;
  } else if (pending > 0) {
    outcome = "transient_delay";
    detail =
      `The restored database is behind the running code: ${pending} of ` +
      `${counts.expected} migration(s) are pending. Startup applies them ` +
      `automatically, so no data is at risk. Owner action: none while the count ` +
      `reaches zero; if it does not, restart the backend once and re-read the ` +
      `signal.`;
  } else {
    outcome = "success";
    detail =
      `The database schema matches the running code ` +
      `(${counts.applied} of ${counts.expected} migration(s) applied).`;
  }

  return {
    outcome,
    outcomeCode: SQLITE_RESTORE_OUTCOME_CODES[outcome],
    detail,
    counts,
  };
}

/**
 * Reads the applied schema versions. Returns an empty list when the
 * `schema_migrations` table does not exist yet (fresh database), which is a
 * normal transient state rather than an error.
 */
export function readAppliedSchemaVersions(db: any): number[] {
  try {
    const rows = db
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all() as Array<{ version: number | string }>;
    return uniqueSorted(rows.map((row) => Number(row.version)));
  } catch {
    return [];
  }
}

export function readRestoreSnapshot(
  db: any,
  migrationsDir?: string,
): RestoreSchemaSnapshot {
  let integrityOk = true;
  try {
    const checkRows = db
      .prepare("PRAGMA integrity_check;")
      .all() as Array<{ integrity_check: string }>;
    if (!checkRows.every((row) => row.integrity_check === "ok")) {
      integrityOk = false;
    }
  } catch {
    integrityOk = false;
  }

  const expectedVersions = uniqueSorted(
    discoverMigrations(migrationsDir ?? getMigrationsDir()).map(
      (migration) => migration.version,
    ),
  );
  return {
    appliedVersions: integrityOk ? readAppliedSchemaVersions(db) : [],
    expectedVersions,
    integrityOk,
  };
}

/** Live database-vs-code schema signal, computed on demand. */
export function getLiveRestoreOutcomeSignal(
  db: any,
  migrationsDir?: string,
): RestoreOutcomeSignal {
  return classifyRestoreOutcome(readRestoreSnapshot(db, migrationsDir));
}

let recordedSignal: RestoreOutcomeSignal | null = null;

/**
 * Records the outcome observed when the database was opened. This is a *record*
 * of the startup schema check (the point at which a restore takes effect), not
 * a continuously recomputed gauge, so a `transient_delay` stays visible for the
 * life of the process that caught the database up.
 */
export function recordRestoreOutcome(
  signal: RestoreOutcomeSignal,
): RestoreOutcomeSignal {
  recordedSignal = signal;
  return signal;
}

/** The most recently recorded restore outcome, or null if none was recorded. */
export function getRecordedRestoreOutcome(): RestoreOutcomeSignal | null {
  return recordedSignal;
}

/** Test helper: clears the recorded outcome between cases. */
export function resetRecordedRestoreOutcome(): void {
  recordedSignal = null;
}

/**
 * Publishes the outcome to Prometheus so alerting does not have to re-derive it
 * from raw state. Returns null when nothing has been recorded yet.
 */
export function refreshRestoreMetrics(
  signal?: RestoreOutcomeSignal,
): RestoreOutcomeSignal | null {
  const current = signal ?? recordedSignal;
  if (!current) {
    return null;
  }
  sqliteRestoreOutcomeGauge.set(current.outcomeCode);
  return current;
}
