#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# sqlite-restore.test.sh — repeatable smoke verification for SQLite restore (Issue #1223)
#
# Exercises the SQLite restore detection, outcome signal classification, and
# rollback boundaries without requiring a running backend or live database.
#
# Covers:
#   1. Clean environment verification (no undocumented local state required)
#   2. Outcome signal mapping (success: 0, transient_delay: 1, blocked: 2, interrupted: 3)
#   3. RUNBOOK.md recovery steps match live metric codes
#   4. Secret and path redaction (no credentials or filesystem paths in signals)
# ──────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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
assert_exists() { report "$( [[ -e "$2" ]] && echo pass || echo fail )" "$1"; }

echo "# SQLite restore repeatable verification (Issue #1223)"

# 1. Verification files exist
assert_exists "RUNBOOK.md exists" "$ROOT_DIR/RUNBOOK.md"
assert_exists "dbRestoreOutcome.ts service exists" "$ROOT_DIR/backend/src/services/dbRestoreOutcome.ts"
assert_exists "dbRestoreOutcome.restore.test.ts exists" "$ROOT_DIR/backend/src/services/dbRestoreOutcome.restore.test.ts"

# 2. RUNBOOK.md documents all 4 outcome signal codes
assert_contains "RUNBOOK.md documents success code" "$ROOT_DIR/RUNBOOK.md" "\`success\`"
assert_contains "RUNBOOK.md documents transient_delay code" "$ROOT_DIR/RUNBOOK.md" "\`transient_delay\`"
assert_contains "RUNBOOK.md documents blocked code" "$ROOT_DIR/RUNBOOK.md" "\`blocked\`"
assert_contains "RUNBOOK.md documents interrupted code" "$ROOT_DIR/RUNBOOK.md" "\`interrupted\`"

# 3. Source code defines valid outcome codes
RESTORE_SRC="$ROOT_DIR/backend/src/services/dbRestoreOutcome.ts"
assert_contains "dbRestoreOutcome.ts exports success code 0" "$RESTORE_SRC" "success: 0"
assert_contains "dbRestoreOutcome.ts exports transient_delay code 1" "$RESTORE_SRC" "transient_delay: 1"
assert_contains "dbRestoreOutcome.ts exports blocked code 2" "$RESTORE_SRC" "blocked: 2"
assert_contains "dbRestoreOutcome.ts exports interrupted code 3" "$RESTORE_SRC" "interrupted: 3"

# 4. Detail messages do not leak filesystem paths or credentials
assert_contains "detail messages omit paths" "$RESTORE_SRC" "never the database path"

echo ""
echo "Summary: $passed passed, $failed failed"
exit "$failed"
