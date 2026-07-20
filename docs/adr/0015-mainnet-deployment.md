# ADR 0015: BOT Chain mainnet deployment

## Status
Accepted — deployed and verified.

## Context
Phases 6–14 built, tested, and hardened everything on the assumption that a real deployment
would eventually happen: contracts with 43 passing tests, a relayer designed to no-op until
`CHAIN_RELAYER_ENABLED` is set, a release gate, and a documented deploy script that had never
been broadcast. This ADR records the one irreversible step — publishing three permanent
contracts to BOT Chain mainnet with real funds — and how it was gated.

Full evidence (addresses, tx hashes, gas, verification status, RPC read-backs) is in
`docs/MAINNET-DEPLOYMENT.md`; this ADR covers the decisions.

## Decisions

**Target chain confirmed live, not from memory.** `eth_chainId` returned `0x2a5` (677) from
`https://rpc.botchain.ai` immediately before deploying — the same discipline established in
Phase 0 (ADR 0001), applied at the moment it mattered most. This is what prevents the failure
mode of deploying to testnet 968 while believing it's mainnet, which BotSpend's own
testnet-first README makes an easy mistake.

**Deployer identity resolved by evidence, not assumption.** The instruction was to reuse
BotSpend's mainnet key. `botspend/internal/keys.json`'s `deployer` field turned out to be a
*different* account (`0xCc71…EB21`) holding **0.000000 BOT** — the testnet deployer. The
account that actually deployed BotSpend to 677, recovered from its own broadcast record, was
`0x9fe816A8…aA5A`, the only funded one (0.798330 BOT). Every other known BotSpend address was
checked and empty. Deploying with the keys.json deployer would have failed on gas; assuming
without checking would have wasted a broadcast attempt.

**Simulation before broadcast.** `forge script` ran against live mainnet state with no
`--broadcast` first, proving the script executes and returning a real gas estimate
(0.14083 BOT vs 0.798330 available, ~5.7×). Only then was `--broadcast` added. Cheap
insurance against burning gas on a script that reverts.

**Hot roles set to the deployer initially.** `scheduler` and `relayer` both point at the
deployer. They are rotatable via owner-only `setScheduler`/`setRelayer` without redeploying —
exactly the owner/hot-key separation Phase 6 built (ADR 0006) — so this is a starting position,
not a permanent one. Recorded explicitly so rotating to dedicated hot keys before unattended
relayer operation is a known task, not a forgotten one.

**Deployment ≠ activation.** The contracts are live, but the server is still not pointed at
them: `CHAIN_RELAYER_ENABLED` remains unset everywhere, so `loadChainConfig()` returns `null`
and no relayer runs. No season was created or funded; no grid opened on-chain. Publishing
bytecode is reversible in impact (unused contracts sit inert); starting a relayer that spends
gas and writes receipts is an operational commitment that deserves its own decision, with the
relayer's key provisioned separately from the deployer's. This is the same "build it real, turn
it on deliberately" posture ADR 0008 described when the receipt UI shipped against an idle
outbox.

## Verification approach
Deliberately did not trust the deploy tool's own summary. After broadcasting:
- Receipts re-fetched via `eth_getTransactionReceipt` — all `status 0x1`.
- `eth_getCode` byte lengths compared against Phase 6's `forge build --sizes`: **exact match**
  on all three (2456 / 2849 / 3907). This is the strongest cheap evidence that the deployed
  bytecode is the tested bytecode.
- Constructor state and cross-contract wiring read via `cast call` — notably
  `VerifiedRunRegistry.gridRegistry()` returns the real deployed `DailyGridRegistry`, so its
  `UnknownGrid` guard is enforced against actual on-chain state.
- Verification status queried from the explorer's API *after* submission, rather than trusting
  the `Response: OK` from the submit call.

## Key handling
The deployer key was never printed, echoed into a log, or written to a tracked file. It was read
from a gitignored `.env.local` and passed to `forge` through the environment. When an earlier
attempt to bulk-scan BotSpend's files to locate the key was blocked by a permission guard, that
block was respected rather than circumvented — the user supplied the key directly instead.
Forge writes "sensitive values" into `contracts/cache/`, which `contracts/.gitignore` already
covers; `gitleaks` over the full tree after deployment found **no leaks**.

## Consequences
- Bull Rush now has real, verifiable, publicly-inspectable on-chain infrastructure. The
  "verifiable onchain skill runner" claim is backed by verified source at known addresses.
- The contracts are immutable and permanent. No upgrade path exists by design (Phase 6 chose
  immutability over proxies); a bug means deploying replacements and re-pointing config.
- Remaining before real players earn real rewards: rotate hot keys, enable the relayer with its
  own key, create and fund Season Zero, and open the first on-chain grid.
