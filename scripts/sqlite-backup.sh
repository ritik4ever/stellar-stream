#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# sqlite-backup.sh — take a SQLite backup that is safe during active writes and
# either reach a verified healthy state or stop with a clear rollback.
#
# Phases:
#   1. Preflight   — configuration, source, destination and stale-snapshot
#                    checks. These are never retried: a retry cannot fix them.
#   2. Snapshot    — SQLite's online backup API into a temporary file beside the
#                    destination, so an interrupted run never touches it.
#   3. Verify      — the snapshot must be non-empty and pass
#                    PRAGMA integrity_check before it can be published.
#   4. Publish     — atomic rename; the previous backup is copied first so it
#                    can be put back.
#   5. Confirm     — the published file is re-checked. If it is not healthy the
#                    previous backup is restored and the failure is reported.
#   6. Retry       — phases 2–3 are retried at most SQLITE_BACKUP_RETRIES times
#                    with SQLITE_BACKUP_RETRY_DELAY_SECONDS between attempts.
#                    Running out of attempts is a stop, not an infinite loop.
#
# Modes:
#   sqlite-backup.sh <destination>          take a verified backup
#   sqlite-backup.sh --verify <backup>      health-check an existing backup file
#
# Exit codes: 0 verified healthy,
#             1 backup interrupted or unverified after retries (rollback stated),
#             2 preflight/configuration failed (nothing was written).
#
# Tunables (environment variables):
#   DB_PATH                              source database            (backend/data/streams.db)
#   SQLITE_BACKUP_PATH                   destination, if no argument is given
#   SQLITE_COMMAND                       sqlite3 binary             (sqlite3)
#   SQLITE_BACKUP_TIMEOUT_MS             busy timeout per attempt   (5000)
#   SQLITE_BACKUP_RETRIES                retries after attempt 1    (2)
#   SQLITE_BACKUP_RETRY_DELAY_SECONDS    wait between attempts      (3)
#   SQLITE_BACKUP_STALE_MINUTES          age at which a leftover temporary file is reported (60)
# ──────────────────────────────────────────────────────────────────────────────
set -uo pipefail

DB_FILE="${DB_PATH:-backend/data/streams.db}"
SQLITE_COMMAND="${SQLITE_COMMAND:-sqlite3}"
BUSY_TIMEOUT_MS="${SQLITE_BACKUP_TIMEOUT_MS:-5000}"
MAX_RETRIES="${SQLITE_BACKUP_RETRIES:-2}"
RETRY_DELAY="${SQLITE_BACKUP_RETRY_DELAY_SECONDS:-3}"
STALE_MINUTES="${SQLITE_BACKUP_STALE_MINUTES:-60}"

log() { printf '[sqlite-backup] %s\n' "$*"; }

# A configuration problem: nothing has been opened or written yet.
fail_config() {
  printf '[sqlite-backup] FAIL: %s\n' "$*" >&2
  printf '[sqlite-backup] RESULT: FAIL — preflight failed, no backup was attempted (not retryable)\n' >&2
  exit 2
}

# The backup did not reach a verified healthy state. The caller states the
# rollback so an operator never has to guess what is safe to delete.
fail_interrupted() {
  printf '[sqlite-backup] FAIL: %s\n' "$1" >&2
  printf '[sqlite-backup] ROLLBACK: %s\n' "$2" >&2
  printf '[sqlite-backup] RESULT: FAIL — backup not published; complete the rollback step above\n' >&2
  exit 1
}

is_uint() { [[ "$1" =~ ^[0-9]+$ ]]; }

validate_uint() {
  is_uint "$2" || fail_config "$1 must be a non-negative integer"
}
validate_uint SQLITE_BACKUP_TIMEOUT_MS "$BUSY_TIMEOUT_MS"
validate_uint SQLITE_BACKUP_RETRIES "$MAX_RETRIES"
validate_uint SQLITE_BACKUP_RETRY_DELAY_SECONDS "$RETRY_DELAY"
validate_uint SQLITE_BACKUP_STALE_MINUTES "$STALE_MINUTES"

if [[ -n "${DATABASE_URL:-}" ]]; then
  fail_config 'DATABASE_URL is configured; use the PostgreSQL backup procedure instead of SQLite'
fi

# ── Verify mode: health-check a backup that already exists ───────────────────
verify_snapshot() {
  local file="$1" result
  [[ -s "$file" ]] || return 1
  result="$("$SQLITE_COMMAND" "$file" 'PRAGMA integrity_check;' 2>/dev/null || true)"
  [[ "$result" == "ok" ]]
}

if [[ "${1:-}" == "--verify" ]]; then
  candidate="${2:-}"
  [[ -n "$candidate" ]] || fail_config '--verify requires a backup file path'
  [[ -f "$candidate" ]] || fail_config "no such backup file: $candidate"
  [[ -r "$candidate" ]] || fail_config "backup file is not readable: $candidate"
  command -v "$SQLITE_COMMAND" >/dev/null 2>&1 || fail_config 'sqlite3 is required to verify a backup'
  if verify_snapshot "$candidate"; then
    log "RESULT: PASS — $candidate is a complete, intact SQLite backup"
    exit 0
  fi
  printf '[sqlite-backup] FAIL: %s is not a usable SQLite backup\n' "$candidate" >&2
  printf '[sqlite-backup] ROLLBACK: stop the backend, delete this file, and restore the most recent backup that passes --verify; if none does, take a fresh online backup\n' >&2
  printf '[sqlite-backup] RESULT: FAIL — backup is interrupted or corrupt\n' >&2
  exit 1
fi

BACKUP_FILE="${1:-${SQLITE_BACKUP_PATH:-}}"
[[ -n "$BACKUP_FILE" ]] || fail_config 'backup destination is required (pass a path or set SQLITE_BACKUP_PATH)'
[[ ! -d "$BACKUP_FILE" ]] || fail_config 'backup destination must be a file path, not a directory'
[[ -f "$DB_FILE" ]] || fail_config 'DB_PATH must point to an existing SQLite database file'
[[ -r "$DB_FILE" ]] || fail_config 'DB_PATH must point to a readable SQLite database file'
command -v "$SQLITE_COMMAND" >/dev/null 2>&1 || fail_config 'sqlite3 is required to create an online backup'

backup_dir="$(dirname -- "$BACKUP_FILE")"
[[ -d "$backup_dir" ]] || fail_config 'backup destination directory does not exist'
[[ -w "$backup_dir" ]] || fail_config 'backup destination directory is not writable'

source_real="$(readlink -f -- "$DB_FILE" 2>/dev/null || printf '%s' "$DB_FILE")"
target_real="$(readlink -m -- "$BACKUP_FILE" 2>/dev/null || printf '%s' "$BACKUP_FILE")"
[[ "$source_real" != "$target_real" ]] || fail_config 'backup destination must differ from DB_PATH'

# Detection: a temporary file left beside the destination is the signature of a
# backup that was interrupted before completion. Reported, never deleted — a
# younger file may belong to a backup that is still running.
while IFS= read -r leftover; do
  [[ -n "$leftover" ]] || continue
  log "NOTE: stale snapshot file $leftover in $backup_dir is older than $STALE_MINUTES minutes — a previous backup was interrupted before completion"
  log "NOTE: after confirming no backup is running, remove it with: rm -f -- '$leftover'"
done < <(find "$backup_dir" -maxdepth 1 -type f -name '.sqlite-backup.*' -mmin +"$STALE_MINUTES" 2>/dev/null | head -n 20)

tmp_file="$(mktemp "$backup_dir/.sqlite-backup.XXXXXX")" || fail_config 'could not allocate a temporary backup file'
previous_file=''
cleanup() {
  [[ -n "$tmp_file" ]] && rm -f -- "$tmp_file"
  [[ -n "$previous_file" ]] && rm -f -- "$previous_file"
  return 0
}
trap cleanup EXIT

# ── Phases 2–3 and 6: snapshot, verify, retry ────────────────────────────────
attempt=0
reason=''
while :; do
  attempt=$((attempt + 1))
  if ((attempt > 1)); then
    log "retry $((attempt - 1))/$MAX_RETRIES in ${RETRY_DELAY}s (previous attempt: $reason)"
    sleep "$RETRY_DELAY"
    rm -f -- "$tmp_file"
  fi

  # SQLite's online backup API is safe during active writes and produces a
  # checkpointed snapshot without requiring the backend to stop.
  reason=''
  if ! snapshot_error="$("$SQLITE_COMMAND" "$DB_FILE" ".timeout $BUSY_TIMEOUT_MS" ".backup '$tmp_file'" 2>&1 >/dev/null)"; then
    if [[ "$snapshot_error" == *'database is locked'* || "$snapshot_error" == *busy* ]]; then
      reason="snapshot blocked (database locked) after ${BUSY_TIMEOUT_MS}ms"
    else
      reason="snapshot did not complete: $(printf '%s' "${snapshot_error:0:200}" | tr '\n' ' ')"
    fi
  elif [[ ! -s "$tmp_file" ]]; then
    reason='snapshot file is empty'
  elif ! verify_snapshot "$tmp_file"; then
    reason='snapshot failed PRAGMA integrity_check'
  fi
  [[ -z "$reason" ]] && break

  if ((attempt > MAX_RETRIES)); then
    fail_interrupted \
      "SQLite backup did not reach a verified state after $attempt attempt(s) — $reason" \
      "nothing was published and the partial snapshot was discarded: the previous backup at $BACKUP_FILE is untouched and still restorable (stop the backend, then cp -p -- '$BACKUP_FILE' '$DB_FILE'); safe to re-run once the cause above is resolved"
  fi
done

# ── Phase 4: publish, keeping the previous backup for rollback ───────────────
if [[ -f "$BACKUP_FILE" ]]; then
  previous_file="$(mktemp "$backup_dir/.sqlite-backup.previous.XXXXXX")" ||
    fail_interrupted 'could not allocate a rollback file' \
      "nothing was published: the previous backup at $BACKUP_FILE is untouched"
  if ! cp -p -- "$BACKUP_FILE" "$previous_file"; then
    fail_interrupted 'could not copy the existing backup for rollback' \
      "nothing was published: the previous backup at $BACKUP_FILE is untouched"
  fi
fi

if ! mv -f -- "$tmp_file" "$BACKUP_FILE"; then
  fail_interrupted 'could not publish the verified backup' \
    "the previous backup at $BACKUP_FILE is untouched and still restorable (stop the backend, then cp -p -- '$BACKUP_FILE' '$DB_FILE')"
fi
tmp_file=''

# ── Phase 5: confirm the published file, roll back if it is not healthy ──────
if ! verify_snapshot "$BACKUP_FILE"; then
  if [[ -n "$previous_file" ]]; then
    if mv -f -- "$previous_file" "$BACKUP_FILE"; then
      rollback_note="the previous backup has been restored to $BACKUP_FILE — the live database was never modified"
    else
      rollback_note="automatic restore failed; put the previous backup back yourself with: mv -f -- '$previous_file' '$BACKUP_FILE'"
    fi
  else
    rm -f -- "$BACKUP_FILE"
    rollback_note="no previous backup existed at $BACKUP_FILE, so the unverified file was removed; the live database was never modified"
  fi
  previous_file=''
  fail_interrupted 'the published backup failed post-publish verification' "$rollback_note"
fi

trap - EXIT
[[ -n "$previous_file" ]] && rm -f -- "$previous_file"
log "RESULT: PASS — verified SQLite backup at $BACKUP_FILE ($attempt attempt(s))"
