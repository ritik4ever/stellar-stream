#!/usr/bin/env bash
# Exercises scripts/sqlite-backup.sh against a real SQLite database while a
# concurrent writer is actively inserting rows.
#
# sqlite-backup.test.sh stubs out the `sqlite3` binary to test the wrapper
# script's own control flow (argument checks, temp-file cleanup, atomic
# publish). It never touches real SQLite locking or WAL behavior, so it
# cannot confirm the claim documented in sqlite-backup.sh and RUNBOOK.md:
# "SQLite's online backup API is safe during active writes." This test uses
# the real sqlite3 CLI to confirm that claim directly, from a fresh checkout,
# with no undocumented local state — see RUNBOOK.md, "Taking a backup".
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/sqlite-backup.sh"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "SKIP: sqlite3 CLI not found on PATH; this test requires the real binary to exercise live-write behavior."
  exit 0
fi

WORK="$(mktemp -d)"
WRITER_PID=""

cleanup() {
  if [[ -n "$WRITER_PID" ]] && kill -0 "$WRITER_PID" 2>/dev/null; then
    kill "$WRITER_PID" 2>/dev/null
    wait "$WRITER_PID" 2>/dev/null
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

db="$WORK/live.db"
target="$WORK/backup.db"

sqlite3 "$db" <<'SQL'
PRAGMA journal_mode=WAL;
CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT);
SQL

passed=0
failed=0

# Continuously write to the live database for the life of this test, so the
# backup below genuinely races against in-flight writes rather than a quiet
# database.
writer() {
  local i=0
  while true; do
    i=$((i + 1))
    sqlite3 "$db" "INSERT INTO events (payload) VALUES ('row-$i');" >/dev/null 2>&1
  done
}
writer &
WRITER_PID=$!

# Give the writer a head start so it has already produced rows before the
# backup starts.
sleep 0.3

if DB_PATH="$db" SQLITE_BACKUP_PATH="$target" bash "$SCRIPT" >"$WORK/backup.out" 2>&1; then
  echo "ok - backup completed while writes were in flight"
  passed=$((passed + 1))
else
  echo "not ok - backup script failed during active writes"
  cat "$WORK/backup.out"
  failed=$((failed + 1))
fi

if [[ -n "$WRITER_PID" ]] && kill -0 "$WRITER_PID" 2>/dev/null; then
  kill "$WRITER_PID" 2>/dev/null
  wait "$WRITER_PID" 2>/dev/null
fi
WRITER_PID=""

if [[ -f "$target" ]]; then
  echo "ok - backup file was created"
  passed=$((passed + 1))
else
  echo "not ok - backup file missing"
  failed=$((failed + 1))
fi

integrity="$(sqlite3 "$target" 'PRAGMA integrity_check;' 2>/dev/null || true)"
if [[ "$integrity" == "ok" ]]; then
  echo "ok - backup passes integrity check"
  passed=$((passed + 1))
else
  echo "not ok - backup failed integrity check: $integrity"
  failed=$((failed + 1))
fi

backup_rows="$(sqlite3 "$target" 'SELECT COUNT(*) FROM events;' 2>/dev/null || echo -1)"
live_rows="$(sqlite3 "$db" 'SELECT COUNT(*) FROM events;' 2>/dev/null || echo -1)"
if [[ "$backup_rows" =~ ^[0-9]+$ ]] && [[ "$live_rows" =~ ^[0-9]+$ ]] \
  && (( live_rows > 0 )) && (( backup_rows <= live_rows )); then
  echo "ok - backup is a consistent point-in-time snapshot ($backup_rows of $live_rows rows written so far)"
  passed=$((passed + 1))
else
  echo "not ok - backup row count ($backup_rows) is not a valid snapshot of the live count ($live_rows)"
  failed=$((failed + 1))
fi

# The live database itself must still be healthy: an online backup must never
# perturb the source it reads from while writes continue against it.
live_integrity="$(sqlite3 "$db" 'PRAGMA integrity_check;' 2>/dev/null || true)"
if [[ "$live_integrity" == "ok" ]]; then
  echo "ok - live database remains healthy after the backup"
  passed=$((passed + 1))
else
  echo "not ok - live database integrity check failed: $live_integrity"
  failed=$((failed + 1))
fi

printf '\nsqlite-backup live-write tests: %d passed, %d failed\n' "$passed" "$failed"
(( failed == 0 ))
