# Bull Rush — technical

How a score becomes something provable, and how a proven score becomes a claimable reward.

## The core problem

A browser game's client is fully under the player's control. Anything it reports — score,
distance, "I survived 90 seconds" — is a claim by an adversary, not evidence. The usual
mitigations (obfuscation, heuristics, "does this look plausible?") are all guesses.

Bull Rush's answer: **the client never reports a score at all.** It reports what it *did*, and
the server re-derives the outcome.

## Deterministic simulation

The game logic lives in `src/sim/`, byte-identical to `server/src/sim/` (enforced in CI by
`sim:check`, which fails the build on drift).

Properties that make replay possible:

- **Fixed-point integer arithmetic only.** No floats in gameplay state. Float rounding differs
  across CPUs and JS engines; integers don't.
- **Seeded PRNG** (`mulberry32` seeded via `xmur3`), drawn in a fixed order. No `Math.random()`
  anywhere in gameplay.
- **Fixed 60 Hz timestep**, decoupled from render rate via an accumulator, with **capped
  catch-up** — a backgrounded tab or a stalled frame drops its backlog instead of fast-forwarding.
  Elapsed real time can never be converted into free distance.

Determinism is verified in CI by a **cross-process fingerprint check**: the simulation is run in
two separate OS processes and their outputs are diffed. A single test process could share state
and pass while the property was actually broken; two processes cannot.

## Replay verification

A submitted run is a `RunReplay`: schema version, game version, ruleset hash, the server-issued
seed, the run's ticket ID, the input trace (`{tick, action}[]`), and total tick count. **It
contains no distance and no score** — there is no field in which to lie about the outcome.

Verification, in order, cheapest first:

1. **Envelope checks** — schema version, game version, ruleset hash, and that the seed matches
   the one the server itself issued for this ticket. Each failure has a distinct named reason.
2. **Structural validation** — rejects `missing_input_log`, `excessive_log_size`,
   `truncated_or_zero_ticks`, `future_tick`, `out_of_order_tick`, `unknown_action`,
   `impossible_action_frequency`. A replay that couldn't be a real play session is discarded
   before any CPU is spent simulating it.
3. **Re-simulation** — only now does the server run `simulate(seed, inputs, ticks)` and derive
   distance, score, max combo, death cause, and duration. **These derived values are the only
   ones ever stored, ranked, or receipted.**

The ruleset hash covers every gameplay-affecting constant, so a client running modified physics
is rejected at step 1 rather than producing a subtly wrong result at step 3.

**There is no "trusted client" fallback.** The legacy non-deterministic engine cannot submit
competitive scores at all — it's reachable only in a dev build behind an explicit flag.

## Daily Grid

The same course for everyone, in a fixed window.

- **Seed** = `hash(dayId, gameVersion, rulesetHash)` — a pure function of public information.
  Anyone can re-derive today's seed. There is nothing to reroll.
- **Inspection delay** — a grid is published, then tickets open 5 minutes later, giving anyone
  time to independently verify the seed before a single competitive run counts.
- **On-chain immutability** — `DailyGridRegistry.openGrid` reverts on a `dayId` that already
  exists, and the contract has *no* function that can modify a stored grid. Not for the
  scheduler, not for the owner.
- **One active ticket per identity**, enforced by an atomic Redis `SET NX` lock before any
  Postgres write, closing the race two concurrent requests would otherwise hit. Ticket
  consumption is an atomic `UPDATE … WHERE status='issued' … RETURNING`, so a ticket cannot be
  spent twice even under concurrency.

## Identity and session

Wallet + SIWE (EIP-4361), hand-rolled against the spec on both sides rather than sharing code.

- Guests play unlimited practice runs with **no wallet, no signature, no friction.**
- A wallet is required **only** to enter the ranked Daily Grid — one signature to sign in.
- **Never a signature or transaction during play**, and never per-run.
- Two-tier sessions: a short-lived Redis access token plus a rotating, hash-only-stored Postgres
  refresh token. Nonces are single-use and consumed atomically.

Before this, the leaderboard was keyed on a **display name** — anyone could impersonate anyone by
typing their name. Identity is now a wallet address; display names are cosmetic, reserved-word
filtered, and uniqueness-checked.

## On-chain layer

Three contracts on BOT Chain mainnet (677), deployed and source-verified.

**`DailyGridRegistry`** — commits each day's course parameters on-chain, once, immutably.
Separates cold `owner` from a rotatable hot `scheduler`.

**`VerifiedRunRegistry`** — one immutable receipt per server-verified run. Rejects duplicate
`runId` (anti-replay on retries) and rejects any `gridId` the `DailyGridRegistry` has never seen —
checked on-chain against the real registry, not trusted from the caller. Tracks per-grid personal
bests.

It does **not** re-verify gameplay: Solidity cannot cheaply re-run the simulation. Verification
stays off-chain where it's affordable; the contract's job is to make an already-verified result
tamper-evident and non-replayable.

**`SeasonPrizeVault`** — sponsor-funded, capped, Merkle-gated rewards. A season's root is
publishable exactly once (`RootAlreadyPublished` on a second attempt), so rules cannot change
after competition. The cap is enforced at claim time *independently* of what the tree sums to —
defense in depth against a bad off-chain tree. `claim(seasonId, account, amount, proof)` is one
permissionless function serving both self-claim and relayer `claimFor`, because the proof already
authorizes exactly one `(account, amount)` pair and funds always move to `account`, never
`msg.sender`.

**Chosen immutable** — no proxies, no upgrade path. A bug means deploying replacements and
re-pointing config, which is the tradeoff accepted in exchange for "the rules cannot change out
from under you" being literally true.

## Receipts without interrupting play

Gameplay never blocks on a transaction. Submitting a run enqueues an idempotent job in a durable
Postgres outbox (`chain_jobs`) and returns immediately. A separate relayer drains that queue,
one transaction at a time, waiting for each receipt before claiming the next (so nonce management
never has to reason about concurrent in-flight transactions).

- Enqueue is idempotent via a unique idempotency key — calling twice is always safe.
- Dequeue is atomic (`FOR UPDATE SKIP LOCKED`), so multiple relayer processes could run without
  double-claiming a job.
- Failures retry with exponential backoff, then park as `failed` for operator attention.
- Only a **personal best** is receipted — a worse run has nothing new to attest to, bounding gas
  to roughly one write per player per grid.

Run status moves `verified → receipt_queued → submitted → confirmed`, and the end-of-run UI polls
it, showing a BOTScan link on confirmation.

## Anti-cheat beyond architecture

Architectural verification makes a *wrong* score impossible. Behavioral signals address a
*legitimately-produced but suspicious* one: inhuman input cadence regularity, impossible
durations, and **perturbed-copy detection** — catching a replay that is a jittered copy of
another player's run rather than an independent session. Flagged runs enter `risk_hold`, whose
only exit is an explicit, audited operator release. A held run is shadow-hidden: the player sees
nothing distinguishing it, so a cheater gets no feedback signal to tune against.

## Operations

- **Versioned SQL migrations**, applied as an explicit step. The server **refuses to boot**
  against a database with pending migrations, so a forgotten migration fails loudly instead of
  crashing on the first query that touches a missing column.
- **Explicit state machines** for tickets, runs, claims, chain jobs, and grid indexing —
  asserted in code *and* enforced by database `CHECK` constraints and compare-and-set updates.
- **Split admin credentials** (read vs write), constant-time comparison, and **confirmation
  tokens** for dangerous mutations: a destructive action called without one returns a
  short-lived, single-use token bound to those exact parameters. A leaked token works neither
  twice nor for different arguments.
- **Structured JSON logging** with name-based redaction applied recursively, so credential-shaped
  fields can't leak through a nested object someone forgot about.
- **Full-history secret scanning** in CI — a secret committed and later reverted is still leaked.

## Verification you can reproduce

```bash
npm run release:check   # 10 gates: secret scan, typechecks, sim determinism,
                        # 213 tests, contracts, production build
```

Everything is checkable: 213 automated tests, contract source verified on BOTScan, deployed
bytecode length matching the tested build exactly, and a live local end-to-end script
(`npm run local:verify:grid`) that signs a real SIWE message and drives the whole path with no
mocks.

See `TESTING-STATUS.md` for what is *not* verified — it is not a short list.
