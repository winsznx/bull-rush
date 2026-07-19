# ADR 0007: Relayer outbox, indexer, and the hashCanonical → keccak256 upgrade

## Status
Accepted

## Context
Phase 6 built and tested DailyGridRegistry/VerifiedRunRegistry/SeasonPrizeVault, but
nothing in this codebase called them — the live server had no idea they existed. Phase 7
is the piece that actually connects the two: every time a grid opens or a run earns a
personal best, the server needs to eventually get that fact on-chain, without ever
blocking gameplay or an HTTP response on a live transaction (a wallet signature during
active play, or an HTTP request stalling on `waitForTransactionReceipt`, are both things
this project's locked decisions rule out).

## Decisions

**A durable outbox (`chain_jobs`, already schema-ready since migration 0006), not a
direct call from the request handler.** `POST /api/grid/submit` and `POST
/api/admin/grid/open` finish and respond immediately; a chain job is enqueued
(idempotently) as a side effect, and a separate process — the relayer — drains it later,
on its own schedule. This is the only design that satisfies "claimable without
interrupting gameplay" for the write side, not just the claim side: a slow or down RPC
endpoint degrades the relayer's queue depth, never a player's run submission.

**Only a personal best gets queued for an on-chain receipt, not every verified run.**
`recordVerifiedRun` (server/src/grid.ts) only enqueues a `record_run` chain job when
`isPersonalBest` is true. A worse run is still fully recorded in Postgres (history is
never lost) but has nothing new to attest to on-chain — the leaderboard, and any future
reward computation, only ever care about a player's best on a given grid. This bounds
the relayer's gas spend to roughly "one on-chain write per player per grid," not "one per
attempt," without weakening the competitive-integrity guarantee (a worse run was never
going to change any ranking or reward outcome).

**The on-chain `gridId` is `keccak256(dayId)`, not the internal Postgres UUID.**
`toOnChainGridId` (server/src/chain/onchainIds.ts) hashes the public calendar-day string
`daily_grids.day_id`, the same public-derivability property ADR 0003 established for the
seed itself — anyone can recompute today's on-chain grid identifier from nothing but the
date, without needing database access. `toOnChainRunId` is
`keccak256(abi.encode(gridId, player, replayHash))`, exactly ADR 0006's recommended
scheme, computed here (the relayer) since `VerifiedRunRegistry.recordRun` takes `runId`
as an opaque parameter and has no opinion on how it's derived.

**One job at a time, waiting for each receipt before claiming the next.**
`processOneJob` (server/src/chain/relayer.ts) claims a single row, sends the transaction,
and blocks on `waitForTransactionReceipt` before returning. This trades throughput for
never having to reason about the relayer's own wallet client managing concurrent
in-flight nonces — acceptable at this project's actual volume (at most a few grids and a
handful of personal bests per day), and a correctness simplification that's cheap to keep
until volume ever demands otherwise.

**`daily_grids.indexing_state` and `verified_runs.status` are driven by the outbox, not
the other way around.** These two columns already existed with exactly this in mind
(`indexing_state` defaulted to `'off_chain'` since Phase 3; `verified_runs.status`'s
`receipt_queued`/`submitted`/`confirmed` states were modeled, unreachable, since Phase 5).
Phase 7 is the first phase that actually moves them: `queued` the moment a job is
enqueued, `submitted` the moment a transaction hash exists, `confirmed` once its receipt
lands — each transition guarded by `canTransitionGridIndexing`/`canTransitionVerifiedRun`
and a compare-and-set `UPDATE ... WHERE <column> = '<expected>'`, the same
database-level state-machine enforcement pattern every prior phase has used.

**The indexer (`server/src/chain/indexer.ts`) is a separate, read-only module from the
relayer**, not a byproduct of the relayer's own bookkeeping. `fetchGridOpenedEvents`/
`fetchRunRecordedEvents` read directly from chain logs — this is what lets a third party
(or this server, as an independent sanity check) confirm on-chain state agrees with what
`chain_jobs` believes was submitted, rather than trusting the relayer's own record of
itself. Phase 9's verified ghost races reads through this same module.

**Admin visibility, not yet real alerting.** `GET /api/admin/chain-jobs` (list, same
`ADMIN_KEY` guard as every other admin route) and `POST /api/admin/chain-jobs/process`
(manually drain a bounded batch) are the interim operator surface — matching this
project's established pattern (`sweepExpiredTickets` got the same treatment in Phase 5)
of building the real mechanism now and deferring the "someone gets paged" layer to Phase
12/13.

## The hashCanonical bug this phase surfaced and fixed
Writing the real anvil-backed integration test (below) caught a genuine bug, not a test
artifact: `hashCanonical` — the shared primitive behind `RULESET_HASH`, a Daily Grid's
`seed`, and a replay's `replayHash` — was still `fnv1aHex`, a 32-bit (4-byte) fingerprint.
Phase 2's own module header flagged this explicitly at the time: *"Not a cryptographic
commitment... Phase 6's contracts must hash the on-chain-bound fields with keccak256
(via viem) instead."* Phase 6 declared those fields `bytes32` in Solidity but never
exercised them against a real ABI encoder; Phase 7's relayer was the first code to
actually call `writeContract` with these values, and viem's ABI encoder correctly threw
(`AbiEncodingBytesSizeMismatchError`) rather than silently truncating or padding a 4-byte
value into a 32-byte slot.

Fixed at the source: `hashCanonical` (`src/sim/replay.ts`, synced to
`server/src/sim/replay.ts`) now hashes via `keccak256(toHex(canonicalStringify(value)))`
(viem) instead of the hand-rolled FNV-1a. `fnv1aHex` is deleted (it had no other caller).
This is a single-function change with no architectural fallout:
- `RULESET_HASH`/`deriveGridSeed`/`replayHash` all route through `hashCanonical`, so all
  three on-chain-bound values became real bytes32 at once.
- `verify.ts`'s ruleset/seed checks are plain string equality — unaffected by hash length.
- The PRNG (`src/sim/prng.ts`) seeds via `xmur3`, which hashes a seed string of any
  length character-by-character — a longer seed string is just as valid an input as a
  shorter one, so gameplay determinism is unaffected (confirmed: `sim:test`'s
  cross-process fingerprint check still passes, unchanged).
- No test asserted a specific literal hash value; tests using dummy values like
  `'0xdeadbeef'` for negative-path (tamper-rejection) checks only ever needed
  inequality, not a matching length, and continue to pass.
- One test fixture (`grid.integration.test.ts`) did use a short dummy `replayHash`
  literal as a *stand-in personal-best-recording payload* (not a tamper test) — that one
  needed updating to a real 32-byte value since `recordVerifiedRun` now actually encodes
  it as a contract argument. Fixed alongside.

## A second bug found and fixed while writing the integration test: shared-queue cross-contamination
`chain_jobs` is a single global Postgres table with no per-deployment scoping — correct
for production (there is only ever one real relayer, one real set of deployed contract
addresses) but a hazard for tests, where `relayer.integration.test.ts` deploys its own
fresh, disposable contracts to its own local anvil instance while `grid.integration.test.ts`
concurrently enqueues jobs against the same shared table. Vitest parallelizes across test
*files* by default; when both ran at once, the relayer drained *and successfully
submitted* another file's stale `record_run` job to this file's unrelated freshly-deployed
`VerifiedRunRegistry` — the on-chain event list then contained a run neither test itself
had submitted, and the specific job each test cared about could get starved behind
someone else's backlog. Fixed two ways: `server/vitest.config.ts` now sets
`fileParallelism: false` (every integration test file already shares one real Postgres/
Redis; sequential execution closes this exact race), and `relayer.integration.test.ts`
also clears `chain_jobs` in its own `beforeAll` so a stale row from an earlier *separate*
local run (not a concurrency issue, just accumulated history) can't do the same thing.

## What was NOT built, and why
- **No confirmation-count/finality wait.** `markConfirmed` fires the instant
  `waitForTransactionReceipt` resolves — one block of confirmation, not N. Acceptable for
  BOT Chain's expected finality characteristics at this project's stakes; revisit if
  Phase 15's real mainnet deployment shows reorg risk at one confirmation.
- **No dead-letter alerting on `failed` jobs** — only the admin list/drain endpoints.
  Phase 12/13's job.
- **No batching** — one relayer transaction per job, even though `recordRun`/`openGrid`
  could in principle be batched via a multicall. Not worth the complexity at current
  volume; revisit if gas costs or job backlog ever make it worth it.
- **The relayer loop itself is not covered by the anvil integration test** —
  `startRelayerLoop`'s `setInterval` wrapper is trivial (it's `drainJobs` on a timer,
  and `drainJobs` itself is fully covered); testing the timer semantics directly would
  mean asserting on real wall-clock timing, which is exactly the kind of flaky test this
  project avoids elsewhere.

## Verification
- `server/src/chain/onchainIds.test.ts` (8 tests) — pure, fast: determinism and
  sensitivity to each input of both ID derivations.
- `server/src/stateMachines.test.ts` — extended with `chain_job` (7 tests) and
  `daily_grids.indexing_state` (6 tests) machines, all passing.
- `server/src/chain/relayer.integration.test.ts` — real anvil (not mocked), deploying
  the actual Phase 6 compiled bytecode from `contracts/out/*.json`: proves an
  `open_grid` job reaches `confirmed` and `DailyGridRegistry.gridExists` returns true
  on-chain; proves a `record_run` job reaches `confirmed` and
  `VerifiedRunRegistry.recorded` returns true on-chain; proves the indexer independently
  reads back both events with the correct data; proves enqueueing the same grid twice
  never produces two `chain_jobs` rows.
- Full regression pass: `tsc --noEmit` clean on both packages; `sim:sync`/`sim:check`
  clean; `npm test` 56/56 (+7 from the new state-machine/onchainIds tests); `sim:test`
  27/27 unchanged, including the cross-process fingerprint check (confirming the
  hashCanonical change didn't alter gameplay determinism); `test:integration` 16/16 (was
  12/12 before this phase) against a freshly-migrated database, run twice back-to-back
  to confirm the fixed cross-file contamination bug didn't just get lucky once; a full
  `npm run build` (mp3s relocated per the established pattern, restored after); `forge
  test` 43/43 unchanged in `contracts/`.
