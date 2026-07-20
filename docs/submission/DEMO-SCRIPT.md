# Demo script

A reproducible walkthrough. Every step here has been run; nothing is aspirational. Where a step
depends on something not yet switched on, that's stated at the step rather than glossed.

**Total: ~8 minutes.** Sections 1–2 need no setup. Sections 3–5 need the local stack.

---

## 1. The contracts are real (~1 min, no setup)

Open BOTScan and show verified source at each address:

- `DailyGridRegistry` — https://scan.botchain.ai/address/0x9794a7e9bece87dee375fe6eb55620f8aa788172
- `VerifiedRunRegistry` — https://scan.botchain.ai/address/0xcce26ffad015ee01a4c0bee9aaed28c9785d43af
- `SeasonPrizeVault` — https://scan.botchain.ai/address/0x50d4129474c6204c870c7f141b9a6be68264b6ee

> **Point to make:** all three are source-verified, compiled with solc 0.8.28, optimizer 200 runs.
> The published source is the deployed bytecode.

Confirm the wiring live — `VerifiedRunRegistry` points at the real registry, so its unknown-grid
rejection is enforced against actual on-chain state:

```bash
cast call 0xcce26fFAd015ee01A4c0BEe9aaEd28C9785D43aF 'gridRegistry()(address)' \
  --rpc-url https://rpc.botchain.ai
# → 0x9794a7E9bECE87dEe375fE6Eb55620f8Aa788172
```

And that the deployed bytecode is the tested bytecode:

```bash
cast code 0x9794a7E9bECE87dEe375fE6Eb55620f8Aa788172 --rpc-url https://rpc.botchain.ai | wc -c
# → 4915  (4912 hex chars + "0x" + trailing newline = 2456 bytes)
#   matches `forge build --sizes` for DailyGridRegistry exactly
```

---

## 2. Determinism, proven across processes (~1 min)

```bash
npm run sim:test
```

> 35 tests, then: `✓ cross-process determinism check passed — FINGERPRINT 1183386224`
>
> **Point to make:** this runs the simulation in two *separate OS processes* and diffs the
> output. A single-process test could share state and pass while determinism was actually
> broken. This is the property the entire anti-cheat model rests on.

---

## 3. Setup for the live sections (~1 min)

```bash
npm run local:db      # Postgres + Redis
npm run db:migrate    # explicit — the server refuses to boot on pending migrations
npm run local:api     # separate terminal
```

---

## 4. The full loop, no mocks (~2 min)

```bash
npm run local:verify:grid
```

This drives the real path end to end: a throwaway wallet signs a genuine SIWE message,
authenticates, opens a grid, requests a ticket, plays a real deterministic run, submits it, and
polls its own receipt status.

Expected tail:

```
siwe verify: 200 {"ok":true,"wallet":"0x...","chainId":677}
ticket: {"ticket":{"id":"...","seed":"0x...","gameVersion":"1.0.0",...}}
submit: {"ok":true,"runId":"...","status":"receipt_queued","distance":210,...}
own status poll: {"ok":true,"status":"receipt_queued","isPersonalBest":true}
✅ WALLET + GRID + RECEIPT-STATUS LOOP WORKS
```

> **Points to make:**
> - The submit request contains **no distance and no score** — only the seed, the input trace,
>   and the tick count. The `distance: 210` in the response is the server's own re-derivation.
> - The run rests at `receipt_queued` because no relayer is running (see §6). That is an honest
>   report of a real job in a real queue, not a placeholder.

---

## 5. Cheating fails, with a named reason (~2 min)

```bash
npm run local:verify
```

Submits an honest run, then the same run with a tampered seed.

> Expected: the honest run is accepted with a server-derived score; the tampered one is rejected
> as `wrong_seed`, and the admin counters show it.
>
> **Point to make:** rejection is a *named reason from a closed set*, not a heuristic score. The
> full set — wrong seed, wrong ruleset, wrong game version, truncated log, out-of-order ticks,
> impossible action frequency — is enumerated and individually tested.

To show the whole gate:

```bash
npm run release:check   # 10 gates, 213 tests, ~2 min
```

---

## 6. What is NOT running — say this out loud

Do not skip this section.

- **The rewritten game and API are not deployed.** `trybullrush.xyz` still serves the
  pre-migration build. Everything demoed above runs locally, on the branch
  `feat/botchain-mainnet-skill-rewards`.
- **No relayer is running anywhere.** `CHAIN_RELAYER_ENABLED` is unset, so no run has been
  receipted on mainnet. The contracts are live but deliberately inert.
- **No season is funded and no on-chain grid is open.**
- **Zero external playtesters.** All verification to date is automated or first-party.

> **Framing:** the contracts are real and the pipeline is proven end-to-end against real
> infrastructure. What remains is operational activation — rotate hot keys, enable the relayer,
> fund a season, open a grid — not further construction.

---

## If asked: "why should I believe the score?"

Three claims, each independently checkable:

1. **The client never sends a score.** Read the submit payload — the field doesn't exist.
2. **The server re-runs your exact game.** Same engine, byte-identical across client and server,
   enforced in CI.
3. **The engine is deterministic across machines.** Proven by the cross-process fingerprint, not
   asserted.

## If asked: "what's the weakest part?"

Answer directly: **no external playtesting.** 213 tests prove the system does what it was
designed to do; they prove nothing about whether it's fun or whether the wallet flow makes sense
to a newcomer. A recruitment plan exists in `TESTING-STATUS.md` and has not been executed.

Second weakest: the contracts are immutable with no upgrade path — a deliberate tradeoff for
"the rules cannot change out from under you," but it means a bug requires redeployment.
