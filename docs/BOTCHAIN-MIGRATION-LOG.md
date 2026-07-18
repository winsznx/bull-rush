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

<!-- Append future phase entries below this line, in commit order. -->
