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

<!-- Append future phase entries below this line, in commit order. -->
