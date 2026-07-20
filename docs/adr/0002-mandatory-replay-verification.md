# ADR 0002: The deterministic engine is the only production path; verification is mandatory, not shadow

## Status
Accepted

## Context
Before this change, Bull Rush had two parallel game engines: a classic,
client-authoritative engine (default, `Math.random()`-driven, no replay) and a
deterministic engine (`src/sim/`, opt-in via `?sim=1`). The server had a working
replay-verification path, but it ran in **shadow mode** — it logged whether a
submitted claim matched a re-simulation, but the leaderboard still trusted the
client's claimed `distance`/`score`/`durationMs`/`deathCause` unconditionally,
controlled by an env flag (`VERIFY_ENFORCE`) that had never been set to `true`
in production. In practice, every real leaderboard entry was still a
self-reported client number.

This is incompatible with attaching any real, sponsor-funded reward to a
leaderboard position — a modified client could always report an arbitrary score.

## Decision
1. **The deterministic engine (`SimScene`) is now the unconditional default** in
   every build. The classic engine is reachable only via `?classic=1`, and only
   in a dev build (`import.meta.env.DEV`) — gated structurally in
   `src/sim/flag.ts`'s `useClassicEngine()`, not just by convention, so a
   production build cannot render it regardless of query string. It never
   builds a replay and therefore can never pass verification, submit a score,
   or claim the milestone.
2. **`VERIFY_ENFORCE` is deleted.** There is no more shadow mode. Every
   `/api/run/submit` call must include a canonical `RunReplay`
   (`src/sim/replay.ts`); the server re-simulates it and derives distance,
   score, death cause, max combo, and duration **only** from that
   re-simulation. The client no longer sends those fields as trust-bearing
   input at all — `SubmitSchema` in `server/src/index.ts` has no `distance`/
   `score`/`durationMs`/`deathCause` fields anymore.
3. **A new envelope-verification layer** (`src/sim/verify.ts`,
   `verifyReplayEnvelope()`) rejects a replay before a re-simulation is ever
   attempted, with a specific, named reason: wrong schema version, wrong game
   version, wrong ruleset hash, wrong seed, or a structurally invalid trace
   (`src/sim/replay.ts`, `validateReplayStructure()`: missing/excessive/
   out-of-order/future-tick/unknown-action/impossible-frequency). This
   replaces the old "copy `sim.ts` to the server and hope it stayed in sync"
   trust model with something the server actively checks on every submission.
4. **A ruleset hash, not just a version string, gates every replay.**
   `src/sim/sim.ts` exports `RULESET_SNAPSHOT` — every tunable that affects
   gameplay outcome, in one object — and `src/sim/ruleset.ts` hashes it
   (`RULESET_HASH`). A replay whose `rulesetHash` doesn't match the server's
   own computed hash is rejected as `wrong_ruleset`. This makes "the client
   and server are running the same rules" a checked property of every
   submission, not an assumption.
5. **`src/sim` is now enforced, not just documented, as the single source of
   truth.** `npm run sim:sync` copies it into `server/src/sim`; `npm run
   sim:check` (new, non-mutating) fails if the two have drifted; both are
   wired into CI (`.github/workflows/ci.yml`, new) and `sim:check` also runs
   as a required step of `npm run build`.
6. **The ad hoc `npx tsx` test scripts became a real vitest suite**
   (`npm run sim:test` / `npm test`), covering: determinism (same seed+inputs
   → identical result, across 200 seeds), live-stepping ≡ batch-verify
   equivalence, frame-jitter and background-stall resistance, every named
   envelope/structural rejection, and a bounded-runtime check for a
   maximum-duration (45 min) run. Cross-process determinism (the actual
   client-vs-server guarantee) is checked separately by
   `scripts/check-fingerprint.mjs`, since a single vitest process can't
   exercise that property by construction.

## Consequences
- **The hash function used for `rulesetHash`/`replayHash` (`fnv1aHex`, a
  32-bit FNV-1a) is explicitly NOT a cryptographic commitment.** It is
  sufficient for the current off-chain server-side consistency check, but
  Phase 6's on-chain contracts (`VerifiedRunRegistry`) must hash the
  on-chain-bound fields with keccak256 (via viem) instead — noted directly in
  `src/sim/replay.ts`'s module header specifically so this isn't forgotten
  when that phase starts.
- **The old "mismatched result" rejection category no longer exists as a
  distinct state.** In the old (shadow) model, a claim could disagree with a
  re-simulation; in the new model there is no claim to disagree with — the
  server's re-simulation *is* the result. What were previously "client
  inflated the score" cases are now structurally impossible rather than
  merely detected.
- **`runId` is currently just the one-time submit token.** Phase 3's
  `run_tickets` table will introduce a proper, wallet-bound run identity;
  today's `runId` is an honest placeholder for that, not the final design.
- Existing Postgres rows retain their old shape (`verified` was already added
  in a prior phase); nothing here required a schema migration, since
  `jeets_dodged`/`snipers_survived`/`mev_avoided` were already always
  zero/unpopulated in practice (the classic client never sent them either) —
  confirmed before making this change, not assumed.
