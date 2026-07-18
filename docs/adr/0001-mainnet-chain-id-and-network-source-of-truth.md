# ADR 0001: BOT Chain mainnet is chain ID 677; network config source of truth

## Status
Accepted

## Context
The migration brief described BotSpend as evidence that BOT Chain mainnet works, without stating
a chain ID. BotSpend's own README leads with "BOT Chain testnet 968," which could be misread as
BOT Chain's only or primary network. Trusting either the brief or the README's headline framing
without verification would risk targeting the wrong chain for Bull Rush's mainnet deployment.

## Decision
BOT Chain **mainnet is chain ID 677**; BOT Chain **testnet is chain ID 968**. This was established
by:

1. Reading BotSpend's `web/lib/networks.ts`, which defines both networks explicitly with a
   `testnet: boolean` flag (`mainnet.chainId = 677, testnet: false`; `testnet.chainId = 968,
   testnet: true`).
2. Independently querying `eth_chainId` live against both RPC endpoints
   (`https://rpc.botchain.ai` → `0x2a5` = 677; `https://rpc.bohr.life` → `0x3c8` = 968) — both
   matched the config exactly.
3. Independently re-verifying BotSpend's mainnet-677 contract deployment against the live chain
   (four contracts, four transactions, sequential blocks, all status `0x1`) — see
   `docs/BOTCHAIN-NETWORK-VALIDATION.md`.

Bull Rush's network configuration will adopt the same shape as BotSpend's `networks.ts`
(`NetworkConfig` interface: `chainId`, `rpc`, `bundler`, `explorer`, `contracts`, `deployBlock`),
populated with Bull Rush's own contract addresses once deployed, and will **hardcode chain ID 677
as the mainnet target**, validated at runtime against the wallet's reported `chainId` before any
signature or transaction is requested (per the task's wallet-UX requirement to validate mainnet
chain before proceeding).

## Consequences
- Any future BOT Chain network change (a new chain ID, a migrated RPC) must update this ADR and
  `docs/BOTCHAIN-NETWORK-VALIDATION.md` together, and must be re-verified live via `eth_chainId`
  before being trusted — never hardcoded from memory or a single doc source.
- Bull Rush will not build against testnet 968 as its production target; 968 is available for
  local/staging validation only, mirroring BotSpend's own dual-network pattern.
