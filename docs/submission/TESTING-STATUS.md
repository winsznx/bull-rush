# Testing status — what has and has not been tested

This document exists so nobody evaluating Bull Rush has to guess which claims are backed by
evidence. It is deliberately unflattering where the truth is unflattering.

## The short version

| | Status |
|---|---|
| Automated tests | **213 passing** across 4 suites |
| Contracts on mainnet | **Live and source-verified** on BOT Chain 677 |
| Game + API deployed to production | **No** — production runs the pre-migration build |
| External playtesters | **Zero.** None recruited, none run |
| Relayer running anywhere | **No** — `CHAIN_RELAYER_ENABLED` unset in every environment |
| Season Zero funded | **No** — no season created or funded on the vault |
| First on-chain grid opened | **No** |

## What IS verified

### Automated tests — 213 passing

| Suite | Tests | What it proves | Real dependencies |
|---|---|---|---|
| Unit | 97 | Replay validation, SIWE parsing, state machines, reward math, risk signals, admin auth, log redaction | none |
| Sim | 35 | Deterministic engine correctness; **cross-process fingerprint** (`1183386224`) proves two separate OS processes produce identical results | none |
| Integration | 38 | Grid lifecycle, SIWE sessions, relayer outbox, seasons/claims, admin flows | **real** Postgres + Redis + **anvil** |
| Contracts | 43 | Every revert path, double-claim/double-record rejection, cap enforcement, hot-key rotation | Foundry EVM |

The integration suite runs against real Postgres, real Redis, and a real local blockchain
(anvil) executing the **actual compiled contract bytecode** — not mocks. The Merkle proofs in
the reward tests are verified by the real `SeasonPrizeVault`, and the TypeScript tree builder was
proven byte-identical to the contract's own leaf encoding.

### Mainnet deployment

Deployed, and then independently re-verified from chain rather than trusting the deploy tool:
receipts re-fetched (`status 0x1`), `eth_getCode` byte lengths compared against the tested build
(**exact match**: 2456 / 2849 / 3907), constructor state and cross-contract wiring read back via
`cast call`, and verification status queried from the explorer API after submission. Details:
`docs/MAINNET-DEPLOYMENT.md`.

### Live end-to-end, locally

`npm run local:verify:grid` drives the full path against a running local server with **no mocks**:
a throwaway wallet signs a real SIWE message, authenticates, enters a grid, plays a real
deterministic run, submits it, and polls its own receipt status. This is run as part of
verification, not just written.

## What is NOT verified — read this before evaluating

### 1. Zero external playtesting

**No one outside this project has played the rewritten game.** No testers recruited, no sessions
observed, no feedback collected, no bug reports from real users. Every number in this repo comes
from automated tests or first-party manual runs.

This is the single biggest gap. Automated tests prove the system does what it was designed to do;
they say nothing about whether the game is *fun*, whether the wallet flow is comprehensible to
someone who has never used SIWE, or whether the Daily Grid's difficulty curve is right. A
recruitment plan is below — it has not been executed.

### 2. The migration is not deployed to production

`trybullrush.xyz` currently serves the **pre-migration build** (confirmed: its `/status` endpoint
404s, and the page title is the old one). Everything described in the technical documentation —
mandatory replay verification, Daily Grid, wallet auth, receipts, seasons — lives on the branch
`feat/botchain-mainnet-skill-rewards` and runs locally, but **is not what a visitor to the
production URL gets today.**

### 3. No live relayer, no funded season, no on-chain grid

The contracts are deployed but inert by design. `CHAIN_RELAYER_ENABLED` is unset everywhere, so
no relayer process is running and no run has been receipted on mainnet. No season has been
created or funded on `SeasonPrizeVault`, and no grid has been opened on-chain. A player today
would see "RECEIPT QUEUED…" indefinitely — which is the honest reflection of a real job sitting
in a real queue whose consumer has not been switched on.

### 4. Browser verification is partial

The game's rendering was checked in headless Chrome only far enough to confirm the bundle loads
and React mounts; the sandbox could not create a WebGL context, so **full interactive visual
verification of the 3D game during live gameplay was not possible in this environment.** The
underlying data flows were instead proven via real HTTP round-trips.

### 5. Hot keys are not rotated

`scheduler` and `relayer` on the deployed contracts both point at the deployer account. They are
rotatable without redeploying, but until that happens, a relayer hot-key compromise would cost
ownership of all three contracts, not just relayer gas.

## Claims deliberately excluded

The project brief referenced a prior award ("second place in the BOT Chain Agent Track"). An
exhaustive search of the referenced repository found **zero supporting evidence** — no
announcement, correspondence, or record. Per the brief's own instruction not to publish the claim
without support, **it is excluded from all submission material** and appears nowhere in this
repository. It can be added if the project owner supplies independent evidence; it will not be
asserted on the basis of memory.

## Tester recruitment plan (not yet executed)

Written so it can be run, and so its absence is measurable rather than vague.

**Target:** 8–12 testers across three groups — 3–4 who have never used a crypto wallet, 3–4
comfortable with wallets but new to the game, 2–3 skilled action-game players.

**Setup:** deploy the branch to a staging URL, fund a small test season on the vault, enable the
relayer with a dedicated hot key, and open a real Daily Grid.

**Each session (~20 min):** play as a guest first (no wallet), then connect and enter the Daily
Grid, complete at least one ranked run, and attempt a claim if entitled. Observe without
assisting; note every point of confusion.

**Instrument, don't just ask.** The metrics endpoint already records per-route request counts and
latency buckets, and the audit trail records every admin action, so drop-off can be measured
rather than self-reported.

**Questions worth asking:** Where did you get stuck? Did you understand *why* a wallet was needed
at that moment? Did you believe the score was fair? Did you understand what a "receipt" meant?
Would you come back tomorrow for a new grid?

**Report results here** — including the unflattering ones — replacing this section with what
actually happened, the tester count, and the bugs found.
