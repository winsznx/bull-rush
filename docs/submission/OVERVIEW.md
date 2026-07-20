# Bull Rush — overview

**Play first. Prove the run. Claim what you earned.**

Bull Rush is a verifiable onchain skill runner on BOT Chain. Every day, every player races the
same deterministic course — the **Daily Grid**. Completed runs are re-simulated by the server
from the player's input trace, so a score is something you *proved*, not something your browser
*claimed*. Verified results are receipted on BOT Chain, and sponsor-funded rewards are claimable
without ever interrupting play.

## What makes it different

**The server does not trust your score. It re-runs your game.**

Most web games take the client's word for the final number. Bull Rush never does. The game runs
on a deterministic, fixed-point, integer-only simulation with a seeded PRNG — no floating point,
no `Math.random()` in gameplay. The client submits only a *replay*: the seed it was issued, the
exact tick each input landed on, and the tick count. The server replays that trace through the
identical engine and derives distance, score, and cause of death itself.

A tampered replay doesn't produce a better score — it produces a rejection with a named reason.

**Same grid for everyone.** A Daily Grid's seed is a pure function of public information
(`hash(dayId, gameVersion, rulesetHash)`), published on-chain before eligible runs begin. Anyone
can re-derive today's seed independently and confirm the operator didn't cherry-pick a course.
The contract has no update path: a grid, once opened, is immutable by anyone including its owner.

**Wallet is identity, not a popup tax.** Guests play free of friction forever. A wallet and one
SIWE signature are required only to enter the ranked Daily Grid — and never again during play.
No signature per run. No transaction mid-game. A relayer records verified runs on-chain on the
player's behalf.

## Rewards, stated plainly

Season Zero is **sponsor-funded, capped, and published before competition**. There is no Bull
Rush token, no emissions, no wagering, no loot boxes, no pay-to-win. Rewards are awarded only for
independently verified performance, from a narrowly-scoped season vault whose rules and cap are
public and enforced on-chain — the vault rejects a claim that would exceed the announced cap even
if the entitlement tree says otherwise.

Claims are permissionless: a player can always self-claim, and a relayer can claim on their
behalf with no extra authority, because the Merkle proof authorizes exactly one
`(account, amount)` pair and funds always move to `account`, never to whoever paid the gas.

## Live on BOT Chain mainnet

Three contracts, deployed and source-verified on chain **677**:

| Contract | Address |
|---|---|
| `DailyGridRegistry` | [`0x9794a7E9bECE87dEe375fE6Eb55620f8Aa788172`](https://scan.botchain.ai/address/0x9794a7e9bece87dee375fe6eb55620f8aa788172) |
| `VerifiedRunRegistry` | [`0xcce26fFAd015ee01A4c0BEe9aaEd28C9785D43aF`](https://scan.botchain.ai/address/0xcce26ffad015ee01a4c0bee9aaed28c9785d43af) |
| `SeasonPrizeVault` | [`0x50D4129474c6204c870c7F141B9A6BE68264b6Ee`](https://scan.botchain.ai/address/0x50d4129474c6204c870c7f141b9a6be68264b6ee) |

Deployment evidence, including post-deploy bytecode comparison against the tested build:
`docs/MAINNET-DEPLOYMENT.md`.

## Honest status

Read `TESTING-STATUS.md` before evaluating this project. In short:

- **The contracts are live, verified, and real.** Every address and transaction above is
  independently checkable on BOTScan.
- **The rewritten game and API are not yet deployed to production.** `trybullrush.xyz` currently
  serves the pre-migration build. The migration lives on the branch
  `feat/botchain-mainnet-skill-rewards` and is fully runnable locally.
- **There has been no external playtesting.** Zero recruited testers to date. All verification so
  far is automated (213 tests) plus first-party manual runs.

Nothing in this submission is projected, aspirational, or rounded up.
