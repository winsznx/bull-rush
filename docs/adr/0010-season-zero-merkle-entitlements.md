# ADR 0010: Season Zero reward design and Merkle entitlements

## Status
Accepted

## Context
Phases 6-9 produced a funded-vault contract (`SeasonPrizeVault`) with a one-time-publishable
Merkle root, but nothing that computes who is entitled to what, commits it, or serves proofs.
Phase 10 is that layer, bound by the locked economy decisions: no Bull Rush token, no
emissions, pre-funded/capped/publicly-visible pools, rewards only for independently verified
performance, rules published before competition.

## Decisions

**`@openzeppelin/merkle-tree` (StandardMerkleTree), not a hand-rolled tree.** The vault's leaf
is `keccak256(bytes.concat(keccak256(abi.encode(account, amount))))` with OZ's sorted-pair
`MerkleProof.verify` — which is *exactly* what `StandardMerkleTree.of(values,
['address','uint256'])` produces; the library exists specifically to pair with the Solidity
verifier the contract already uses. Proven three ways: a hand-computed viem vector in
`rewards.test.ts`, and end-to-end in `seasons.integration.test.ts`, where TS-built proofs claim
real funds from the actual compiled `SeasonPrizeVault` bytecode on anvil, balances checked.
Install triage (per the ADR 0004 method): `npm audit` flags `uuid <11.1.1` via
`@metamask/utils`, a transitive dep — verified that `uuid` is imported only by that package's
`fs.cjs` helper, which the merkle-tree code never touches; the vulnerable v3/v5/v6-with-buffer
path is unreachable from our usage. Server-side only; not in the browser bundle.

**Payout math reads Postgres, never Redis.** Grid standings for entitlement computation come
from `verified_runs` (`max(distance)` per identity, `status <> 'risk_hold'`), not the Redis
leaderboard. Redis is a display cache an operator can legitimately rebuild (`/api/admin/rebuild`
exists); money must derive only from the durable, audited record. Ties break by identityKey so
identical data always yields identical standings, points, and root — a payout computation must
never depend on row-order luck.

**Points-proportional split, published before any season opens.** Per grid, positions 1-10 earn
`[40, 25, 15, 8, 5, 3, 1, 1, 1, 1]` points; a season entitlement is
`floor(pool × points ÷ totalPoints)`. Floor division means the sum can never exceed the cap
(the vault enforces the cap again independently — defense in depth from ADR 0006); sub-wei dust
stays unallocated in the vault, stated in the published rules (`docs/SEASON-ZERO.md`) rather
than silently swept anywhere.

**Pure math and DB flow are separate modules.** `rewards.ts` (points, entitlements, tree) has
no I/O and is unit-tested without services; `seasons.ts` owns the durable-record side
(create/close/proofs). Same split discipline as sim-vs-grid.

**Close-once is atomic, and refuses while the window is open.** `closeSeason` requires
`now() >= ends_at` (no force flag — an early close would violate published rules, and a bypass
switch on a payout path is exactly the kind of operator power Phase 12 exists to remove, not
add), computes entitlements, and commits root + claim rows in one transaction gated by
`UPDATE seasons ... WHERE status = 'draft'`. A season with zero eligible runs refuses to close
into an empty tree.

**Proofs are recomputed from the claim rows on every request, and cross-checked.** The ordered
`(season_id, merkle_index)` claim set IS the leaf set — nothing else is stored. On each
`GET /api/rewards/me`, the tree is rebuilt and its root compared against the committed
`seasons.merkle_root`; a mismatch throws rather than serving a proof from tampered rows. This
makes the claims table self-auditing: you cannot quietly edit an amount and still serve
working proofs.

**`risk_hold` runs earn zero, even when they'd lead.** Integration-tested with a flagged
99,999m run: it takes no points, gets no claim row. Anti-cheat flags now have direct economic
teeth.

**Client is display-only; no claim button yet.** `GET /api/rewards/me` returns everything a
self-claim needs (amount, index, proof, root) and the DailyGrid panel lists entitlements — but
no vault is deployed anywhere (Phase 15), so a claim button would be dead code against no
address. The relayer `claimFor` job type is likewise deferred until a target exists; the claim
state machine (`eligible → queued → submitted → confirmed`, Phase 5) is already in place for it.

## What was NOT built, and why
- **On-chain root publication / vault funding / claimFor relaying** — all require a deployed
  vault (Phase 15). The contract-side flow is fully proven on anvil.
- **A seasons scheduler** — season create/close are `ADMIN_KEY`-guarded operator actions, same
  interim pattern as grid opening (ADR 0003) and ticket sweeping (Phase 5).
- **Sponsor-specific ERC20 season tests** — the vault's ERC20 path is covered by Foundry tests
  (Phase 6); the server-side flow is asset-agnostic (address column). Native BOT is Season
  Zero's asset.

## Verification
- `rewards.test.ts` (9, pure): points table, proportional split, floor-never-exceeds-pool,
  determinism/ordering, empty seasons, zero-wei leaf dropping, and the leaf-format vector
  (StandardMerkleTree root == hand-computed `keccak256(keccak256(abi.encode(...)))`).
- `seasons.integration.test.ts` (3, real Postgres + real anvil): full lifecycle — three seeded
  players, close, correct floor amounts, then createSeason/publishMerkleRoot/fundNative on the
  actual compiled vault bytecode and **every TS-built proof claims on-chain with exact balance
  deltas**, double-claim reverts; close rejections (window open, no runs, unknown, double);
  risk_hold earns nothing.
- **Live over real HTTP** (`npm run local:verify:grid`, extended): create season → close →
  `GET /api/rewards/me` returns the full pool for the sole verified player, root matching the
  close response. The script run also tripped — and then satisfied — the real `botLike`
  heuristic: its original perfectly-regular 19-tick input cadence got flagged `risk_hold` the
  moment a run survived past 30 inputs (the earlier, shorter runs had been under the check's
  floor). Fixed by jittering the synthetic cadence; kept here as evidence the behavioral gate
  actually fires on machine-regular input, unprompted.
- Fresh-DB proof: wiped volume → all 8 migrations from nothing → 24/24 integration.
- Full regression: `tsc --noEmit` clean both packages; `sim:check` clean; `npm test` 73/73
  (+9); `sim:test` 35/35, fingerprint unchanged; full `npm run build`.
