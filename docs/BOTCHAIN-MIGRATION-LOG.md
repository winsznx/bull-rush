# BOT Chain Migration Log

Running, chronological journal of this migration. Append entries; do not rewrite history.

---

## 2026 — Phase 0: Baseline and reusable-pattern assessment

**Starting state:** commit `e6e0468` on `main`, working tree clean. Branch
`feat/botchain-mainnet-skill-rewards` created from this point.

**Confirmed (not re-litigated) from the prior evidence-based repository assessment:** client-
authoritative/nondeterministic default engine, gameplay-affecting `Math.random()`, manipulable
client-submitted scores, an existing deterministic engine in `src/sim/` hidden behind `?sim=1`,
shadow-only server verification, display-name-keyed leaderboard, zero blockchain integration, no
authentication, manual deploys, ANSEM-specific copy, a slur in the gate quiz, gitignored-but-
live-in-production commercial music, and undocumented-provenance visual assets.

**BotSpend (`/Users/mac/botspend`) inspected read-only.** Findings in
`docs/BOTSPEND-REUSE-ASSESSMENT.md`. Headline corrections to the task's stated assumptions:

- BOT Chain **mainnet is chain ID 677** (not 968 — that's testnet). Both independently confirmed
  live via `eth_chainId`.
- BotSpend's mainnet deployment (4 contracts, 4 transactions, blocks 16,256,258–16,256,261) is
  **real and independently re-verified** against the live chain and explorer in this pass.
- BotSpend's mainnet **gasless/paymaster flow is currently paused** ("bundler underfunded" per its
  own config) — not confirmed operational in production today. Do not depend on it for Bull Rush's
  critical path.
- **No evidence found anywhere in BotSpend for the claimed "second place, BOT Chain Agent Track"
  award.** Per the task's own instruction, this claim is **excluded** from all Bull Rush submission
  material pending the project owner supplying independent, external evidence.

**Network validation performed live** (`docs/BOTCHAIN-NETWORK-VALIDATION.md`): `eth_chainId`,
`eth_blockNumber`, `eth_getBlockByNumber`, `eth_estimateGas`, `eth_feeHistory`, `eth_gasPrice`,
malformed-method error shape, explorer reachability, and Etherscan-compatible contract-ABI
verification endpoint — all checked against both networks where relevant, all passing.

**Current production snapshotted** (`docs/CURRENT-PRODUCTION-SNAPSHOT.md`): live URLs, current
bundle hashes, the current (non-migrated) Postgres/Redis schema, and every environment variable
name in use today — no values recorded.

**Decision:** Phase 0 is committed as its own focused commit before any product code changes begin,
so the evidence baseline is preserved independent of what Phase 1+ does to the repository.

**Explicitly not done in Phase 0, and why:** no BOT Chain deployer wallet, sponsor funds, or
independent human testers exist yet for this project — those are the project owner's inputs to
provide, not something to fabricate. Contract writing, mainnet deployment, and submission evidence
collection are sequenced after the application-layer work (Phases 1–13) specifically so that when
real funds and real testers are involved, everything they're touching is already hardened.

---

## Phase 1: Remove unsafe and ANSEM-specific production content

**Removed entirely:** `src/data/questions.ts` (the mandatory lore-gate quiz, including the racial
slur presented as a correct answer) and `src/ui/Gate.tsx`. Replaced with `src/ui/Tutorial.tsx` — a
5-step, fully skippable orientation (lanes, dash, Compute Cells, Corrupted Nodes, verified runs)
that never blocks play. Phase machine renamed `'gate' → 'tutorial'`, `enterGate → enterTutorial`
throughout `store.ts`/`App.tsx`/`Menu.tsx`.

**Rebranded copy**, ANSEM/$ANSEM/Pumpfun references removed from: `README.md`, `package.json`
description, `index.html` meta/OG/Twitter tags + title, `functions/s.js` share description,
`server/src/index.ts` OG-card canvas text + share description, `src/ui/Menu.tsx`,
`src/ui/Cinematic.tsx` (all 4 lore beats), `src/ui/GameOver.tsx` (share tweet text, name-field
label → "OPERATOR CALLSIGN"), `src/ui/Board.tsx` ("BULL BOARD" → "FINALITY BOARD").

**Rank ladder replaced** in both `src/data/ranks.ts` and `server/src/ranks.ts` (kept hand-synced,
identical thresholds): `Paper Horn/Trench Calf/Green Horn/Black Bull/Cloud Charger/Coldest
Breathing` → `Unverified/Bootstrapped/Synced/Finalized/Consensus Runner/Genesis Operator`. Existing
DB rows keep their old rank text (historical, cosmetic — not backfilled; Phase 5's migration work
is the right place for that if ever needed).

**Hazard death-cause copy replaced** in `src/data/hazards.ts` and the sim engine's own embedded
copy in `src/sim/sim.ts` (then `npm run sync-sim`'d to `server/src/sim/sim.ts` and re-verified
byte-identical). New copy: "A GLITCH NODE CAUGHT YOU." / "A CORRUPTED NODE STOPPED YOU." / "A FORK
TRAP OPENED." / "A VALIDATOR STRIKE CAUGHT YOU." / "A REORG WAVE WIPED THE RUN."

**Explicit scoping decision:** the internal `Kind` string identifiers (`'jeet'`, `'redCandle'`,
`'rug'`, `'sniper'`, `'mev'`, `'greenCandle'`, `'diamondHorns'`, `'stimmy'`, `'blackCloud'`) were
**left unchanged**. They are pure code-internal keys — never shown to a player, never persisted as
user-facing text — and renaming them touches four files including the sync-checked deterministic
sim engine, for zero legal/brand benefit. Renaming them is available as a future cosmetic cleanup,
not a Phase 1 requirement. See the comment left in `src/data/hazards.ts`.

**Asset provenance established** (`ASSET_PROVENANCE.md`, new): every production image cataloged as
provenance-undocumented (must confirm or replace before mainnet); the Anton font documented as
OFL-licensed pending an actual license file being added; **the five gitignored, confirmed-live-in-
production commercial music tracks documented as 🚫 must-remove**, matching the prior assessment's
finding that git-ignoring a file does not stop it from being deployed.

**Enforcement added:** `scripts/check-forbidden-assets.mjs`, wired into `npm run build` (and
exposed standalone as `npm run check-assets`), fails the build if any of the five known-unlicensed
filenames are present in `public/` or `dist/`. Verified working: it correctly failed against this
machine's current local files (which still include both the source `public/` copies and a stale
`dist/` build from a prior session) — this is expected and correct; the project owner must remove
or replace those files before the next `npm run build` succeeds. Not fixed by this phase because
doing so would mean deleting the project owner's pre-existing local files without being asked to —
the guard enforces the policy without taking that action unilaterally.

**Verified after these changes:** `tsc --noEmit` clean on both packages; the full determinism/
verification suite (`synctest.ts`, `runner.test.ts`, `e2e.test.ts`) re-run and still 100% passing
(the hazard-cause rename doesn't touch gameplay mechanics, only display strings); a full-repo
`git grep` for ANSEM/Pumpfun/old-rank-names/the slur returns no hits outside this log's own
historical description of what used to be there.

**Not done in Phase 1** (by design, sequenced later or requiring the project owner): terminology
for "Daily Grid" as a live competition system (Phase 3), any change to the deterministic engine's
default-vs-`?sim=1` status (Phase 2), actual replacement music/art (owner-supplied), and wiring
`check-assets`/`check-forbidden-assets` into CI (Phase 14, since no CI exists yet).

## Phase 2: Make the deterministic engine the product

See `docs/adr/0002-mandatory-replay-verification.md` for the full architectural rationale.
Summary of what changed, concretely:

**Engine promotion.** `src/three/Game.tsx` now renders `<SimScene/>` (the deterministic engine)
unconditionally by default. The classic engine (`<Bull/><Track/>`) is reachable only via
`?classic=1`, gated by `src/sim/flag.ts`'s `useClassicEngine(isDev, search)` — a pure, unit-tested
function (`src/sim/flag.test.ts`) that returns `false` for every query string when `isDev` is
false, so a production build cannot render the classic engine no matter what's in the URL. It
never builds a replay, so it structurally cannot submit a score, appear on the leaderboard, or
claim the milestone.

**Canonical replay schema** (`src/sim/replay.ts`, new): `RunReplay` exactly per the task's
specified shape (`schemaVersion`, `gameVersion`, `rulesetHash`, `seed`, `runId`, `inputs`, `ticks`),
plus `canonicalStringify()` (recursive, sorted-key JSON — the "never hash arbitrary object
serialization" requirement) and `fnv1aHex()` (a fast, deterministic, cross-runtime 32-bit hash —
explicitly documented as NOT a cryptographic commitment; Phase 6's on-chain contracts will need
keccak256 instead, noted directly in the file so it isn't forgotten). `validateReplayStructure()`
implements every named structural rejection: missing input log, excessive log size, truncated/
zero ticks, future tick, out-of-order tick, unknown action, impossible action frequency.

**Ruleset hash** (`src/sim/ruleset.ts`, new; `src/sim/sim.ts`'s new exported `RULESET_SNAPSHOT`):
every tunable that affects gameplay outcome is captured in one object and hashed. A replay whose
`rulesetHash` doesn't match the server's own computed hash is rejected (`wrong_ruleset`) — this is
the "enforceable consistency mechanism" replacing the old copy-and-hope-`sync-sim`-was-run model
with something the server actively checks per submission, not just a build-time copy step.

**Envelope verification** (`src/sim/verify.ts`, new): `verifyReplayEnvelope()` checks schema
version, game version, ruleset hash, and seed, then delegates to `validateReplayStructure()` —
all before a re-simulation is ever attempted, so a malformed or stale-client submission is
rejected cheaply with a specific, named reason.

**Mandatory enforcement — `VERIFY_ENFORCE` is deleted entirely.** There is no more shadow mode.
`server/src/index.ts`'s `SubmitSchema` no longer has `distance`/`score`/`durationMs`/`deathCause`/
`jeetsDodged`/etc. fields at all — the client (`src/api.ts` `buildReplay()`, `src/ui/GameOver.tsx`)
sends only `{token, name, ref?, wallet?, replay}`. The server always derives distance, score, max
combo, death cause, and duration from `simulate()`'s result. `GameOver.tsx` shows the server's
canonical values once they arrive, with a small "RUN NOT VERIFIED · &lt;reason&gt;" note if
rejected — the local, immediately-shown values are clearly provisional, not authoritative.

**`maxCombo` is now real, tracked data** — added to `SimState`/`SimResult` (previously the DB
column existed but was always populated from a client field the client never actually sent).

**Source-of-truth enforcement, made real rather than just documented:**
`npm run sim:sync` (renamed from `sync-sim`), `npm run sim:check` (new, non-mutating — diffs
`src/sim/*` against `server/src/sim/*` without writing anything, fails on drift; verified working
by deliberately corrupting the server copy and confirming it caught it, then restoring), and
`npm run sim:test` (vitest suite + `scripts/check-fingerprint.mjs`'s cross-process determinism
check, since a single vitest process can't prove that property by construction). `sim:check` now
runs as a required step of `npm run build`, and both `sim:check` and `sim:test` run in the new
`.github/workflows/ci.yml` (first CI this repo has ever had).

**The ad hoc test scripts became a real vitest suite.** `src/sim/synctest.ts` → deleted, superseded
by `src/sim/sim.determinism.test.ts`. `runner.test.ts` and `e2e.test.ts` rewritten in vitest's
`describe`/`it`/`expect` form (given/when/then comments per this project's testing convention).
`e2e.test.ts` now exercises every named rejection reason individually (wrong seed/version/ruleset/
schema, missing/out-of-order/unknown-action/future-tick/excessive-size/impossible-frequency
inputs) plus a maximum-duration-run bounded-runtime test and a truncated-log test. One real
finding while writing the truncation test: for some seeds, truncating an input log's tail
coincidentally reproduces the exact same distance/score as the honest run, because distance in
this engine is time-based (not input-based) and a frozen post-truncation lane can coincidentally
dodge the same hazards — this is not a security gap (nothing is gained by it; the server only
ever computes from exactly what's submitted), but it meant the test needed a seed where the
tail demonstrably matters, chosen empirically rather than assumed. `verify-local.ts` updated to
match the new wire format (submits a full `RunReplay`, tests a wrong-seed rejection instead of the
old claim-vs-resim mismatch, which no longer exists as a concept).

**Verified:** `tsc --noEmit` clean on both packages; `npm run sim:check` passes (and was proven to
correctly fail on deliberately-introduced drift, then recover); `npx vitest run` — 23/23 tests
passing across 4 files; `npm run sim:test` (vitest + cross-process fingerprint) green; a full
`npm run build` proven end-to-end by temporarily relocating (not deleting) the local unlicensed
music files to a backup path, confirming the complete pipeline (asset check → sim:check →
typecheck → vite build) succeeds, then restoring the files exactly. Local Docker-based live E2E
(`npm run local:verify` against a running API) was not re-executed in this pass (Docker was not
running); the script was updated to the new schema and reviewed, not live-tested end-to-end.

**Not done in Phase 2** (explicitly sequenced later): the full Daily Grid competition lifecycle,
run-ticket table (Phase 3); wallet-bound identity, SIWE (Phase 4); Postgres migrations replacing
the ad hoc boot-time schema (Phase 5); any smart contract (Phase 6); a real cryptographic
(keccak256) replay/ruleset commitment for on-chain use, as opposed to today's off-chain FNV32
fingerprint (Phase 6, noted in ADR 0002 and `replay.ts`'s header so it isn't missed).

## Phase 3: Daily Grid lifecycle (built ahead of wallet identity — see ADR 0003)

See `docs/adr/0003-daily-grid-lifecycle-pre-wallet.md` for the full rationale, in particular
why this was buildable now (real, testable) rather than blocked on Phase 4/6, and what's
explicitly deferred as a result (wallet-gating before entry, on-chain seed/scheduling/indexing,
versioned migrations).

**Shared, synced module** `src/sim/grid.ts` (new; added to `sim:sync`/`sim:check`'s file list):
`deriveGridSeed(dayId)` — a pure, publicly re-derivable hash of `{dayId, gameVersion,
rulesetHash}`, so an operator has nothing to reroll — plus `dayIdFor()`/`gridWindowFor()` for the
UTC day id and the opens/closes window (a 5-minute public inspection delay before ticket issuance,
a 24h competition window).

**Database** (`server/src/db.ts`, same ad hoc `CREATE TABLE IF NOT EXISTS` pattern as the existing
`runs` table — Phase 5 formalizes all of it): `daily_grids` (day_id UNIQUE — prevents overwrite/
duplicate-day-id by construction), `run_tickets`, `grid_runs`. Columns use `identity_key`, not
`user_id` — an explicit, named placeholder for Phase 4's real wallet-keyed identity, chosen
specifically so that migration is a rename, not a redesign.

**Server lifecycle** (`server/src/grid.ts`, new): `openGrid()` (idempotent — `ON CONFLICT (day_id)
DO NOTHING`, always returns the one true row for that day), `getCurrentGrid()`, `issueTicket()`
(rejects `grid_not_found`/`grid_not_open_yet`/`grid_closed`/`active_ticket_exists`; the one-active-
ticket lock is a Redis `SET NX` taken before any Postgres write, closing the race between two
concurrent requests from the same identity), `consumeTicket()` (atomic Postgres compare-and-set via
`UPDATE ... WHERE status='issued' ... RETURNING *`), `recordGridRun()` (every verified attempt is
recorded; only an improvement over the identity's existing best updates the grid's Redis
leaderboard, via the same `ZADD ... GT` pattern the practice leaderboard already uses).

**New routes** in `server/src/index.ts`: `GET /api/grid/current`, `GET /api/grid/:id/leaderboard`,
`POST /api/grid/ticket`, `POST /api/grid/submit` (re-simulates against the *ticket's* seed via the
same `verifyReplayEnvelope`/`simulate()` used by practice submission — no separate verification
path was created), `POST /api/admin/grid/open` (the interim "authorised scheduler," guarded the
same way the other admin routes are, until Phase 6's contract can open grids on-chain instead).

**Client**: `src/gridApi.ts` (new) — `getCurrentGrid`, `getGridLeaderboard`, `requestGridTicket`,
`submitGridRun`. `src/store.ts` — new `'grid'` phase, `refs.gridTicketId`/`refs.gridId`, and a
dedicated `startGridRun(seed, ticketId, gridId)` action (separate from `start()`) so a grid
attempt's ticket-bound seed can never be silently overwritten by the practice flow's random-seed
fetch — confirmed by an explicit guard added to `App.tsx`'s run-start effect
(`if (!refs.gridTicketId)`). `src/ui/DailyGrid.tsx` (new) — a minimal, functional panel (grid id,
countdown, verified-run count, leaderboard, personal best if visible in the top N, ticket request)
reached via a new "DAILY GRID" button on the menu. `src/ui/GameOver.tsx` — branches submission
between the practice and grid endpoints based on `refs.gridTicketId`, and shows a "NEW GRID
PERSONAL BEST" note when the server confirms one.

**Testing — genuinely run, not just written:**
- `src/sim/grid.test.ts` (4 tests, pure logic): seed determinism/day-sensitivity, window timing.
- `server/src/grid.integration.test.ts` (6 tests, **against a real local Postgres + Redis**, not
  mocks — `npm run test:grid`, new): idempotent grid-opening, both ticket-rejection paths, atomic
  one-active-ticket lock + release on consumption, double-consumption prevention, personal-best-
  gated leaderboard updates. All 6 passed against `docker compose up`'s actual containers.
- New CI job `grid-integration` (`.github/workflows/ci.yml`) runs the same suite against Postgres/
  Redis GitHub Actions service containers — this is not aspirational, it mirrors exactly what was
  run locally.
- **Full HTTP path exercised live**, not just unit-tested: started the real API server against the
  real local DB stack, then via curl/a small script — opened a grid, confirmed opening the same day
  twice is a no-op, confirmed the inspection-delay rejection, issued a ticket, confirmed a second
  concurrent ticket request is rejected, played an actual run through `SimRunner` against the
  ticket's seed, submitted it to `POST /api/grid/submit`, confirmed the server's derived distance
  (238m)/score(738)/death-cause and `isPersonalBest: true`, confirmed the grid leaderboard reflected
  it, and confirmed the now-consumed ticket could not be resubmitted (`invalid_or_expired_ticket`).

**Verified after these changes:** `tsc --noEmit` clean on both packages; `sim:check` passes (now 6
files); `sim:test` — 27/27 (up from 23, +4 for `grid.test.ts`); `test:grid` — 6/6 against real
Postgres+Redis; a full `npm run build` re-proven end-to-end the same way as Phase 2 (temporarily
relocating, then restoring, the local unlicensed music files).

**Not done in Phase 3** (explicitly deferred, see ADR 0003): wallet-gating before grid entry, an
on-chain seed source/scheduler/indexer (Phase 4/6/7), a dedicated "my personal best outside the
visible leaderboard" endpoint, and versioned migrations for the three new tables (Phase 5, together
with the original `runs` table).

## Phase 4: Wallet identity + SIWE — `identity_key` becomes real

See `docs/adr/0004-wallet-stack-and-siwe-sessions.md` for the full rationale, including a
dependency-vulnerability investigation that turned up real `npm audit` findings and the concrete
(not assumed) evidence for why they don't block this stack.

**Wallet stack**: `viem`/`wagmi`/`@tanstack/react-query`, matching BotSpend's proven versions.
`src/wallet/chain.ts` — BOT Chain mainnet (677)/testnet (968), using the exact live-verified
values from Phase 0, not re-typed from memory. `src/wallet/wagmiConfig.ts` — `injected()` only, no
WalletConnect/MetaMask-SDK. `npm audit` flagged 21 findings the moment `wagmi` was installed;
investigated to the actual built bundle (grepped for the vulnerable packages' distinctive runtime
code — confirmed absent; only inert metadata/error-taxonomy strings reference their names) rather
than assumed safe or panic-upgraded to a breaking wagmi v3. `npm audit` now runs in CI,
informational (`continue-on-error`), so a *different* future finding stays visible.

**SIWE, hand-rolled, not the `siwe` package**: `src/wallet/siwe.ts` (client, builds the EIP-4361
message) + `server/src/siwe.ts` (server, parses + verifies via `viem`'s `verifyMessage`) — the two
sides share the public EIP-4361 format, not code, so there's nothing to `sync-sim`-style keep in
sync. 8 unit tests (`server/src/siwe.test.ts`), including a genuinely-signed message via a
throwaway test private key, a forged-signature rejection, wrong-domain/wrong-chain rejections
(phishing-relay defenses), and issued/expiry bounds.

**Sessions** (`server/src/auth.ts`, new): two-tier — a 15-minute Redis-only access token (checked
on every gated request, one GET) and a 30-day Postgres-backed refresh token (only its SHA-256 hash
stored; rotates on every use, so a replayed old refresh token fails outright once rotated — proven
against a real Postgres). New tables `users` (keyed `UNIQUE(chain_id, wallet_address)`,
case-insensitive-unique optional `display_name`), `auth_nonces` (hash-stored, single-use, atomic
consume), `sessions`. Cookies: `br_session`/`br_refresh`, `HttpOnly`/`SameSite=Lax`/`Secure` in
prod, refresh cookie scoped to `Path=/api/auth`. CORS updated to `credentials: true`. Display names
are cosmetic only — reserved-name list, rate-limited changes (3/day), never the identity key.

**Identity finally real**: `/api/grid/ticket` and `/api/grid/submit` now require a valid session
(`requireGridSession`) and derive `identityKey = "${chainId}:${walletAddress}"` from it — never
from a client-supplied name. `/api/grid/submit` also checks the consumed ticket's stored identity
matches the current session's. Practice play and the pre-existing global leaderboard remain fully
unauthenticated, per spec — only Daily Grid (the surface Phase 3/ADR 0003 flagged as needing real
identity) is gated.

**Client**: `src/wallet/WalletProvider.tsx` (`WagmiProvider` + `QueryClientProvider`, wrapping the
app in `main.tsx`), `src/wallet/useAuth.ts` (connect → chain-switch-if-needed → request nonce →
sign → verify, one hook, only invoked from Daily Grid entry — never on the practice/CHARGE path),
`src/authApi.ts` (session/nonce/verify/logout/display-name client, all `credentials: 'include'`).
`src/ui/DailyGrid.tsx` rewritten: shows "CONNECT WALLET TO ENTER" until authenticated, then the
truncated connected address, and resolves "YOUR BEST"/leaderboard rows against the session's
identity instead of a typed name.

**Testing — genuinely run:**
- `server/src/siwe.test.ts` (8, pure logic + real signatures).
- `server/src/auth.integration.test.ts` (6, **real Postgres+Redis**, new): session creation, nonce
  single-use, refresh rotation (old token provably dead), revocation (both tokens dead
  immediately), reserved/duplicate/too-short display-name rejection.
- **Full HTTP path exercised live**, not just unit-tested: request nonce → sign a genuine SIWE
  message with a throwaway wallet (`viem/accounts`, never a fund-holding key) → verify → receive
  `br_session`/`br_refresh` cookies → confirmed an unauthenticated grid-ticket request is rejected
  (401 `not_authenticated`) → confirmed the identical request WITH the session cookie passes the
  auth gate → refresh (confirmed the access token actually changes) → logout (confirmed the
  session no longer resolves via `GET /api/auth/session`).
- Built the full production bundle specifically to verify the dependency-vulnerability assessment
  above empirically (grepped the actual output), not just reason about it theoretically.

**Verified after these changes:** `tsc --noEmit` clean on both packages; `sim:check` passes;
`npm test` (fast unit suite, now includes `siwe.test.ts`) — 35/35 (+8); `sim:test` — 27/27
unchanged; `test:integration` (renamed from `test:grid` now that it covers auth too — CI job
renamed to `integration`) — 12/12 (+6) against real Postgres+Redis; a full `npm run build`
succeeds (bundle grew from ~87KB to ~190KB gzipped-adjacent, as expected for a real wallet stack).

**Not done in Phase 4** (explicitly deferred, see ADR 0004): refresh-token reuse-detection/
session-family revocation, WalletConnect/mobile wallet support, BO-Wallet-specific compatibility
testing (still unconfirmed — flagged since Phase 0), per-wallet (vs. per-IP) rate limiting on auth
endpoints, and versioned migrations for the three new tables (Phase 5, alongside every other table
so far).

## Phase 5 — Database migrations and explicit state machines

Replaces every remaining ad hoc `CREATE TABLE IF NOT EXISTS` (the last of `server/src/db.ts`'s
old `initSchema()`) with versioned SQL migrations, and makes the run/verified-run/claim lifecycle
transitions explicit and testable instead of implicit in scattered `UPDATE` statements.

**Migrations** (`server/migrations/0001`–`0006`, applied in order by `server/src/migrate.ts`,
tracked in a new `schema_migrations` table):
- `0001_runs.sql` — reproduces the real production `runs` table exactly (folding two historical
  `ALTER TABLE`s into the `CREATE TABLE`) — a deliberate no-op against production, establishing
  migration history without touching live data.
- `0002_daily_grids.sql`, `0003_run_tickets.sql` — net-new, unchanged from Phase 3's ad hoc shape;
  `0003` adds a `CHECK (status IN ('issued','consumed','expired'))` and a partial sweep index.
- `0004_verified_runs.sql` — Phase 3's `grid_runs` renamed to its final name `verified_runs`
  (never deployed to production, so a straight rename, no migration needed), gains `game_version`/
  `replay_hash` columns, and replaces the old `suspicious` boolean with a `status` enum
  (`received`/`verifying`/`verified`/`risk_hold`/`receipt_queued`/`submitted`/`confirmed`).
- `0005_users_auth_sessions.sql` — Phase 4's `users`/`auth_nonces`/`sessions`, unchanged.
- `0006_chain_jobs_claims_audit_logs.sql` — new, schema-ready-but-unused tables for Phase 6/7's
  relayer outbox (`chain_jobs`) and Phase 10's reward claims (`claims`), plus `audit_logs`.

**`server/src/migrate.ts`** — hand-rolled runner (not a library — see ADR 0005 for why):
`runMigrations()` applies pending files in filename order, each in its own transaction;
`assertMigrationsApplied()` is a read-only check called once at server boot (`server/src/index.ts`,
replacing the old `await initSchema()` call) that refuses to start if any migration is missing —
migrations themselves are never run automatically at boot, only via the explicit
`npm run db:migrate`, specifically to avoid two replicas racing each other's DDL on deploy.

**`server/src/stateMachines.ts`** (new) — pure `canTransitionTicket`/`canTransitionVerifiedRun`/
`canTransitionClaim` functions, asserted at each relevant call site (e.g. `consumeTicket()`,
the new `sweepExpiredTickets()`) as a guard against code drifting out of sync with the state
machine; the real enforcement remains the database (`CHECK` constraints + atomic
`UPDATE ... WHERE status = '<from>' ... RETURNING`).

**`server/src/grid.ts`** — `recordGridRun` renamed to `recordVerifiedRun` (now takes and stores
`gameVersion`/`replayHash`, writes to `verified_runs` with a `status` column instead of
`suspicious`); new `sweepExpiredTickets()` moves stale `issued` tickets to `expired`, exposed via a
new admin endpoint `POST /api/admin/sweep-expired-tickets` (`server/src/index.ts`, `ADMIN_KEY`-
guarded like the existing admin routes — no scheduler exists yet, this is operator-triggered until
Phase 6/7's relayer replaces it).

**Testing — genuinely run, including a from-scratch database proof:**
- `server/src/stateMachines.test.ts` — 7/7 passing.
- `tsc --noEmit` clean on both packages after updating every call site off the deleted
  `initSchema`/`recordGridRun` names (`server/src/grid.integration.test.ts`,
  `server/src/auth.integration.test.ts` now call `runMigrations()` in `beforeAll` instead).
- `sim:sync`/`sim:check` clean (no sim drift).
- **Wiped the local dev Postgres volume entirely** (`docker compose down -v && docker compose up
  -d`), ran `npm run db:migrate` against the resulting empty database (confirmed via CLI output:
  all 6 migrations applied from nothing), then ran `npm run test:integration` — 12/12 passing
  against that freshly-migrated database, not the previously-initialized one.
- `npm test` — 42/42; `npm run sim:test` — 27/27 + cross-process fingerprint check.
- Full `npm run build` succeeds (mp3s temporarily relocated per the established pattern, restored
  after).
- CI's `integration` job now runs `npm run db:migrate` against the Postgres service container
  before the test step, matching the real fresh-database path proven above.

**Not done in Phase 5** (see ADR 0005): rollback/`down` migrations (nothing yet needs reversing
against real data), a migration linter/dry-run mode, and a rename-in-place migration for
`grid_runs`→`verified_runs` (unnecessary — it was never deployed, so the new name was used from
migration 0004 directly).

## Phase 6 — Smart contracts (DailyGridRegistry, VerifiedRunRegistry, SeasonPrizeVault)

First on-chain layer. A new `contracts/` Foundry project (solc 0.8.28, `lib/forge-std` and
`lib/openzeppelin-contracts@5.1.0` vendored as plain tracked files — matching BotSpend's own
dependency pattern, not git submodules) with three contracts, none deployed yet.

**`contracts/src/DailyGridRegistry.sol`** — publishes a day's grid parameters (seed, ruleset hash,
game version, opens/closes window) once, on-chain. `openGrid` reverts on a duplicate `dayId` with
no update path at all — turns "an operator cannot reroll a day's course" from a server-honesty
assumption (ADR 0003) into a contract-enforced guarantee. `owner` (cold) and `scheduler` (hot,
rotatable) are separate keys, matching BotSpend's owner/agent-key separation.

**`contracts/src/VerifiedRunRegistry.sol`** — the on-chain competitive receipt: one immutable
record per server-verified run (`recordRun`, `onlyRelayer`), rejecting both a duplicate `runId`
(anti-replay) and an unknown `gridId` (checked against an immutable `DailyGridRegistry`
reference, not merely trusted from the caller). Tracks per-player personal best per grid and
emits whether each run is one. Does not re-verify gameplay — that already happened server-side in
Phase 2; this contract's only job is making the already-verified result tamper-evident.

**`contracts/src/SeasonPrizeVault.sol`** — sponsor-funded, capped, publicly visible reward vault.
No Bull Rush token, no wagering: every season is funded up front (native BOT or an ERC20, sponsor's
choice), capped, and gated by a Merkle root that can be published exactly once (`publishMerkleRoot`
reverts if already set) — "rules published before competition" as an on-chain guarantee, not a
policy. `claim(seasonId, account, amount, proof)` is deliberately one permissionless function
serving both self-claim and a relayer's `claimFor` — the Merkle proof already authorizes exactly
`(account, amount)` regardless of who calls, and funds always move to `account`, never
`msg.sender`.

**`contracts/script/Deploy.s.sol`** — reviewed, not run. Deploys all three in dependency order;
Phase 15 is the gated point where this is actually broadcast.

**Testing — genuinely run, including a real static-analysis pass:**
- `forge build` — compiles clean.
- `forge fmt --check` — clean.
- `forge test -vv` — **43/43 passing** (11 DailyGridRegistry, 10 VerifiedRunRegistry, 22
  SeasonPrizeVault) covering every revert reason, both funding assets, permissionless claim-for
  and self-claim, double-claim/double-record/duplicate-dayId rejection, personal-best tracking in
  both directions, hot-key rotation, and a full 4-leaf Merkle tree claimed down to exactly its cap.
- `forge build --sizes` — all three contracts comfortably under the 24,576-byte EVM limit.
- `slither .` — ran against all three contracts; one `arbitrary-send-eth` finding on the vault's
  claim payout (reviewed and accepted — it's the intended `claimFor` design, gated by proof +
  cap + double-claim checks executing before it) and benign day/hour-granularity `timestamp`
  findings; no reentrancy finding. See ADR 0006 for the full disposition.
- One real bug was caught and fixed while writing tests (not left in): 3 `SeasonPrizeVaultTest`
  cases initially failed because `vault.NATIVE()` called inline as a `createSeason(...)` argument
  was itself an external call that consumed the preceding `vm.prank`/`vm.expectRevert`, masking
  the intended assertion. Fixed by hoisting a local `NATIVE` constant.

**Not done in Phase 6** (see ADR 0006): no relayer/indexer wiring the live server to these
contracts (Phase 7), no actual deployment to any network (Phase 15), no contract-driven grid
scheduling automation (still an `onlyScheduler` EOA), no Merkle tree generation tooling (Phase 10).

## Phase 7 — Relayer + chain indexer

Wires the live server to Phase 6's contracts. Gameplay never touches the chain directly —
`POST /api/grid/submit`/`POST /api/admin/grid/open` respond immediately; a durable outbox
(`chain_jobs`, schema-ready since migration 0006) queues the on-chain write, and a separate
relayer process drains it on its own schedule.

**`server/src/chain/onchainIds.ts`** — `toOnChainGridId(dayId)` = `keccak256(dayId)` (keyed off
the public calendar-day string, not the internal Postgres UUID, preserving ADR 0003's
public-derivability property); `toOnChainRunId(gridId, player, replayHash)` per ADR 0006's
recommended scheme.

**`server/src/chain/outbox.ts`** — `enqueueChainJob` (idempotent via `ON CONFLICT
(idempotency_key) DO NOTHING`), `claimNextJob` (atomic `FOR UPDATE SKIP LOCKED` dequeue),
`markSubmitted`/`markConfirmed`/`markReverted`/`markAttemptFailed` (exponential backoff, parks as
`failed` after 5 attempts). New `chain_job`/`daily_grids.indexing_state` state machines in
`server/src/stateMachines.ts`, same database-enforced compare-and-set pattern as every prior
phase's tables.

**`server/src/chain/relayer.ts`** — `processOneJob`/`drainJobs`/`startRelayerLoop`. One
transaction at a time, waiting for each receipt before claiming the next. `loadChainConfig()`
(`server/src/chain/client.ts`) returns `null` unless `CHAIN_RELAYER_ENABLED=true` and every
required env var is set — the relayer is a genuine no-op in every environment today, since
nothing is deployed anywhere yet (Phase 15).

**`server/src/chain/indexer.ts`** — `fetchGridOpenedEvents`/`fetchRunRecordedEvents`, read-only,
independent of the relayer's own bookkeeping (what Phase 9's ghost races will read from).

**`server/src/grid.ts`** — `openGrid()` enqueues an `open_grid` job and transitions
`indexing_state` `off_chain -> queued`; `recordVerifiedRun()` enqueues a `record_run` job (only
for a personal best — a worse run has nothing new to attest to on-chain) and transitions
`verified_runs.status` `verified -> receipt_queued`. `server/src/index.ts` — new
`GET /api/admin/chain-jobs` (list) and `POST /api/admin/chain-jobs/process` (manual bounded
drain), same `ADMIN_KEY` guard as every other admin route; relayer loop started conditionally at
boot.

**Two real bugs found and fixed while building this (not by inspection — by writing a real
end-to-end test against real infrastructure):**
1. `hashCanonical` (`src/sim/replay.ts`) was still the Phase 2 32-bit FNV-1a fingerprint, exactly
   as that phase's own comment flagged it would need upgrading once a contract actually encoded
   these values as `bytes32`. Fixed to `keccak256(toHex(canonicalStringify(value)))` via viem —
   a one-function change (per the original plan) fixing `RULESET_HASH`, Daily Grid seeds, and
   `replayHash` at once. Confirmed no gameplay-determinism fallout (`sim:test`'s cross-process
   fingerprint check unchanged) and no test relied on a specific literal hash value.
2. `chain_jobs` has no per-deployment scoping (correct for production — one real relayer, one
   real contract set) but let two integration test files (each deploying its own disposable
   contracts to its own local anvil instance) cross-contaminate the shared queue when Vitest ran
   them in parallel. Fixed via `fileParallelism: false` in `server/vitest.config.ts` (every
   integration test file already shares one real Postgres/Redis) plus a `DELETE FROM chain_jobs`
   at the start of the new relayer test's own `beforeAll`.

**Testing — genuinely run, including a real local blockchain:**
- `server/src/chain/onchainIds.test.ts` (8) + state-machine extensions (13) — pure, fast.
- `server/src/chain/relayer.integration.test.ts` (4) — **real anvil**, deploying the actual
  compiled Phase 6 bytecode from `contracts/out/*.json`: an `open_grid` job reaches `confirmed`
  with `DailyGridRegistry.gridExists` true on-chain; a `record_run` job reaches `confirmed` with
  `VerifiedRunRegistry.recorded` true on-chain; the indexer independently reads back both events;
  double-enqueue never produces two rows. Run twice back-to-back to confirm the contamination fix
  actually holds, not just passed once by luck.
- Full regression: `tsc --noEmit` clean both packages; `sim:sync`/`sim:check` clean; `npm test`
  56/56 (+7); `sim:test` 27/27 unchanged; `test:integration` 16/16 (+4) against a freshly-migrated
  database; full `npm run build`; `forge test` 43/43 unchanged.
- CI's `integration` job now installs the Foundry toolchain and runs `forge build` in
  `contracts/` first (the relayer test spawns `anvil` and deploys from those artifacts directly).

**Not done in Phase 7** (see ADR 0007): no confirmation-count/finality wait beyond one receipt,
no dead-letter alerting (list/manual-drain admin endpoints only), no transaction batching, no
actual deployment anywhere (still Phase 15).

## Phase 8 — End-of-run receipt-status UX

Surfaces Phase 7's `verified -> receipt_queued -> submitted -> confirmed` progression to the
player. Claim UX is explicitly NOT built — nothing claimable exists yet (no season, no funded
vault, no Merkle tree; all Phase 10), and building a claim button against a fabricated
entitlement would violate this project's standing rule against building UI for something that
isn't genuinely real yet.

**`server/src/grid.ts`** — `recordVerifiedRun` now returns `{ id, isPersonalBest, status }`
instead of just `{ isPersonalBest }`; new `getVerifiedRunStatus(runId, identityKey)`,
ownership-checked (filters on `identity_key` in the same query, not just an unguessable UUID).

**`server/src/index.ts`** — submit response gains `runId`/`status` (only for a non-suspicious
accepted run — a shadow-hidden run gets neither, preserving the existing silent-hide anti-cheat
posture); new `GET /api/grid/run/:id/status`.

**`src/gridApi.ts`** — `GridSubmitResult` gains `runId`/`status`; new `getRunStatus(runId)`.
**`src/ui/GameOver.tsx`** — derives `receiptRunId` from `verified.isPersonalBest` +
`verified.runId` (no receiptRunId, no polling — a non-personal-best run has nothing to watch);
polls every 3s for up to ~2 minutes, showing RECEIPT QUEUED/SUBMITTED/CONFIRMED (with a BOTScan
link on confirm) using `explorerTx`/`BOT_CHAIN_MAINNET_ID` from `src/wallet/chain.ts`. Polling is
honestly bounded, not indefinite — matches Phase 7's own no-fabricated-finality posture.

**`scripts/verify-grid-local.ts`** (new, `npm run local:verify:grid`) — a throwaway wallet signs
a real SIWE message, verifies, opens a grid, requests a ticket, plays and submits a real
deterministic run, and polls its own run's status against a live local server. Joins
`scripts/verify-local.ts` as a committed, repeatable local E2E tool (that one covers the classic
practice path; this one covers wallet + Daily Grid + receipt status).

**Testing — genuinely run:**
- `server/src/grid.integration.test.ts` — 2 new tests (real Postgres + Redis): a personal best
  starts at `receipt_queued` and is pollable only by its own identity; a non-personal-best run
  rests at `verified` with `isPersonalBest: false`.
- **Real live HTTP round-trip** via `npm run local:verify:grid` against a running local server —
  confirmed the submit response and the status-poll response agree exactly, with a genuine SIWE
  signature and a genuine re-simulated run, no mocks anywhere in the path.
- Headless-Chrome (CDP) bundle sanity check: the dev server's bundle (including the new
  `wallet/chain.ts` import into `GameOver.tsx`) imports and React mounts without error; the run
  only fails at Three.js's WebGL context creation, a headless-sandbox GPU limitation unrelated to
  this change. Full interactive visual verification of the receipt UI mid-gameplay wasn't
  possible in this sandbox — noted explicitly rather than claimed.
- Full regression: `tsc --noEmit` clean both packages; `sim:sync`/`sim:check` clean; `npm test`
  56/56 unchanged; `sim:test` 27/27 unchanged; `test:integration` 18/18 (+2); full `npm run build`.

**Not done in Phase 8** (see ADR 0008): claim UX (Phase 10 — nothing claimable exists yet), and
full interactive browser verification of the receipt UI during live gameplay (sandbox WebGL
limitation; the underlying data flow was instead proven via a real HTTP round-trip).

## Phase 9 — Verified ghost races

The payoff of determinism: race the *actual, provably real* run of another player. Every grid
shares one seed and every result is a hash-receipted replay, so a ghost is a local re-simulation
of the exact input trace the leaderboard entry is bound to — verified by the racer's own machine,
not taken on faith.

**Server**: migration `0007_verified_run_replays.sql` adds `verified_runs.replay` jsonb (the
canonical flat-encoded trace, stored for every recorded run — risk_hold rows included, for Phase
12's manual review) and a `UNIQUE (grid_id, replay_hash)` index. `recordVerifiedRun` stores the
trace and was reordered so the INSERT (the atomic anti-copy gate) precedes the Redis leaderboard
write — a racing duplicate can no longer touch the board and then fail to persist. New
`getGridGhost(gridId, identityKey?)` + `GET /api/grid/:id/ghost` (leader by default, `?self=1`
session-scoped). Submit handler rejects `duplicate_replay` (409): friendly pre-check
(`gridHasReplayHash`) + 23505 catch for the true race.

**Why the anti-copy gate exists**: ghost replays are necessarily public (racing one means
downloading its input log) and the seed is shared, so a verbatim copy through a fresh ticket
would re-simulate to the original's exact result. Exact copies are now database-rejected; a
*perturbed* copy evades the exact-hash check by construction — near-duplicate detection is
input-trace similarity analysis, explicitly deferred to Phase 11's behavioral-signals layer.

**Client**: `src/sim/ghost.ts` (deliberately NOT in the sim:sync set — pure presentation):
`buildGhostTrace` pre-computes the ghost's full per-tick position trace through the same
deterministic sim; `verifyGhostReplay` re-hashes the served bytes and refuses a mismatch.
`replayHash`'s signature narrowed to `Pick<RunReplay, 'inputs' | 'ticks'>` so a trace-only
verifier provably computes the identical value. `gridApi.getGridGhost` verifies before
returning. `DailyGrid` gains "RACE THE LEADER'S GHOST ▸" (ghost fetched BEFORE the ticket so a
failed fetch never wastes one; seed mismatch = no ghost). `SimScene` renders a translucent cyan
phantom placed at the player's CURRENT tick (lockstep, not wall-clock); `Hud` shows the live gap
(`▲ GHOST +12m` / `▼ GHOST −8m`).

**Testing — genuinely run:**
- `src/sim/ghost.test.ts` (8): trace ends exactly where `simulate()` says, deterministic,
  monotonic; hash verification rejects tampered/truncated/wrong-ticks traces.
- Integration (+3, real Postgres+Redis): leader ghost re-hashes to the stored hash; self ghost;
  no-runs → no ghost; full anti-copy: pre-check true, copier's insert rejected 23505, copier
  never on the leaderboard.
- **Live over real HTTP** (`npm run local:verify:grid`): real SIWE sign-in → real run → ghost
  fetched and hash-verified locally (`hashVerified=true`) → **the actual copy attack mounted**
  (ghost's public log resubmitted verbatim through a fresh ticket) → `409 duplicate_replay`.
- Fresh-DB proof: wiped volume, all 7 migrations from nothing, 21/21 integration; 0007 also
  proven against the populated local DB (its dedup step cleared old same-hash fixtures first).
- Full regression: `tsc --noEmit` clean both packages; `sim:check` clean; `npm test` 64/64 (+8);
  `sim:test` 35/35 (+8), cross-process fingerprint unchanged; full `npm run build`.

**Not done in Phase 9** (see ADR 0009): near-duplicate (perturbed-copy) detection (Phase 11), a
client race-your-own-best button (server path exists and is tested; UI deferred), and any ghost
for practice runs (ghosts are grid-only by definition — only grid runs are verified).

## Phase 10 — Season Zero: reward design + Merkle entitlements

The layer between verified runs and the funded vault: who earned what, committed once, provable
by anyone. Bound by the locked economy decisions — no token, no emissions, pre-funded capped
pools, rewards only for independently verified performance, rules published before competition.

**Rules first**: `docs/SEASON-ZERO.md` publishes the complete season structure before anything
opens — per-grid points table (`[40,25,15,8,5,3,1,1,1,1]` for positions 1-10),
points-proportional pool split with floor division (dust stays in the vault, stated openly),
verified-runs-only eligibility, risk_hold = zero points, both claim paths (relayer `claimFor` +
self-claim fallback), and a "verify it yourself" section.

**Server**: migration `0008_seasons.sql` (seasons table + one-claim-per-user-per-season and
per-season merkle_index uniques). `rewards.ts` — pure math, no I/O: points, entitlements,
`buildSeasonTree` via `@openzeppelin/merkle-tree`'s StandardMerkleTree, which produces exactly
SeasonPrizeVault's `keccak256(bytes.concat(keccak256(abi.encode(account, amount))))` leaf
(proven by a hand-computed viem vector AND by real on-chain claims — below). `seasons.ts` — DB
flow: `createSeason`, `closeSeason` (atomic close-once via `UPDATE ... WHERE status='draft'`;
refuses while the window is open, no force flag; standings from **Postgres, never Redis** — a
payout must derive from the durable record, not a rebuildable display cache; ties break
deterministically), `getRewardsForUser` (proofs rebuilt from the claim rows on every request and
cross-checked against the committed root — tampered rows throw instead of serving proofs). New
endpoints: `GET /api/season/current` (public), `GET /api/rewards/me` (session),
`POST /api/admin/season/create|close`.

**Client**: `rewardsApi.ts` + a VERIFIED SKILL REWARDS section in the DailyGrid panel listing
entitlements (season, amount in BOT, status). Display-only by design — no vault is deployed
anywhere yet (Phase 15), so a claim button would be dead code against no address.

**Testing — genuinely run, including funds moving on a real chain:**
- `rewards.test.ts` (9, pure) — split math, floor-never-exceeds-pool, determinism, leaf vector.
- `seasons.integration.test.ts` (3, real Postgres + anvil running the actual compiled
  SeasonPrizeVault bytecode): three seeded players → close → correct floor amounts →
  createSeason/publishMerkleRoot/fundNative on-chain → **every TypeScript-built proof claims
  successfully, exact balance deltas verified, double-claim reverts** — the cross-implementation
  proof that the TS tree and the Solidity verifier agree; close rejections; a flagged 99,999m
  run earns nothing.
- **Live over real HTTP** (`npm run local:verify:grid`): season created, grid pulled into its
  window, closed, `GET /api/rewards/me` returns the sole player's full pool with the matching
  root. Bonus finding: the script initially tripped the REAL `botLike` gate — its
  perfectly-regular 19-tick synthetic cadence got `risk_hold`'d the moment a run survived past
  the heuristic's 30-input floor (earlier, shorter runs had slipped under it). Fixed by
  jittering the cadence; logged as live evidence the behavioral gate fires on machine-regular
  input.
- Fresh-DB proof: wiped volume → all 8 migrations from nothing → 24/24 integration (+3).
- Full regression: `tsc --noEmit` clean both packages; `sim:check` clean; `npm test` 73/73 (+9);
  `sim:test` 35/35, fingerprint unchanged; full `npm run build`. Dependency triage for
  `@openzeppelin/merkle-tree`'s transitive `uuid` audit finding documented in ADR 0010
  (unreachable code path, same method as ADR 0004).

**Not done in Phase 10** (see ADR 0010): on-chain root publication/funding/claimFor against a
real deployment (Phase 15), a season scheduler (admin-triggered interim, same pattern as grid
opening), sponsor ERC20 season runs (vault's ERC20 path already covered by Foundry tests).

## Phase 11 — Behavioral risk signals

The layer above the architectural anti-cheat: signals for behavior that produces genuinely
valid replays by illegitimate means. Signals **shadow-hold, never hard-reject** — a behavioral
signal is a probability, so its consequence is `risk_hold` (recorded, boardless, zero reward
points, submitter told nothing), and a false positive costs a review, not an honest player.

**`server/src/behavior.ts`** (pure, no I/O): the Phase 2 cadence heuristic moved here verbatim
(practice + grid now share one definition), duration bounds, and the perturbed-copy detector
ADR 0009 deferred here — tolerance-based LCS over the input trace (action equal + ticks within
±3; ≥0.85 of max length = near-duplicate). Insertion-tolerant, so decoy taps don't break
alignment; the decisive asymmetry is that independent humans never agree tick-exactly on ≥85%
of a log while a perturbed copy must. Candidates pre-filtered by same-grid + replay length and
outcome within ±15% (a copy necessarily lands near its source), bounding the O(n·m) DP.

**Migration `0009_risk_signals.sql`**: `verified_runs.risk_reasons text[]` (evidence for Phase
12 review, not a bare boolean) + `ip_hint` (first 16 hex of `sha256(salt:ip)`, NULL unless
`IP_HINT_SALT` is set — never a raw IP). **Escalation**: 3 holds in 7 days →
`users.risk_state = 'flagged'` — a review marker with deliberately zero automated consequence.
**Sybil visibility**: grids where ≥2 wallets share a network origin surface in
`GET /api/admin/risk` (held runs + reasons, flagged users, clusters) — review signals only;
households share IPs.

**Two floors, deliberately different**: cadence keeps 30 inputs (variance needs a sample);
similarity runs from 15 — because the live E2E script *found the gap*: a perturbed copy of a
28-input leader run sailed under the original shared floor of 30. Lowered, re-run, shadow-held.

**Testing — genuinely run, including the live attack:**
- `behavior.test.ts` (14, pure) + `behavior.integration.test.ts` (4, real Postgres+Redis):
  jittered copy of a stored replay caught via the real candidates query; reasons persist and
  surface; 3 holds flags a user, 2 don't; ip_hint clusters surface.
- **Live over real HTTP** (`npm run local:verify:grid`, extended): the perturbed-copy attack —
  ghost log stolen, ticks nudged so the hash changes, submitted through a fresh ticket —
  returns `ok:true, hidden:true`: shadow-held, no runId, copier told nothing. Exact-copy 409
  and every prior loop stage still pass.
- Fresh-DB proof: all 9 migrations from nothing → 28/28 integration (+4). Full regression:
  typechecks clean, `sim:check` clean, 87/87 unit (+14), 35/35 sim (fingerprint unchanged),
  full build.

**Not done in Phase 11** (see ADR 0011): automated penalties of any kind (Phase 12's human
review decides), cross-grid behavioral profiling / reaction-time analysis (the reasons array
is where it would land), practice-path similarity (random seeds — nothing to copy).

## Phase 12 — Admin/ops security hardening

Replaces the bare `header !== ADMIN_KEY` model every admin route used through Phase 11, and
builds the manual-review workflow Phase 11's risk signals were collecting evidence for.

**`server/src/adminAuth.ts`** (pure) — constant-time key comparison (`timingSafeEqual` over
sha256 digests, so neither content nor length leaks), read/write role separation
(`ADMIN_WRITE_KEY`/`ADMIN_READ_KEY`, write implies read, legacy `ADMIN_KEY` still resolves as
write for deployment continuity but is superseded the moment the new key is set), and
parameter fingerprints. **`server/src/adminConfirm.ts`** — Redis-backed confirm tokens:
5-minute TTL, single-use by construction (GETDEL before validation — a mismatch attempt burns
the token), bound to the exact action + parameters. **`server/src/audit.ts`** — first real
writer to the `audit_logs` table (schema-ready since migration 0006, never written until now);
best-effort by design (a broken audit table must never take season closing down).

**Endpoints**: all 13 admin routes now role-gated with per-IP brute-force damping on failures;
`stats`/`risk`/`chain-jobs`/`audits` need only read. The two irreversible actions —
`season/close` and `purge-suspicious` — are two-step: first call returns a preview (close's is
a full dry-run: root, claim count, total) + a single-use confirm token; only the identical
request replayed with the token executes. `?dryRun=1` on both requires only read credentials.
Every mutation audits (actor = role + salted network hint, never a raw IP). New review
actions: `POST /api/admin/risk/release` (the ONLY path out of `risk_hold` — state machine now
permits exactly `risk_hold → verified`; the released run gets precisely the tail a clean
record would have gotten: leaderboard, PB check, receipt enqueue) and
`POST /api/admin/risk/clear-user` (`flagged → none` only). `GET /api/admin/audits` serves the
trail. `closeSeason` gained a `{ dryRun }` option (computes everything, writes nothing).

**Testing — genuinely run:**
- `adminAuth.test.ts` (7, pure): every credential combination incl. legacy fallback and
  write-key precedence; fingerprint order-independence.
- `admin.integration.test.ts` (7, real Postgres+Redis): confirm tokens exactly-once and
  parameter-bound (mismatch burns); audit rows round-trip; release lands the held run on the
  board at its real distance with exactly one receipt job and refuses a second release;
  clear-user exactly once. State-machine tests updated (`risk_hold → verified` legal,
  `→ verifying/receipt_queued` still not).
- **Live over real HTTP**: season close now genuinely two-step in `verify-grid-local.ts` —
  `confirmRequired` + preview, then confirmed execution, script asserts preview root ==
  executed root; the live audit trail inspected afterward shows `grid.open`, `season.create`,
  `season.close` with actor/target/metadata.
- Fresh-DB proof (9 migrations) → 35/35 integration (+7); 94/94 unit (+7); 35/35 sim
  (fingerprint unchanged); typechecks + `sim:check` clean; full build.

**Not done in Phase 12** (see ADR 0012): named admin identities (actor field is free-text so
they slot in later without a migration), a session-based admin UI, refuse-on-audit-failure
mode (availability-over-completeness default, documented).

<!-- Append future phase entries below this line, in commit order. -->
