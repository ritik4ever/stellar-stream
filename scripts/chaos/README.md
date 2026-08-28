# Chaos Tests (`scripts/chaos/`)

Chaos tests simulate real failure conditions against the running backend to
verify the system recovers correctly.

## Indexer kill / restart / WAL recovery

`indexer-kill-restart.ts` SIGKILLs the indexer worker mid-poll, restarts it,
and asserts:

1. **No duplicate events after restart** — `stream_events` dedup relies on
   `INSERT OR IGNORE` plus the unique index on
   `(stream_id, event_type, ledger_sequence)`. The test verifies row count
   equals the distinct-event count and that every stored row matches the
   on-chain log exactly once.
2. **SQLite WAL recovery is tested explicitly** — after the crash the script
   inspects the `-wal` / `-shm` sidecar files, reopens the DB (WAL replay),
   runs `PRAGMA integrity_check` and `PRAGMA wal_checkpoint(TRUNCATE)`, and
   confirms the checkpoint advanced past the point of the crash.
3. **Runnable via `npm run test:chaos`** — exit code 0 on success, 1 on failure.

### How it works

- A fresh WAL-mode SQLite DB is created with the real migrations and seeded
  streams + an `indexer_cursor` checkpoint.
- A local HTTPS mock of the Soroban RPC (`mock-rpc.ts`) serves a deterministic
  batch of `Created` / `Claimed` contract events, paginated like a real node.
  Later pages are delayed so the kill lands mid-poll.
- A child process (`chaos-indexer-worker.ts`) runs the **real** indexer
  (`backend/src/services/indexer.ts`) against that DB and RPC.
- The parent kills the child with `SIGKILL` after the first page commits but
  before the checkpoint is saved, then restarts it and runs the assertions.

### Running

```bash
npm run test:chaos
```

Requires backend dependencies to be installed (`npm run install:all`) and
`openssl` on the PATH (used to generate the mock RPC's self-signed TLS cert).
