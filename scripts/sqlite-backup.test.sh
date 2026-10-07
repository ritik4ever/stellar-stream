#!/usr/bin/env bash
# Exercises scripts/sqlite-backup.sh against a stub sqlite3 so the interruption,
# retry-boundary and rollback paths are testable without a live database.
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/sqlite-backup.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

passed=0
failed=0

report() {
  local status="$1" name="$2" detail="${3:-}"
  if [[ "$status" == pass ]]; then
    echo "ok - $name"
    passed=$((passed + 1))
  else
    echo "not ok - $name${detail:+ — $detail}"
    failed=$((failed + 1))
  fi
}

assert_eq() { report "$( [[ "$2" == "$3" ]] && echo pass || echo fail )" "$1" "expected [$3], got [$2]"; }
assert_contains() { report "$( grep -Fq -- "$3" "$2" && echo pass || echo fail )" "$1" "[$3] missing from output"; }
assert_content() { report "$( [[ -f "$2" && "$(cat "$2")" == "$3" ]] && echo pass || echo fail )" "$1" "wanted [$3]"; }
assert_exists() { report "$( [[ -e "$2" ]] && echo pass || echo fail )" "$1"; }
assert_absent() { report "$( [[ ! -e "$2" ]] && echo pass || echo fail )" "$1"; }
assert_not_contains() { report "$( grep -Fq -- "$3" "$2" && echo fail || echo pass )" "$1" "[$3] unexpectedly present"; }

count_calls() {
  local n
  n="$(grep -c -- "$2" "$1" 2>/dev/null)" || n=0
  printf '%s' "${n:-0}"
}

backup_attempts() { count_calls "$WORK/$1.log" '.backup'; }
leftovers() { find "$WORK" -maxdepth 1 -type f -name '.sqlite-backup.*' | wc -l | tr -d '[:space:]'; }

# The stub sees one file argument plus either an online .backup command or a
# PRAGMA integrity_check. Modes decide whether a snapshot succeeds, is truncated,
# or fails verification. STUB_BAD_PATH marks one file as damaged, so a snapshot can
# look healthy before publication and unhealthy afterwards.
cat >"$WORK/sqlite3" <<'STUB'
#!/usr/bin/env bash
set -uo pipefail
printf '%s\n' "$*" >>"$STUB_LOG"

# sqlite3 is called as: sqlite3 <file> ".timeout <ms>" ".backup '<dest>'"
# or as:                sqlite3 <file> "PRAGMA integrity_check;"
snapshot_dest=''
for arg in "$@"; do
  case "$arg" in
    ".backup "*) snapshot_dest="${arg#.backup }" ;;
    *"PRAGMA integrity_check;"*)
      if [[ -n "${STUB_BAD_PATH:-}" && "$1" == "$STUB_BAD_PATH" ]]; then
        echo 'database disk image is malformed'
      elif [[ "${STUB_MODE:-}" == "integrity-fail" ]]; then
        echo 'database disk image is malformed'
      else
        echo ok
      fi
      exit 0
      ;;
  esac
done
snapshot_dest="${snapshot_dest#\'}"
snapshot_dest="${snapshot_dest%\'}"

case "${STUB_MODE:-}" in
  backup-fail) exit 1 ;;
  locked)
    echo 'Error: cannot begin a read transaction - database is locked' >&2
    exit 1
    ;;
  empty-snapshot)
    : >"$snapshot_dest"
    exit 0
    ;;
  fail-once)
    if [[ ! -f "${STUB_STATE:-}" ]]; then
      printf 'tried\n' >"$STUB_STATE"
      exit 1
    fi
    ;;
esac
if [[ -n "$snapshot_dest" ]]; then
  printf 'verified snapshot\n' >"$snapshot_dest"
fi
STUB
chmod +x "$WORK/sqlite3"

db="$WORK/live.db"
target="$WORK/backup.db"
printf 'live database\n' >"$db"

# run_backup <name> <mode> <expected-exit> <destination> [KEY=VAL ...]
# Retry delays are zeroed so the suite stays fast; the retry budget itself is
# what the cases assert.
run_backup() {
  local name="$1" mode="$2" expected="$3" destination="$4"
  shift 4
  local rc=0
  env STUB_LOG="$WORK/$name.log" STUB_MODE="$mode" SQLITE_COMMAND="$WORK/sqlite3" \
    DB_PATH="$db" SQLITE_BACKUP_PATH="$destination" \
    SQLITE_BACKUP_RETRY_DELAY_SECONDS=0 SQLITE_BACKUP_RETRIES=0 \
    SQLITE_BACKUP_STALE_MINUTES=60 "$@" \
    bash "$SCRIPT" >"$WORK/$name.out" 2>&1 || rc=$?
  assert_eq "$name: exit $expected" "$rc" "$expected"
}

# run_raw <name> <expected-exit> <script args...> — for --verify and preflight
# cases that must control every variable explicitly.
run_raw() {
  local name="$1" expected="$2"
  shift 2
  local rc=0
  env STUB_LOG="$WORK/$name.log" SQLITE_COMMAND="$WORK/sqlite3" "${STUB_ENV[@]}" \
    bash "$SCRIPT" "$@" >"$WORK/$name.out" 2>&1 || rc=$?
  assert_eq "$name: exit $expected" "$rc" "$expected"
}

# ── a healthy backup reaches a verified state ────────────────────────────────
run_backup verified ok 0 "$target"
assert_content verified_wrote_snapshot "$target" 'verified snapshot'
assert_contains verified_reports_pass "$WORK/verified.out" 'RESULT: PASS'
assert_eq verified_no_temp_files_left "$(leftovers)" '0'

# ── interrupted before completion: destination preserved, rollback stated ─────
printf 'known-good snapshot\n' >"$target"
run_backup interrupted backup-fail 1 "$target"
assert_content interrupted_keeps_previous_backup "$target" 'known-good snapshot'
assert_contains interrupted_states_rollback "$WORK/interrupted.out" 'ROLLBACK:'
assert_contains interrupted_names_restorable_file "$WORK/interrupted.out" "$target"
assert_eq interrupted_no_temp_files_left "$(leftovers)" '0'

printf 'known-good snapshot\n' >"$target"
run_backup corrupt integrity-fail 1 "$target"
assert_content corrupt_keeps_previous_backup "$target" 'known-good snapshot'

printf 'known-good snapshot\n' >"$target"
run_backup truncated empty-snapshot 1 "$target"
assert_content empty_snapshot_never_published "$target" 'known-good snapshot'

run_backup locked_outage locked 1 "$WORK/never-created.db"
assert_contains lock_is_classified "$WORK/locked_outage.out" 'database locked'

# ── safe retry boundaries ────────────────────────────────────────────────────
run_backup retry_recovers fail-once 0 "$target" \
  "STUB_STATE=$WORK/attempt-state" "SQLITE_BACKUP_RETRIES=2"
assert_contains retry_is_announced "$WORK/retry_recovers.out" 'retry 1/2'
assert_contains retry_reaches_verified_state "$WORK/retry_recovers.out" 'RESULT: PASS'
rm -f "$WORK/attempt-state"

run_backup retry_exhausted backup-fail 1 "$target" "SQLITE_BACKUP_RETRIES=2"
assert_eq retry_budget_is_1_initial_plus_2_retries "$(backup_attempts retry_exhausted)" '3'
assert_contains exhausted_reports_attempts "$WORK/retry_exhausted.out" 'after 3 attempt(s)'

STUB_ENV=(STUB_MODE=ok DB_PATH="$WORK/missing.db" SQLITE_BACKUP_RETRIES=5
  SQLITE_BACKUP_RETRY_DELAY_SECONDS=0 SQLITE_BACKUP_STALE_MINUTES=60)
run_raw preflight_missing_db 2 "$target"
assert_eq preflight_is_never_retried "$(backup_attempts preflight_missing_db)" '0'
assert_contains preflight_says_not_retryable "$WORK/preflight_missing_db.out" \
  'no backup was attempted (not retryable)'

STUB_ENV=(STUB_MODE=ok DB_PATH="$db" SQLITE_BACKUP_RETRIES=soon)
run_raw bad_retry_tunable 2 "$target"
assert_contains bad_tunable_names_the_variable "$WORK/bad_retry_tunable.out" 'SQLITE_BACKUP_RETRIES'

STUB_ENV=(STUB_MODE=ok DB_PATH="$db" SQLITE_BACKUP_TIMEOUT_MS=-1)
run_raw bad_timeout_tunable 2 "$target"
assert_contains bad_timeout_names_the_variable "$WORK/bad_timeout_tunable.out" 'SQLITE_BACKUP_TIMEOUT_MS'

# ── a published file that turns out unhealthy is rolled back ─────────────────
printf 'known-good snapshot\n' >"$target"
run_backup publish_unhealthy ok 1 "$target" "STUB_BAD_PATH=$target"
assert_content unhealthy_publish_rolled_back "$target" 'known-good snapshot'
assert_contains rollback_confirmed "$WORK/publish_unhealthy.out" 'previous backup has been restored'
assert_eq unhealthy_publish_no_temp_files_left "$(leftovers)" '0'

rm -f "$target"
run_backup publish_unhealthy_first ok 1 "$target" "STUB_BAD_PATH=$target"
assert_absent unhealthy_first_backup_removed "$target"
assert_contains first_backup_rollback_note "$WORK/publish_unhealthy_first.out" 'live database was never modified'

# ── detecting a backup interrupted by a killed process ───────────────────────
stale_dir="$WORK/stale"
mkdir -p "$stale_dir"
printf 'interrupted mid-copy\n' >"$stale_dir/.sqlite-backup.stalemarker"
touch -d '3 hours ago' "$stale_dir/.sqlite-backup.stalemarker"
run_backup stale_detected ok 0 "$stale_dir/backup.db"
assert_contains leftover_is_reported "$WORK/stale_detected.out" 'interrupted before completion'
assert_exists leftover_is_not_deleted "$stale_dir/.sqlite-backup.stalemarker"

STUB_ENV=(STUB_MODE=ok DB_PATH="$db" SQLITE_BACKUP_STALE_MINUTES=100000)
run_raw stale_ignored_when_recent 0 "$stale_dir/second.db"
assert_not_contains young_snapshot_not_reported "$WORK/stale_ignored_when_recent.out" 'stale snapshot file'

# ── verifying an existing backup file ────────────────────────────────────────
printf 'verified snapshot\n' >"$target"
STUB_ENV=(STUB_MODE=ok)
run_raw verify_healthy 0 --verify "$target"
assert_contains verify_names_the_file "$WORK/verify_healthy.out" "$target"

STUB_ENV=(STUB_MODE=ok "STUB_BAD_PATH=$target")
run_raw verify_damaged 1 --verify "$target"
assert_contains verify_states_rollback "$WORK/verify_damaged.out" 'ROLLBACK:'

STUB_ENV=(STUB_MODE=ok)
run_raw verify_missing 2 --verify "$WORK/does-not-exist.db"

# ── unrelated behaviour is preserved ─────────────────────────────────────────
STUB_ENV=(STUB_MODE=ok DB_PATH="$db" DATABASE_URL=postgres://redacted SQLITE_BACKUP_RETRIES=2
  SQLITE_BACKUP_RETRY_DELAY_SECONDS=0 SQLITE_BACKUP_STALE_MINUTES=60)
run_raw postgres_configured 2 "$target"
assert_contains postgres_is_rejected "$WORK/postgres_configured.out" 'PostgreSQL'
assert_eq postgres_never_opens_sqlite "$(backup_attempts postgres_configured)" '0'

run_backup source_is_destination ok 2 "$db"
assert_contains self_backup_refused "$WORK/source_is_destination.out" 'must differ from DB_PATH'

run_backup destination_is_directory ok 2 "$WORK"
assert_contains directory_destination_refused "$WORK/destination_is_directory.out" 'not a directory'

run_backup no_destination ok 2 ''
assert_contains missing_destination_refused "$WORK/no_destination.out" 'backup destination is required'

printf '\nsqlite-backup tests: %d passed, %d failed\n' "$passed" "$failed"
((failed == 0))
