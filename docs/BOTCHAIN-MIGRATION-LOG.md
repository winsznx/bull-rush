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

<!-- Append future phase entries below this line, in commit order. -->
