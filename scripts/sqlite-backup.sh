#!/usr/bin/env bash
# Create a consistent SQLite backup while the database may be receiving writes.
# The backup is written to a temporary file, integrity-checked, then atomically
# moved into place so an interrupted backup can never replace a valid snapshot.
set -uo pipefail

DB_FILE="${DB_PATH:-backend/data/streams.db}"
BACKUP_FILE="${1:-${SQLITE_BACKUP_PATH:-}}"
SQLITE_COMMAND="${SQLITE_COMMAND:-sqlite3}"

fail() {
  printf '[sqlite-backup] FAIL: %s\n' "$*" >&2
  exit 2
}

if [[ -n "${DATABASE_URL:-}" ]]; then
  fail 'DATABASE_URL is configured; use the PostgreSQL backup procedure instead of SQLite'
fi
[[ -n "$BACKUP_FILE" ]] || fail 'backup destination is required (pass a path or set SQLITE_BACKUP_PATH)'
[[ -f "$DB_FILE" ]] || fail 'DB_PATH must point to an existing SQLite database file'
[[ -r "$DB_FILE" ]] || fail 'DB_PATH must point to a readable SQLite database file'
command -v "$SQLITE_COMMAND" >/dev/null 2>&1 || fail 'sqlite3 is required to create an online backup'

backup_dir="$(dirname -- "$BACKUP_FILE")"
[[ -d "$backup_dir" ]] || fail 'backup destination directory does not exist'
[[ -w "$backup_dir" ]] || fail 'backup destination directory is not writable'

source_real="$(readlink -f -- "$DB_FILE" 2>/dev/null || printf '%s' "$DB_FILE")"
target_real="$(readlink -m -- "$BACKUP_FILE" 2>/dev/null || printf '%s' "$BACKUP_FILE")"
[[ "$source_real" != "$target_real" ]] || fail 'backup destination must differ from DB_PATH'

tmp_file="$(mktemp "$backup_dir/.sqlite-backup.XXXXXX")" || fail 'could not allocate a temporary backup file'
cleanup() { rm -f -- "$tmp_file"; }
trap cleanup EXIT

# SQLite's online backup API is safe during active writes and produces a
# checkpointed snapshot without requiring the backend to stop.
if ! "$SQLITE_COMMAND" "$DB_FILE" ".timeout 5000" ".backup '$tmp_file'" >/dev/null 2>&1; then
  fail 'SQLite online backup did not complete; the existing destination was preserved'
fi

integrity_result="$("$SQLITE_COMMAND" "$tmp_file" 'PRAGMA integrity_check;' 2>/dev/null || true)"
if [[ "$integrity_result" != "ok" ]]; then
  fail 'backup integrity check failed; the existing destination was preserved'
fi

mv -f -- "$tmp_file" "$BACKUP_FILE" || fail 'could not publish the verified backup'
trap - EXIT
printf '[sqlite-backup] RESULT: PASS — verified SQLite backup created\n'
