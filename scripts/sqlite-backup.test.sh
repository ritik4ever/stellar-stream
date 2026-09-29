#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/sqlite-backup.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

passed=0
failed=0

cat >"$WORK/sqlite3" <<'STUB'
#!/usr/bin/env bash
set -uo pipefail
printf '%s\n' "$*" >>"$STUB_LOG"
if [[ "$STUB_MODE" == "backup-fail" ]]; then exit 1; fi
if [[ "$STUB_MODE" == "integrity-fail" ]]; then
  if [[ "$*" == *"PRAGMA integrity_check;"* ]]; then echo 'database disk image is malformed'; exit 0; fi
fi
if [[ "$*" == *".backup '*" ]]; then
  destination="${*: -1}"
  destination="${destination#\'.backup \'}"
  destination="${destination%\'}"
  printf 'verified snapshot\n' >"$destination"
else
  echo ok
fi
STUB
chmod +x "$WORK/sqlite3"

db="$WORK/live.db"
target="$WORK/backup.db"
printf 'live database\n' >"$db"

run_case() {
  local name="$1" mode="$2" expected="$3" destination="$4"
  STUB_LOG="$WORK/$name.log" STUB_MODE="$mode" SQLITE_COMMAND="$WORK/sqlite3" \
    DB_PATH="$db" SQLITE_BACKUP_PATH="$destination" bash "$SCRIPT" >"$WORK/$name.out" 2>&1
  rc=$?
  if (( rc != expected )); then
    echo "not ok - $name: expected exit $expected, got $rc"
    cat "$WORK/$name.out"
    failed=$((failed + 1))
    return
  fi
  echo "ok - $name"
  passed=$((passed + 1))
}

run_case verified ok 0 "$target"
if [[ ! -f "$target" ]]; then echo "not ok - verified backup: destination missing"; failed=$((failed + 1)); fi

rm -f "$target"
printf 'known-good snapshot\n' >"$target"
run_case interrupted backup-fail 2 "$target"
if [[ "$(cat "$target")" != 'known-good snapshot' ]]; then
  echo "not ok - interrupted backup: existing destination changed"; failed=$((failed + 1))
fi

printf 'known-good snapshot\n' >"$target"
run_case corrupt integrity-fail 2 "$target"
if [[ "$(cat "$target")" != 'known-good snapshot' ]]; then
  echo "not ok - corrupt backup: existing destination changed"; failed=$((failed + 1))
fi

DATABASE_URL=postgres://redacted SQLITE_COMMAND="$WORK/sqlite3" DB_PATH="$db" \
  bash "$SCRIPT" "$target" >"$WORK/postgres.out" 2>&1
if (( $? != 2 )) && grep -q 'PostgreSQL' "$WORK/postgres.out"; then
  echo 'not ok - PostgreSQL configuration was accepted'; failed=$((failed + 1))
else
  echo 'ok - PostgreSQL configuration rejected'; passed=$((passed + 1))
fi

printf '\nsqlite-backup tests: %d passed, %d failed\n' "$passed" "$failed"
(( failed == 0 ))
