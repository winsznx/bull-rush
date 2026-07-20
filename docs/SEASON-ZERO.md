# Season Zero — Verified Skill Rewards

These are the complete rules for Bull Rush's first reward season, published **before** the
season opens. Nothing here changes once the season starts. Bull Rush is a verifiable onchain
skill runner: play first, prove the run, claim what you earned.

> **Status:** RULES PUBLISHED — Season Zero has not opened yet. The concrete numbers marked
> *TBD at funding* (pool size, exact dates) are fixed and announced when the season vault is
> funded, before the window opens. Everything structural below is final.

## What this is — and is not

- **Sponsor-funded prize pool.** The pool is funded up front into an on-chain vault
  (`SeasonPrizeVault`), in an existing asset (native BOT or a sponsor's token). It is capped,
  publicly visible on-chain, and cannot grow mid-season.
- **No Bull Rush token.** There is no game token, no emissions, no minting. Rewards come only
  from the pre-funded pool.
- **No wagering, no entry fees, no purchases.** Playing is free. Practice mode never requires a
  wallet. Nothing in the game is pay-to-win.
- **Verified performance only.** Rewards derive exclusively from server-re-simulated,
  replay-verified Daily Grid runs. No client-claimed score can ever earn anything.

## How the season works

1. **The window.** Season Zero covers a fixed range of Daily Grids (dates announced at
   funding). Each day, every player runs the identical deterministic course — same seed, same
   physics, same ruleset, published before eligible runs begin.
2. **Grid points.** When a grid's day ends, its final standings award points by position:

   | Position | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
   |----------|---|---|---|---|---|---|---|---|---|----|
   | Points   | 40 | 25 | 15 | 8 | 5 | 3 | 1 | 1 | 1 | 1 |

   Standings use each wallet's best **verified** distance on that grid. Positions past 10 earn
   no points. Ties in distance break deterministically (by wallet identity), so the same data
   always produces the same standings.
3. **Season entitlements.** When the season window closes, every wallet's points are summed
   across all grids and the pool splits proportionally:
   `entitlement = pool × yourPoints ÷ totalPoints` (floor division; sub-wei dust stays in the
   vault, unallocated). The full computation runs only from the durable verified-runs record —
   never from a display cache.
4. **The Merkle commitment.** The complete entitlement list becomes a Merkle tree; its root is
   published to the season vault exactly once. The contract refuses any second root — the
   entitlement list cannot be edited after publication, by anyone, including the operators.
5. **Claiming.** Two paths, one function:
   - **Relayer claim:** the game's relayer calls the vault's permissionless `claim` for you —
     no gas, no transaction to sign. Funds always move to *your* wallet, never the caller's.
   - **Self-claim fallback:** the same `claim(seasonId, account, amount, proof)` is callable by
     anyone directly against the vault with the proof from `GET /api/rewards/me` — you never
     depend on our infrastructure staying up to get what you earned.
   The vault independently enforces the cap, rejects double-claims, and rejects any
   (account, amount) pair not in the committed tree.

## Integrity rules

- Only **verified** runs count: server-issued run ticket, approved game version, the grid's
  exact seed, full input trace, server re-simulation. The server never trusts a submitted score.
- Runs flagged by the anti-cheat pipeline (`risk_hold`) earn **zero** points — even if their
  distance would have led the board — pending review.
- One replay per grid: submitting a copy of another player's (public, ghost-served) input trace
  is rejected outright.
- One wallet = one identity. Rewards bind to the wallet that signed the SIWE session the runs
  were played under.
- Operators cannot reroll a day's course (the seed is a pure function of public data, committed
  on-chain), cannot edit the entitlement list after the root is published, and cannot pay out
  past the cap.

## Verify it yourself

- Each grid's seed re-derives from `{dayId, gameVersion, rulesetHash}` — public data.
- Every leaderboard entry's replay hash is receipted; ghost replays let you re-simulate any
  leader's run locally.
- After close, `GET /api/rewards/me` returns your amount, Merkle index, and proof; the tree
  rebuilds from the public claim set and must match the on-chain root.
- The vault contract (`contracts/src/SeasonPrizeVault.sol`) is in this repository, and its
  deployed address + verification link are published at funding time.
