# Submission form — draft answers

Reusable answers for common submission fields. **Every factual claim here is verified**; see
`TESTING-STATUS.md` for the matching list of what is *not* done.

> **Before submitting:** re-read the "Honest disclosures" section at the bottom and make sure the
> form's own questions are answered with the same candour. If a form asks "is it live?", the
> answer is nuanced — contracts yes, game no.

---

## One-line description (≤ 100 chars)

> A verifiable onchain skill runner where the server replays your run to prove your score.

## Short description (≤ 280 chars)

> Bull Rush is a verifiable onchain skill runner on BOT Chain. Every player races the same
> deterministic Daily Grid, and the server re-simulates each run from its input trace — so a
> score is proven, never claimed. Verified runs are receipted onchain; rewards are sponsor-funded.

## Elevator pitch (~150 words)

> Most web games take the browser's word for your score. Bull Rush never does.
>
> Every day, every player races the same deterministic course — the Daily Grid, whose seed is a
> pure function of public information and is committed onchain before play begins, immutably.
> When you finish, your client submits no score at all. It submits the seed it was given and the
> exact tick each input landed on. The server replays that trace through a bit-identical
> deterministic engine and derives the result itself.
>
> A tampered replay doesn't score higher — it gets rejected with a named reason.
>
> Verified runs become onchain receipts, and sponsor-funded, capped rewards are claimable via
> Merkle proof — self-claim or gas-sponsored, your choice. Play as a guest with zero friction; a
> wallet is needed only to enter ranked play, and never signs during a run.
>
> **Play first. Prove the run. Claim what you earned.**

## What problem does it solve?

> Onchain gaming leaderboards are usually only as trustworthy as the client reporting to them. If
> the browser submits the score, the score is an adversary's claim. The common fixes — heuristics,
> obfuscation, plausibility checks — are guesses that punish good players and miss good cheaters.
>
> Bull Rush makes scores *verifiable* instead of *trusted*: deterministic simulation, replay
> submission, server-side re-derivation, and an onchain receipt. The same machinery makes rewards
> defensible — you can only be paid for a run that was independently reproduced.

## What did you build on BOT Chain?

> Three contracts, deployed and source-verified on mainnet (chain 677):
>
> - **DailyGridRegistry** (`0x9794a7E9bECE87dEe375fE6Eb55620f8Aa788172`) — commits each day's
>   course parameters onchain once, immutably. No function can modify a published grid — not for
>   the scheduler, not for the owner.
> - **VerifiedRunRegistry** (`0xcce26fFAd015ee01A4c0BEe9aaEd28C9785D43aF`) — one immutable receipt
>   per server-verified run, rejecting duplicate run IDs and any grid ID the registry has never
>   seen (checked onchain, not trusted from the caller).
> - **SeasonPrizeVault** (`0x50D4129474c6204c870c7F141B9A6BE68264b6Ee`) — sponsor-funded, capped,
>   Merkle-gated rewards. The root is publishable exactly once, so rules can't change after
>   competition, and the cap is enforced independently of what the tree sums to.

## Technical highlights

> - **Deterministic engine** — fixed-point integers, seeded PRNG, fixed 60 Hz timestep with capped
>   catch-up. Client and server run byte-identical code, enforced in CI.
> - **Cross-process determinism proof** — the simulation runs in two separate OS processes and
>   outputs are diffed. A single-process test could pass while the property was broken.
> - **Replay schema with no score field** — there is literally nowhere to lie about the outcome.
> - **Closed set of named rejection reasons**, each individually tested.
> - **Durable outbox relayer** — gameplay never blocks on a transaction; idempotent enqueue,
>   atomic dequeue, exponential backoff.
> - **213 automated tests**, including 38 integration tests against real Postgres, Redis, and a
>   local blockchain running the actual compiled contracts.

## What's the biggest technical challenge you solved?

> Making a real-time 3D browser game bit-for-bit reproducible on a server.
>
> That meant eliminating floating point from gameplay state, replacing all randomness with a
> seeded integer PRNG drawn in a fixed order, and decoupling simulation from render rate with a
> fixed timestep — including capped catch-up, so a backgrounded tab can't convert elapsed real
> time into free distance.
>
> The subtle part was *proving* it rather than assuming it. Determinism bugs are invisible until
> they matter. Running the simulation in two separate OS processes and diffing the results catches
> what an in-process test structurally cannot.

## Is it live?

> **Partly, and precisely:**
>
> - **Contracts: live and source-verified** on BOT Chain mainnet. Independently checkable —
>   deployed bytecode length matches the tested build exactly.
> - **Game and API: not deployed.** `trybullrush.xyz` currently serves the pre-migration build.
>   The rewrite lives on the branch `feat/botchain-mainnet-skill-rewards` and runs locally.
> - **No relayer running, no season funded, no onchain grid opened.** The contracts are live but
>   deliberately inert — activation is a separate, explicit decision.

## What's next?

> In order: rotate the contracts' hot keys off the deployer; deploy the branch to staging; enable
> the relayer with its own key; fund Season Zero and open the first onchain grid; then run the
> playtest programme in `TESTING-STATUS.md` — 8–12 testers across wallet-native and
> wallet-unfamiliar groups — before any public launch.

## Team

> Solo developer. *(Fill in name/handle/contact as required by the form.)*

---

## Honest disclosures — keep these in the submission

Do not quietly drop these to make the submission look stronger. They are the reason the rest is
credible.

1. **No external playtesting.** Zero testers recruited. All verification is automated (213 tests)
   or first-party.
2. **The rewritten game is not deployed to production.** The live URL serves the old build.
3. **No relayer running, no funded season, no onchain grid.** Contracts are live but inert.
4. **Hot keys not rotated** — `scheduler` and `relayer` still point at the deployer.
5. **No prior-award claim is made.** A referenced award ("second place, BOT Chain Agent Track")
   could not be substantiated — an exhaustive search of the referenced repository found zero
   supporting evidence — so it is asserted nowhere. It can be added if independent evidence is
   supplied; it will not be claimed from memory.

**Do not add tester counts, user numbers, or engagement metrics unless they actually happened.**
