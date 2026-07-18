# ADR 0006: DailyGridRegistry, VerifiedRunRegistry, SeasonPrizeVault

## Status
Accepted

## Context
Phases 1-5 built a real deterministic-engine, wallet-authenticated, replay-verified Daily Grid
lifecycle entirely off-chain. Nothing in that stack is currently tamper-evident to anyone outside
this project's own Postgres instance — a grid's parameters, a verified run's result, and a claimed
reward all exist only as rows a database administrator could, in principle, edit. Phase 6 is the
first on-chain layer: three Foundry contracts that turn "the server says this happened" into "this
happened, provably, on BOT Chain" for the three places that matters most — the course, the result,
and the payout — without asking Solidity to do anything it's bad at (it never re-runs the
deterministic sim; that stays server-side, per Phase 2/ADR 0002).

## BotSpend reuse
Reused directly from `/Users/mac/botspend` (read-only reference, evidence-based, not copied
blindly — see the reuse table below):
- **Dependency management: vendored `lib/forge-std` and `lib/openzeppelin-contracts` as plain
  tracked files, not git submodules.** BotSpend has no `.gitmodules`; its `lib/` contents are
  ordinary tracked directories. Matched exactly, pinned to BotSpend's own commit
  (`openzeppelin-contracts` at tag `v5.1.0`, confirmed via `package.json`'s `"version": "5.1.0"`)
  so both projects are provably on the same OpenZeppelin release.
- **`foundry.toml` profile** (`solc 0.8.28`, `evm_version = cancun`, `optimizer_runs = 200`,
  `bytecode_hash = "none"`, the `[fmt]` block) copied verbatim — no reason to diverge on compiler
  settings from a project already proven to compile and deploy on BOT Chain.
- **Owner/hot-key separation pattern.** `BOTSpendVault` separates `owner` (cold, administers
  policy) from the agent addresses it grants narrow permissions to. `DailyGridRegistry` and
  `VerifiedRunRegistry` apply the same separation to `scheduler`/`relayer` respectively — a
  compromised hot key (the one an automated off-chain process holds and could leak) can be revoked
  by `owner` and never had the power to re-point itself or seize ownership.
- **Custom errors + `nonReentrant` boolean-flag modifier + checks-effects-interactions**, not a
  library (no `ReentrancyGuard` import) — `BOTSpendVault.executeSpend` hand-rolls this exact
  pattern; `SeasonPrizeVault.claim` does the same.
- **Idempotency via a used-marker mapping** (`usedAction` in BOTSpendVault →
  `recorded`/`claimedBy` here) rather than sequence numbers — a retried relayer call after a
  dropped response can never double-record or double-pay.
- **Native/ERC20 dual-asset support via a `NATIVE = address(0)` sentinel**, identical to
  `BOTSpendVault.NATIVE` — `SeasonPrizeVault` needed the same two payout paths (a sponsor may fund
  in native BOT or their own ERC20) and there was no reason to invent a different convention.
- **Test style**: BotSpend's `forge-std` `Test` base, `makeAddr`, event-mirroring for
  `vm.expectEmit`, `#given/#when/#then` scenario comments — followed the same conventions this
  project's own `.claude/rules/testing.md` already requires.

## Decisions

**Three contracts, not one monolith.** `DailyGridRegistry` (course commitment),
`VerifiedRunRegistry` (result receipt), `SeasonPrizeVault` (reward payout) are separately
deployed and only loosely coupled — `VerifiedRunRegistry` holds an `immutable` reference to
`DailyGridRegistry` and rejects an unknown `gridId`, but `SeasonPrizeVault` doesn't reference
either at all. Phase 10 computes a season's Merkle tree from `VerifiedRunRegistry` events
off-chain and only publishes the resulting root; the vault never needs to read run data on-chain
itself. This keeps each contract's blast radius small: a bug in the reward vault cannot corrupt
run history, and a bug in run recording cannot touch already-escrowed prize funds.

**`DailyGridRegistry.openGrid` reverts on a duplicate `dayId`, full stop — no update path exists.**
This is the concrete difference between "an operator cannot reroll a day's course" as a server
promise (Phase 3/ADR 0003, off-chain only) and the same property as a contract-enforced guarantee:
there is no function in this contract that can ever change a stored grid's seed after the fact,
by anyone, including `owner`.

**`VerifiedRunRegistry.recordRun` takes `runId` as an explicit parameter rather than computing it
internally.** The relayer computes it (recommended: `keccak256(abi.encode(gridId, player,
replayHash))`) and the contract's only requirement is that a given `runId` is never recorded
twice. This keeps the contract from needing an opinion about what uniquely identifies a run —
that's an off-chain concern the relayer already has better information for (e.g. it could key on
the server's ticket id instead) — while still getting hard anti-replay for free.

**`SeasonPrizeVault.claim` is one function serving both self-claim and `claimFor`, not two.** The
spec calls for both a permissionless relayer `claimFor` and a self-claim fallback. Because the
Merkle proof already authorizes exactly one `(account, amount)` pair regardless of who submits it,
and payout always transfers to `account` (never `msg.sender`), a single permissionless `claim(...,
account, ...)` function *is* both paths — a player calling it with their own address is
self-claim; a gas-sponsoring relayer calling it with the player's address is claimFor. Building two
separate functions (one signature-gated, one not) would have meant two things to keep in sync for
no additional guarantee.

**A Merkle root can be published exactly once per season.** `publishMerkleRoot` reverts if
`merkleRoot` is already non-zero. This is the contract-level enforcement of "rules published
before competition" — once a season's entitlement tree is on-chain, no one (not even `owner`) can
swap it for a different tree after players have started claiming, or after the competition period
the tree covers has closed.

**`cap` is enforced independently of what the Merkle tree sums to.** `s.claimed + amount > s.cap`
reverts even though, if the tree was built correctly, `claimed` could never legitimately exceed
`cap` on its own (every leaf amount was chosen before publication to sum within it). This is
deliberate defense in depth: an off-chain bug that generates a tree whose leaves sum to more than
the announced cap is caught on-chain at the first claim that would cross it, rather than silently
overpaying out of whatever balance happens to be sitting in the contract.

## Security review
Ran `slither .` (Foundry-aware static analysis) against all three contracts. Findings and
disposition:
- **`arbitrary-send-eth` on `SeasonPrizeVault.claim`'s `account.call{value: amount}("")`.**
  Reviewed and accepted — this is the intended design, not a bug: the "arbitrary" destination is
  exactly `account`, the address the Merkle proof authorizes for exactly `amount`, and it is
  reachable only through that proof check plus the double-spend guard (`claimedBy`) and the cap
  check, both of which execute (effects) before this transfer (interaction).
- **`timestamp` comparisons** in `DailyGridRegistry.isOpenForTickets` and
  `SeasonPrizeVault.claim`'s claim-window check. Both operate at day/multi-hour granularity — the
  few seconds of drift a validator could introduce cannot meaningfully move a player in or out of
  a ticket window or a claim window that spans hours to days. Accepted as-is.
- **Solc pragma / assembly / low-level-call findings inside `lib/openzeppelin-contracts` and
  `forge-std`** — all in vendored dependency code, not this project's contracts; not actionable
  here.
- No reentrancy finding was raised (explicitly checked: `slither . | grep -i reentran` returned
  nothing) — the `nonReentrant` modifier plus checks-effects-interactions in `claim` holds up
  under static analysis, not just manual review.

## What was NOT built, and why
- **No relayer/indexer that actually calls these contracts from the live server.** That's Phase 7
  — this phase is the contracts and their tests only. `server/src/index.ts` does not yet know
  these contracts exist.
- **No deployment.** `script/Deploy.s.sol` exists and is reviewed, but was never run with
  `--broadcast` against any network (local anvil, BOT Chain testnet 968, or mainnet 677) in this
  phase — no address exists yet for any of these three contracts anywhere. Phase 15 is the
  explicit, gated point where a real broadcast happens, after every earlier gate passes and after
  the one required pre-broadcast confirmation.
- **No contract-driven grid scheduling.** `DailyGridRegistry.openGrid` is `onlyScheduler`, a single
  EOA/relayer key today — not a Chainlink Automation job or similar. Acceptable for now per the
  same reasoning as ADR 0003's "authorised scheduler" placeholder; Phase 7's relayer is what
  actually calls it.
- **Merkle tree generation tooling.** `SeasonPrizeVault` can accept and enforce a published root,
  but nothing in this repo yet computes one from real `VerifiedRunRegistry` data — that's Phase
  10's job, once there's a real season's worth of on-chain runs to build a tree from.

## Verification
- `forge build` — compiles clean (only informational `block-timestamp` lint warnings, addressed
  above).
- `forge fmt --check` — clean, matching `foundry.toml`'s `[fmt]` profile.
- `forge test -vv` — **43/43 tests passing** across the three contracts: `DailyGridRegistryTest`
  (11 — deploy validation, duplicate-dayId rejection, non-scheduler rejection, invalid-window
  rejection, ticket-window state transitions, scheduler rotation, ownership transfer),
  `VerifiedRunRegistryTest` (10 — deploy validation, duplicate-runId rejection, unknown-grid
  rejection, personal-best tracking both directions, relayer rotation, ownership transfer),
  `SeasonPrizeVaultTest` (22 — season creation/duplicate rejection, one-time root publication,
  native + ERC20 funding both directions and their asset-mismatch reverts, permissionless
  claim-for and self-claim, double-claim rejection, wrong-amount and mismatched-account proof
  rejection, claim-window expiry, cap enforcement across a full 4-leaf tree, ownership transfer).
- `forge build --sizes` — all three contracts well under the 24,576-byte EVM limit (largest,
  `SeasonPrizeVault`, is 3,907 bytes runtime / ~20.6KB of margin).
- `slither .` — see Security review above; no unaddressed finding in this project's own contracts.
- One genuine bug was caught and fixed during test-writing, not left in: three
  `SeasonPrizeVaultTest` tests initially failed because `vault.NATIVE()` was called inline as a
  `createSeason(...)` argument immediately after `vm.prank`/`vm.expectRevert` — Solidity evaluates
  call arguments (including that external view call) before the outer call executes, so the prank/
  revert-expectation was being consumed by the argument's own call frame instead of the intended
  one. Fixed by hoisting a local `NATIVE` constant so no extraneous external call sits between a
  cheatcode and the call it's meant to govern — worth noting here since it's an easy trap to
  reintroduce in future test-writing on this codebase.
