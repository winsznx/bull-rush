# ADR 0005: Versioned Postgres migrations, replacing ad hoc boot-time DDL

## Status
Accepted

## Context
Every table through Phase 4 (`runs`, `daily_grids`, `run_tickets`, `grid_runs`,
`users`, `auth_nonces`, `sessions`) was created by `initSchema()` in
`server/src/db.ts`, a function of `CREATE TABLE IF NOT EXISTS` calls run once
at server boot. This worked while the schema was small and every change was
additive, but it has real failure modes at production scale: no record of
*when* a column was added or by which change, no way to run a destructive or
multi-step change (a rename, a backfill, a `NOT NULL` addition) safely, and — the
one this migration is explicitly designed to close — two server replicas
booting concurrently racing each other's DDL. Phase 6/7/10 are about to add
several more tables (`chain_jobs`, `claims`) and this is the last point before
those additions where "just add another `CREATE TABLE IF NOT EXISTS`" stops
being defensible.

## Decision

**Migration tool: a hand-rolled SQL-file runner (`server/src/migrate.ts`), not
a library (Prisma Migrate, node-pg-migrate, Flyway).** Reasoning: the project
has exactly one raw-SQL client (`postgres`/`postgres.js`) and no ORM; pulling
in a migration library would mean either adopting its own DSL/config just for
this, or fighting it to stay on plain SQL. A ~90-line runner that reads
`server/migrations/*.sql` in sorted filename order, tracks applied filenames
in a `schema_migrations` table, and applies each file inside its own
transaction (`sql.begin()`, so a failure partway through one file rolls back
only that file, not previously-applied ones) covers everything this project
actually needs: forward-only, linear migrations, no rollback tooling (accepted
— see "What was not built" below).

**Migrations run as an explicit step, never automatically at boot.**
`assertMigrationsApplied()` is what `server/src/index.ts` calls before
`serve()` — a read-only check that throws (refusing to start) if any
migration file on disk isn't yet recorded as applied. Actually applying
pending migrations is a separate, deliberate action (`npm run db:migrate` /
`tsx src/migrate.ts`), run once by an operator or a CI/deploy step, never by
the server process itself. This is the concrete fix for the multi-replica
race: if boot ran migrations automatically, two replicas starting at once
would both try to `CREATE TABLE`/`ALTER TABLE` concurrently, and whichever
loses gets a Postgres error that looks like a crash rather than a schema
change in progress.

**Migration 0001 (`runs`) is a deliberate no-op against the real production
database.** It reproduces the exact `runs` table shape `initSchema()` used to
create (folding two `ALTER TABLE` statements — `verified`, `replay_len` — that
had accreted onto the original `CREATE TABLE` directly into one `CREATE TABLE`
statement), so that a fresh database and the real production database end up
at the identical schema, and `runs` gains a migration history going forward
without requiring a manual `INSERT INTO schema_migrations` on production to
paper over a mismatch.

**Net-new tables adopt their final correct name immediately, with no
rename-in-place migration.** `grid_runs` (Phase 3's ad hoc name) becomes
`verified_runs` (migration 0004) — not `CREATE TABLE grid_runs` followed by a
later `ALTER TABLE ... RENAME TO`. This is safe specifically because nothing
beyond local dev and CI's ephemeral service containers has ever had data in
`grid_runs`; it was never deployed to production. Renaming now, before the
name exists anywhere durable, costs nothing; renaming after a real deploy
would have needed a real rename migration plus an application-level
dual-write/cutover window.

**Verification statuses and risk-hold are consolidated into one `status`
enum column, replacing a plain `suspicious` boolean.** The original mega-spec
describes verification progressing through separate states (received,
verifying, verified, risk-hold, receipt-queued, submitted, confirmed).
`verified_runs.status` (migration 0004) is a single `CHECK (status IN (...))`
column carrying exactly those seven values, backed by
`server/src/stateMachines.ts`'s `canTransitionVerifiedRun()` — one column and
one set of legal transitions, rather than a boolean plus a separate phase
field that could disagree with each other.

**State machines are enforced twice, at two different layers, deliberately.**
`server/src/stateMachines.ts` exports pure `canTransitionX(from, to): boolean`
functions with no side effects and no database access — asserted in
application code (e.g. `consumeTicket()` asserts `canTransitionTicket('issued',
'consumed')` before issuing the UPDATE) purely as a guard against a future
code change silently becoming inconsistent with the state machine (today it
can never actually be false, given the literal arguments each call site
passes — that is the point: it fails loudly in a test the moment someone
changes one side without the other). The real, load-bearing enforcement is
still the database: every status column has a `CHECK` constraint, and every
status *transition* goes through an atomic `UPDATE ... WHERE status = '<from>'
... RETURNING`, so Postgres — not application code — is what actually
prevents a double-consume or an illegal transition under concurrency.

**Schema-ready tables for Phases 6/7/10 (`chain_jobs`, `claims`, `audit_logs`)
are created now, in migration 0006, unused until those phases land.** This
was a judgment call, flagged here rather than made silently: the alternative
(creating them exactly when Phase 6/7/10's feature code needs them) risks a
migration racing new feature code in the same PR; creating the tables now,
governed by state machines that already exist, means those future phases land
as application code against an existing, reviewed schema.

## What was not built, and why
- **Rollback/`down` migrations.** Every migration here is additive (new
  table) or a superset reshape of a table that was never in production with
  data (`grid_runs`→`verified_runs`). Nothing yet requires reversing a
  migration against real data; adding rollback tooling before a real need for
  it is speculative complexity this project doesn't have a reason to carry.
- **A migration linter/dry-run mode.** `runMigrations()` executes each file's
  raw SQL directly; there's no `EXPLAIN`-based dry run or destructive-statement
  linter. Acceptable at 6 migration files reviewed by hand; worth revisiting if
  migrations become an unreviewed, automated part of the deploy pipeline
  (Phase 14).
- **A rename-in-place migration for `grid_runs`.** Explicitly not needed — see
  "Decision" above; noted here so a future reader doesn't go looking for it.

## Verification
- `server/src/stateMachines.test.ts` — 7/7 passing, exhaustively covers legal
  and illegal transitions for all three state machines.
- Typecheck clean on both packages (`tsc --noEmit`) after updating every call
  site (`server/src/grid.ts`, `server/src/index.ts`,
  `server/src/grid.integration.test.ts`, `server/src/auth.integration.test.ts`)
  from the old ad hoc functions/table names to the new ones.
- `npm run sim:sync && npm run sim:check` clean (no sim drift from this
  phase's changes).
- Fresh-database proof, not just re-use of the already-initialized local dev
  DB: `docker compose down -v && docker compose up -d` (wipes the Postgres
  volume entirely) → `npm run db:migrate` (applies all 6 migrations from
  nothing, confirmed via CLI output: `Applied 6 migration(s): 0001_runs.sql,
  0002_daily_grids.sql, 0003_run_tickets.sql, 0004_verified_runs.sql,
  0005_users_auth_sessions.sql, 0006_chain_jobs_claims_audit_logs.sql`) →
  `npm run test:integration` (12/12 passing against that freshly-migrated
  database, not the old ad hoc one).
- `npm test` (42/42), `npm run sim:test` (27/27 + cross-process fingerprint
  check), and `npm run build` (full production build, with the gitignored
  unlicensed local mp3s temporarily relocated per the established pattern and
  restored after) all pass.
- CI's `integration` job now runs `npm run db:migrate` against the Postgres
  service container before `npm run test:integration`, matching the real
  fresh-database path proven above rather than relying solely on the test
  files' own `beforeAll` migration call.
