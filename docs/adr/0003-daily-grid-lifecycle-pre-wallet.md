# ADR 0003: Daily Grid lifecycle, built before wallet identity exists

## Status
Accepted

## Context
The full Daily Grid spec (competition lifecycle, run tickets bound to a
player wallet, on-chain seed derivation/scheduling, on-chain event indexing)
assumes Phase 4 (wallet + SIWE) and Phase 6 (contracts) already exist. They
don't yet — this repository has no wallet connection, no chain, and no
`users` table. Building Phase 3 in the originally-specified order required a
decision: block on Phase 4/6 landing first, or build the real, testable parts
of the Daily Grid lifecycle now on an explicit, documented placeholder for
identity and on-chain scheduling.

## Decision
Build the lifecycle now, with two deliberate, clearly-labeled placeholders:

1. **`identity_key` stands in for a wallet-derived user key.** Every new
   table (`run_tickets`, `grid_runs`) uses `identity_key` (today: the same
   sanitized display name the practice leaderboard already uses), not
   `user_id`. This is explicitly no worse than the pre-existing global
   leaderboard's identity model — already documented in this project's own
   assessment as a known limitation — and does not newly introduce that gap.
   Naming the column `identity_key` rather than `user_id` means Phase 4's
   real wallet-keyed identity lands as a rename + backfill, not a schema
   redesign.
2. **The grid seed is a pure function, not an on-chain commitment — yet.**
   `src/sim/grid.ts`'s `deriveGridSeed(dayId)` hashes `{dayId, gameVersion,
   rulesetHash}` (all public information) via the same `hashCanonical()` used
   elsewhere. This already satisfies "an operator cannot reroll to a
   preferred course" (there is nothing to reroll — the seed is determined by
   the calendar day alone), but it is an off-chain guarantee backed by trusting
   the server not to lie about which day a grid was opened for, not an
   on-chain one. Phase 6's `DailyGridRegistry` contract will replace the
   entropy source (a source-block hash instead of a pure day-id function) and
   record the same fields (`day_id`, `seed`, `ruleset_hash`, `game_version`,
   `opens_at`/`closes_at`) on-chain; `daily_grids.source_block`/`contract_tx`/
   `indexing_state` columns already exist (nullable / defaulted to
   `'off_chain'`) specifically so that migration is filling in columns, not
   adding them.
3. **"Authorised scheduler" is today's `ADMIN_KEY`-guarded
   `POST /api/admin/grid/open`.** It is idempotent (`day_id` is `UNIQUE`;
   opening an already-open day just returns the existing grid, never creates
   a second one or changes its seed) — the actual "can't reroll" property
   holds regardless of who or what calls it. Phase 6 replaces the caller
   (a contract event instead of an admin key) without touching this property.
4. **One active ticket per identity, enforced atomically.** `issueTicket()`
   takes a Redis `SET NX` lock (`grid:activelock:{identityKey}`) before
   writing to Postgres, closing the race two concurrent requests from the
   same identity would otherwise hit; `consumeTicket()` is an atomic
   Postgres `UPDATE ... WHERE status = 'issued' ... RETURNING *`, so only one
   concurrent caller can ever consume a given ticket. Both were verified
   against a real local Postgres + Redis, not mocked (see below).
5. **Only an improved personal best updates the grid's leaderboard.** Every
   verified attempt is still recorded in `grid_runs` (history), but
   `recordGridRun()` only writes to the Redis sorted set
   (`lb:grid:{gridId}`, `ZADD ... GT`) when the new distance beats the
   identity's existing best — the DB-level analog of "a worse run doesn't
   create an unnecessary transaction," ready for Phase 6/7 to gate real
   receipt-queueing on the same `isPersonalBest` flag this already returns.

## What was NOT built, and why
- **Wallet-gating before entering the grid.** The original wallet-UX spec
  (Phase 4) has the player connect a wallet and sign SIWE specifically when
  selecting Daily Grid/Ranked/Rewards. That gate doesn't exist yet — anyone
  can request a grid ticket today with just a display name. This is
  acceptable for now because nothing of real value (a reward, an on-chain
  receipt) attaches to a grid run yet; it becomes unacceptable the moment
  Phase 6/10 exist, at which point Phase 4 must land first.
- **On-chain event indexing / reconciliation.** `indexing_state` defaults to
  `'off_chain'`; there is no indexer because there is no chain yet (Phase 7).
- **A dedicated "my personal best" endpoint.** The client currently finds the
  player's own row by matching identity against the visible top-N leaderboard
  entries; a player outside the top N sees no personal-best display today.
  Minor, deferred — not worth a new endpoint before Phase 4 changes what
  "the player's identity" even means.
- **Versioned migrations.** `daily_grids`/`run_tickets`/`grid_runs` were added
  via the same ad hoc `CREATE TABLE IF NOT EXISTS` pattern already in
  `server/src/db.ts`, matching the existing `runs` table rather than
  introducing a migration tool for three tables when Phase 5 will formalize
  all of them (this set included) at once.

## Verification
Real, not mocked: `server/src/grid.integration.test.ts` runs against an
actual local Postgres + Redis (`npm run test:grid`; also wired as a new CI job
with Postgres/Redis service containers) and proves — against the real
database, not a stand-in — idempotent grid-opening, both ticket-rejection
paths (not-yet-open, unknown grid), atomic one-active-ticket enforcement and
its release on consumption, double-consumption prevention, and
personal-best-gated leaderboard updates. Beyond that, the full HTTP path was
exercised end-to-end against a live local server (`docker compose up` +
`node --env-file=.env --import tsx src/index.ts`): opened a grid, confirmed
idempotency, confirmed the inspection-delay rejection, issued a ticket,
confirmed one-active-ticket rejection over HTTP, played a real run against
the ticket's seed through `SimRunner`, submitted it via `POST
/api/grid/submit`, confirmed the server's derived distance/score/death-cause
and `isPersonalBest: true`, confirmed the grid leaderboard updated, and
confirmed the now-consumed ticket could not be resubmitted.
