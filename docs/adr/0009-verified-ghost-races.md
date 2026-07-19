# ADR 0009: Verified ghost races

## Status
Accepted

## Context
Every player in a Daily Grid runs the identical deterministic course (one seed, fixed before
eligible runs — ADR 0003), and every competitive result is a server-re-simulated replay whose
hash is receipted (ADR 0002/0006/0007). Those two properties together make a feature possible
that a client-authoritative game cannot honestly offer: racing the *actual, provably real* run
of another player — not an approximation, not a recording of positions the server took on faith,
but a re-simulation of the exact input trace whose hash the leaderboard entry (and eventually
the on-chain receipt) is bound to.

## Decisions

**The ghost is re-simulated locally from the raw input trace, not streamed positions.** The
server stores each recorded run's canonical replay (migration 0007: `verified_runs.replay`
jsonb — `{v, ticks, inputs}` in the flat wire encoding) and serves it whole via
`GET /api/grid/:id/ghost`. The client rebuilds the full per-tick position trace
(`buildGhostTrace`, `src/sim/ghost.ts`) through the same deterministic sim the player is
running, then renders the ghost at the player's CURRENT tick — a lockstep same-tick comparison
on the shared seed, not a wall-clock approximation that would drift with frame rate.

**The client verifies the ghost before racing it.** `verifyGhostReplay` re-hashes the served
trace locally and refuses it unless the hash matches the one the server claims — the same
`replay_hash` stored at verification time and receipted on-chain via `RunRecorded`. This is the
"verified" in verified ghost races, and it is checked by the racer's own machine, not taken on
faith: a tampered, corrupted, or substituted trace never becomes a ghost. (`replayHash`'s
signature was narrowed to `Pick<RunReplay, 'inputs' | 'ticks'>` so a verifier holding only a
raw trace provably computes the identical value — no parallel hashing code path to drift.)

**Ghost replays are public, and the copy attack that implies is closed at the database.**
Racing a ghost means downloading its input log; there is no way to offer this feature and keep
traces secret. Since everyone in a grid shares one seed, a downloaded log re-submitted verbatim
through a fresh ticket would re-simulate to the original's exact result. The countermeasure is
per-grid replay uniqueness: a `UNIQUE (grid_id, replay_hash)` index (migration 0007), a friendly
`duplicate_replay` (409) pre-check in the submit handler, and a 23505 catch for the true race
between two concurrent identical submissions. `recordVerifiedRun` was also reordered so the
INSERT (the atomic gate) happens BEFORE the Redis leaderboard write — a racing copy can no
longer touch the board and only then fail to persist. Copying is strictly unprofitable: an
exact copy is rejected, and a copy can at best tie the original anyway, never beat it.
**Known limitation, deliberately deferred:** a *perturbed* copy (steal the log, nudge one input)
evades the exact-hash gate. Detecting near-duplicates is input-trace similarity analysis —
squarely Phase 11's behavioral-signals layer, noted there rather than half-built here.

**Only non-risk_hold runs can become ghosts, but risk_hold rows keep their replay.** A flagged
run must never be paraded as a "verified" ghost, but its trace is exactly what Phase 12's
manual-review path needs — so storage is universal, serving is filtered.

**One ghost mode shipped in the client: the leader.** The server supports any identity
(`getGridGhost(gridId, identityKey?)`, exposed as `?self=1` for the caller's own best — both
paths integration-tested), but the client UI offers exactly "RACE THE LEADER'S GHOST". A
race-your-own-best button is trivial to add later; shipping it now doubles the UI surface of an
already-large phase for the less compelling half of the feature.

**Ghost fetch happens BEFORE the ticket is issued, and failure degrades to a normal run.** The
ticket is the scarce thing (one active per identity); a failed or unverifiable ghost fetch must
never waste one. The client also refuses a ghost whose seed differs from the ticket's — a
mismatched-seed ghost would desync into nonsense.

**Rendering is deliberately minimal.** A translucent cyan phantom (two boxes + a ground ring,
`depthWrite` off, never collides) plus a HUD chip showing the live gap (`▲ GHOST +12m` /
`▼ GHOST −8m`), computed at the same tick from the same trace. No legs animation, no name
banner in 3D — the point is the racing information, not a second hero model.

## Verification
- `src/sim/ghost.test.ts` (8) — trace ends exactly where `simulate()` says (same endTick, same
  distance), one entry per tick plus initial state, deterministic across builds, monotonically
  non-decreasing distance; hash verification accepts a faithful trace and rejects tampered,
  truncated, and wrong-tick-count traces.
- `server/src/grid.integration.test.ts` (+3, real Postgres + Redis) — leader ghost serves the
  right identity's run with a trace that re-hashes to the stored hash; a specific identity's
  ghost is fetchable; no-runs grid returns no ghost; and the full anti-copy gate: pre-check sees
  the duplicate, the unique index rejects the copier's insert with 23505, and the copier never
  reached the leaderboard.
- **Live end-to-end over real HTTP** (`npm run local:verify:grid`, extended): a throwaway wallet
  signs in via real SIWE, submits a real run, fetches the ghost it just became, verifies the
  served trace's hash locally (`hashVerified=true`), then mounts the actual copy attack —
  resubmits the ghost's now-public input log verbatim through a fresh ticket — and gets exactly
  `409 duplicate_replay`.
- Fresh-database proof: `docker compose down -v` → all 7 migrations apply from nothing →
  21/21 integration tests pass. Migration 0007 was also separately proven against the
  already-populated local DB (its dedup step cleared the old same-hash test fixtures before the
  unique index landed).
- Full regression: `tsc --noEmit` clean both packages; `sim:sync`/`sim:check` clean; `npm test`
  64/64 (+8); `sim:test` 35/35 (+8) with the cross-process fingerprint unchanged (the
  `replayHash` signature change altered no hashing behavior); full `npm run build`.
