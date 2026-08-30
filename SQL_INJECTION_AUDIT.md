# SQL Injection Audit (#777)

## Scope

All database access in `backend/src/services/db.ts`, `backend/src/index.ts`,
and every service under `backend/src/services/` that calls
`better-sqlite3`'s `.prepare()` / `.exec()`.

## Method

1. Enumerated every `.prepare(...)` and `db.exec(...)` call site
   (58 call sites across `streamStore.ts`, `eventHistory.ts`, `indexer.ts`,
   `webhook.ts`, `webhookWorker.ts`, `metricsHistory.ts`, `migrations.ts`,
   `stats.ts`, `streamMetrics.ts`, `reconciliationJob.ts`, and `index.ts`).
2. For each call site, checked whether any part of the SQL string is built
   from request/user-controlled data (query params, path params, body
   fields) via string concatenation or template-literal interpolation.
3. For call sites that build SQL dynamically (conditional `WHERE` clauses,
   `ORDER BY` direction/column), verified the *values* are always bound as
   parameters and only a closed set of hardcoded/allowlisted tokens are
   ever interpolated into the SQL text itself.
4. Added `backend/src/services/sqlInjection.integration.test.ts`, which
   feeds classic SQLi payloads (`' OR '1'='1`, `'; DROP TABLE streams; --`,
   `' UNION SELECT * FROM streams --`, etc.) through every user-controlled
   string input reachable from a store/service function (recipient/sender
   address, stream ID, actor, event-type filter) and asserts the payload is
   treated as inert plain text and the schema/data stays intact.

## Findings

**No raw string interpolation of user-controlled data into SQL was found.**
Every query that accepts external input uses `?` positional or `@name`
named bind parameters. The only template-literal interpolations found are:

| File | Line(s) | Interpolated value | Source | Risk |
|------|---------|---------------------|--------|------|
| `streamStore.ts` | `buildOrderClause` (~1017-1021), used at 1027-1046 | SQL column name + `ASC`/`DESC` | `SORT_COLUMNS` allowlist keyed by a typed `SortField` union, and a ternary that can only produce `"ASC"` or `"DESC"` | None — not attacker-controlled, closed set |
| `eventHistory.ts` | `getStreamHistory` (line 87) | `ASC`/`DESC` | ternary on `order === 'asc'` | None — closed set |
| `indexer.ts` | 119, 138, 143, 147 | `INDEXER_CURSOR_TABLE` | module-level `const`, never derived from input | None |
| `stats.ts` | 43, 102 | none — static SQL text with `:now` named parameter | n/a | None |

All other dynamic query builders (`eventHistory.getAllEvents`,
`getGlobalEvents`, `countAllEvents`) build the `WHERE` clause by pushing
literal condition fragments like `"event_type = ?"` onto an array and
joining with `" AND "` — the *values* (`eventType`, `streamId`, `cursor`,
`since`) are always pushed to a separate `params` array and passed to
`.all(...params)` / `.get(...params)`, never into the SQL string.

## Conclusion

The audit found the codebase already follows parameterized-query best
practice everywhere. No code changes were required to close an injection
gap. This PR adds:

- `backend/src/services/sqlInjection.integration.test.ts` — regression
  tests asserting SQLi payloads are stored/matched as plain text via
  `listStreamsByRecipient`, `listStreamsBySender`, `getStreamHistory`,
  `getGlobalEvents`, and `countAllEvents`, and that the `streams` table
  is never dropped or bypassed.
- This document, as the audit record requested by the issue.

## Recommendation

Keep using `@name` / `?` bindings for all future queries (per
`CLAUDE.md`'s "Code Patterns" section) and keep any dynamic `ORDER BY`
input behind an explicit allowlist like `SORT_COLUMNS`, never accept a raw
column/direction string from a request.
