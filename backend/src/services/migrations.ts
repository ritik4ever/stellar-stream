import fs from "fs";
import path from "path";

export interface Migration {
  version: number;
  name: string;
  upPath: string;
  downPath: string;
}

export function getMigrationsDir(): string {
  return path.join(__dirname, "..", "..", "migrations");
}

export function discoverMigrations(migrationsDir: string): Migration[] {
  const files = fs.readdirSync(migrationsDir);
  const upFiles = files
    .filter((file) => /^\d{3}_[\w.]+\.sql$/.test(file) && !file.endsWith(".down.sql"))
    .sort();

  return upFiles.map((upFile) => {
    const match = upFile.match(/^(\d{3})_(.+)\.sql$/);
    if (!match) {
      throw new Error(`Invalid migration filename: ${upFile}`);
    }

    const version = parseInt(match[1], 10);
    const name = match[2];
    const downFile = `${match[1]}_${name}.down.sql`;
    const downPath = path.join(migrationsDir, downFile);

    if (!fs.existsSync(downPath)) {
      throw new Error(`Missing rollback script: ${downFile}`);
    }

    return {
      version,
      name,
      upPath: path.join(migrationsDir, upFile),
      downPath,
    };
  });
}

function loadMigrationSql(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

function ensureSchemaMigrationsTable(db: any): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  INTEGER NOT NULL
    );
  `);
}

function getAppliedVersions(db: any): Set<number> {
  const rows = db
    .prepare("SELECT version FROM schema_migrations ORDER BY version")
    .all() as Array<{ version: number }>;
  return new Set(rows.map((row) => row.version));
}

function hasExistingSchema(db: any): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'streams'")
    .get();
  return !!row;
}

function seedBaselineMigrations(db: any, migrations: Migration[]): void {
  const now = Math.floor(Date.now() / 1000);
  const insert = db.prepare(
    "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)"
  );

  db.transaction(() => {
    for (const migration of migrations) {
      insert.run(migration.version, migration.name, now);
    }
  })();
}

function applyMigration(db: any, migration: Migration): void {
  const upSql = loadMigrationSql(migration.upPath);
  db.transaction(() => {
    db.exec(upSql);
    db.prepare(
      "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)"
    ).run(migration.version, migration.name, Math.floor(Date.now() / 1000));
  })();
}

export function runMigrations(db: any, migrationsDir?: string): void {
  const dir = migrationsDir ?? getMigrationsDir();
  const migrations = discoverMigrations(dir);

  ensureSchemaMigrationsTable(db);
  const applied = getAppliedVersions(db);

  if (applied.size === 0 && hasExistingSchema(db)) {
    seedBaselineMigrations(db, migrations);
    return;
  }

  for (const migration of migrations) {
    if (!applied.has(migration.version)) {
      applyMigration(db, migration);
    }
  }
}

export function rollbackMigration(
  db: any,
  version: number,
  migrationsDir?: string
): void {
  const dir = migrationsDir ?? getMigrationsDir();
  const migrations = discoverMigrations(dir);
  const migration = migrations.find((entry) => entry.version === version);

  if (!migration) {
    throw new Error(`Migration version ${version} not found`);
  }

  const applied = getAppliedVersions(db);
  if (!applied.has(version)) {
    throw new Error(`Migration version ${version} has not been applied`);
  }

  const downSql = loadMigrationSql(migration.downPath);
  db.transaction(() => {
    db.exec(downSql);
    db.prepare("DELETE FROM schema_migrations WHERE version = ?").run(version);
  })();
}

export function getTableColumns(db: any, table: string): string[] {
  const columns = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return columns.map((column) => column.name);
}
