# BOT Chain mainnet deployment — evidence

Bull Rush's three contracts are live on **BOT Chain mainnet (chain ID 677)**. Every value below
was read back from the chain via live RPC after the broadcast, not copied from the deploy tool's
own output.

## Network

| | |
|---|---|
| Chain ID | **677** (confirmed live: `eth_chainId` → `0x2a5`) |
| RPC | `https://rpc.botchain.ai` |
| Explorer | `https://scan.botchain.ai` |
| Deployed at block | 16,757,449 – 16,757,451 |
| Deployer | `0x9fe816A8bD6933464c177ba94890aEDE5CD5aA5A` |

## Contracts

| Contract | Address | Deploy tx | Gas |
|---|---|---|---|
| `DailyGridRegistry` | [`0x9794a7E9bECE87dEe375fE6Eb55620f8Aa788172`](https://scan.botchain.ai/address/0x9794a7e9bece87dee375fe6eb55620f8aa788172) | `0xdcc10dec00488431582fed47a07868c031dbebae7c6bf2f3bf4f39fbb8e965f8` | 633,003 |
| `VerifiedRunRegistry` | [`0xcce26fFAd015ee01A4c0BEe9aaEd28C9785D43aF`](https://scan.botchain.ai/address/0xcce26ffad015ee01a4c0bee9aaed28c9785d43af) | `0x4e94842fc0d2bad2ae7250e8b5245b758e00cd5af2873914b379e685faca6d50` | 718,751 |
| `SeasonPrizeVault` | [`0x50D4129474c6204c870c7F141B9A6BE68264b6Ee`](https://scan.botchain.ai/address/0x50d4129474c6204c870c7f141b9a6be68264b6ee) | `0xfa5713eae5ab4bf78c0bbd1338b3b1b83c7baef770d6e78605944a2a7a326895` | 923,212 |

All three receipts returned `status 0x1`. Total gas **2,274,966**; cost **0.108332 BOT**
(0.798330 → 0.689998 BOT).

## Independent verification (post-deploy, from chain)

**Deployed bytecode length matches the Phase 6 build exactly** — the strongest available check
that what's on-chain is what was tested:

| Contract | On-chain (`eth_getCode`) | `forge build --sizes` (Phase 6) |
|---|---|---|
| `DailyGridRegistry` | 2,456 bytes | 2,456 |
| `VerifiedRunRegistry` | 2,849 bytes | 2,849 |
| `SeasonPrizeVault` | 3,907 bytes | 3,907 |

**Constructor state and wiring**, read via `cast call`:

```
DailyGridRegistry.owner()          0x9fe816A8bD6933464c177ba94890aEDE5CD5aA5A
DailyGridRegistry.scheduler()      0x9fe816A8bD6933464c177ba94890aEDE5CD5aA5A
VerifiedRunRegistry.owner()        0x9fe816A8bD6933464c177ba94890aEDE5CD5aA5A
VerifiedRunRegistry.relayer()      0x9fe816A8bD6933464c177ba94890aEDE5CD5aA5A
VerifiedRunRegistry.gridRegistry() 0x9794a7E9bECE87dEe375fE6Eb55620f8Aa788172  ← real registry
SeasonPrizeVault.owner()           0x9fe816A8bD6933464c177ba94890aEDE5CD5aA5A
SeasonPrizeVault.NATIVE()          0x0000000000000000000000000000000000000000
```

`VerifiedRunRegistry` points at the actually-deployed `DailyGridRegistry`, so its
`UnknownGrid` rejection is enforced against real on-chain grid state.

## Source verification

All three are **verified on BOTScan** (Blockscout), confirmed by querying
`/api/v2/smart-contracts/<address>` after submission — not by trusting the submit response:

| Contract | `is_verified` | Compiler | Optimizer |
|---|---|---|---|
| `DailyGridRegistry` | true | `v0.8.28+commit.7893614a` | enabled, 200 runs |
| `VerifiedRunRegistry` | true | `v0.8.28+commit.7893614a` | enabled, 200 runs |
| `SeasonPrizeVault` | true | `v0.8.28+commit.7893614a` | enabled, 200 runs |

## Pre-broadcast gates

`npm run release:check` — all 10 green immediately before broadcasting: secret scan (full
history), typechecks (game + server), sim:check, unit tests, sim tests + cross-process
fingerprint, `forge fmt --check`, `forge test` (43), integration tests against real
Postgres/Redis/anvil, production build. A dry-run simulation against live mainnet state ran
first and succeeded before `--broadcast` was added.

## Key handling

The deployer key was never printed, echoed, or written to any tracked file. It lives in
`.env.local` (gitignored via `*.local`); forge's `contracts/cache/` — which stores "sensitive
values" — is gitignored via `contracts/.gitignore`. `gitleaks` over the full working tree after
deployment: **no leaks found**.

## Current operational state

Hot roles (`scheduler`, `relayer`) are set to the deployer for now and are **rotatable** without
redeploying, via `setScheduler` / `setRelayer` (owner-only) — the reason those functions exist
(ADR 0006). Rotate them to dedicated hot keys before the relayer runs unattended.

**The server is not yet pointed at these contracts.** `CHAIN_RELAYER_ENABLED` remains unset in
every environment, so `loadChainConfig()` still returns `null` and no relayer is running. Turning
it on is a deliberate, separate step requiring the relayer's key in the production environment —
see `docs/RELEASE-CHECKLIST.md`. To enable:

```
CHAIN_RELAYER_ENABLED=true
CHAIN_ID=677
CHAIN_RPC_URL=https://rpc.botchain.ai
DAILY_GRID_REGISTRY_ADDRESS=0x9794a7E9bECE87dEe375fE6Eb55620f8Aa788172
VERIFIED_RUN_REGISTRY_ADDRESS=0xcce26fFAd015ee01A4c0BEe9aaEd28C9785D43aF
RELAYER_PRIVATE_KEY=<relayer hot key — not the deployer key>
```

No season has been created or funded on `SeasonPrizeVault`; no grid has been opened on-chain.
Those are live operational actions, deliberately not taken as part of deployment.
