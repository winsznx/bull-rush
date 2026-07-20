# BOT Chain Network Validation

All values below were independently confirmed via live JSON-RPC calls during this assessment
(not copied from memory or documentation). Commands and raw responses are preserved so this is
re-verifiable.

## Networks

| | Mainnet | Testnet |
|---|---|---|
| Chain ID (config, `BotSpend/web/lib/networks.ts`) | 677 | 968 |
| Chain ID (live `eth_chainId`) | `0x2a5` = **677** ✅ matches | `0x3c8` = **968** ✅ matches |
| RPC | `https://rpc.botchain.ai` | `https://rpc.bohr.life` |
| Bundler (ERC-4337) | `https://bundler.botchain.ai/rpc` | `https://bundler.bohr.life/rpc` |
| Explorer | `https://scan.botchain.ai` | `https://scan.bohr.life` |
| Native currency | BOT (18 decimals) | BOT (18 decimals) |

```text
Evidence:
$ curl -sX POST https://rpc.botchain.ai -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
{"jsonrpc":"2.0","id":1,"result":"0x2a5"}

$ curl -sX POST https://rpc.bohr.life -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
{"jsonrpc":"2.0","id":1,"result":"0x3c8"}
```

## RPC method checks (mainnet, `rpc.botchain.ai`)

| Method | Result | Notes |
|---|---|---|
| `eth_chainId` | `0x2a5` (677) | Confirmed above |
| `eth_blockNumber` | `0xfc43f5` = 16,534,517 | Chain is live and advancing |
| `eth_getBlockByNumber("latest", false)` | Full block object returned | Notable: `baseFeePerGas: "0x0"`, `difficulty: "0x2"` (PoA-style consensus, not real PoW), and **non-standard fields** `milliTimestamp` present. `blobGasUsed`/`excessBlobGas` present → Cancun fields active, consistent with BotSpend's `foundry.toml` (`evm_version = "cancun"`). |
| `eth_estimateGas` (0-value transfer) | `0x5208` = 21,000 | Standard EVM transfer cost — gas estimation behaves normally |
| `eth_feeHistory` | Returned; `baseFeePerGas` all `0x0` across the window | **Chain currently has zero base fee** — `eth_gasPrice` (below) is the effective cost signal, not EIP-1559 base fee |
| `eth_gasPrice` | `0xb165100c4` ≈ 47.7 Gwei | Non-zero — gas has a real cost despite zero base fee (legacy/priority-fee-driven pricing) |
| Malformed method (`eth_notARealMethod`) | `{"error":{"code":-32601,"message":"the method eth_notARealMethod does not exist/is not available"}}` | Standard JSON-RPC error shape — safe to branch on `error.code` |

```text
Evidence: raw curl transcript preserved in the assistant's tool-call history for this session;
representative excerpts quoted above. Every value was fetched live during this pass, not assumed.
```

## Explorer

| Check | Result |
|---|---|
| `https://scan.botchain.ai` reachable | HTTP 200 |
| Contract address page (`/address/0x653a1a92...`) | HTTP 200 |
| Contract source verification | Page text contains **"Contract Source Code Verified"** for the BOTSpend Vault contract |
| Etherscan-compatible API (`?module=contract&action=getabi`) | Returns a real ABI JSON — **the explorer is Blockscout/Etherscan-API-compatible**, usable for automated verification checks in CI |

**Conclusion: the explorer supports the standard contract-verification workflow** (`forge verify-contract` style, Etherscan-compatible API) — no bespoke verification process is required.

## Mainnet deployment evidence (BotSpend, reused only as network proof — not Bull Rush's deployment)

Extracted from `~/botspend/broadcast/DeployAll.s.sol/677/run-latest.json` and **independently
re-confirmed against the live chain via `eth_getTransactionReceipt`** for all four hashes (ground
truth below resolved a transaction/contract-name ordering ambiguity present in the raw broadcast
JSON's array indices — the values below are RPC-verified, not read positionally from the file):

| Contract | Address | Deploy tx | Block | Status |
|---|---|---|---|---|
| MockUSD | `0xf94f5f6e6ef15238f65a60d515442258b5073325` | `0x6eda31edbdc198e5fc01e87870ce1f2797abba552239db3e74dd8fa6de504882` | 16,256,258 | `0x1` (success) |
| BOTSpendVault | `0x653a1a92496592391c4490fcdaaafe6761e74151` | `0x2321ceb0a1ddcc52c9c1a343100d8e8dd6e87b0af1c8e0783772437d3fd40486` | 16,256,259 | `0x1` (success) |
| SimpleAccountFactory | `0xb885ca3bfbfad05e1233aea0b78aa728a6820ca5` | `0x1f0b95a047d9c634bd69e8d890456457ab348827fa3f33489ff350fa87259788` | 16,256,260 | `0x1` (success) |
| BOTSpendPaymaster | `0x74032d6ff09e12f77bbb9c2578d3bdbfc73ccad7` | `0x11f948d23dac0a648d2c3aef815b7dbef87b7f99261c00ebf750eb9fc0e884e8` | 16,256,261 | `0x1` (success) |

All four addresses match `BotSpend/web/lib/networks.ts` exactly. All four transactions are real,
sequential (blocks 16,256,258→16,256,261, i.e. one script run), and succeeded. **BOT Chain
mainnet 677 is real, live, and has at least one genuine, verified production contract deployment
on it** — this is direct, independently-checked evidence for the "target BOT Chain mainnet
directly" requirement.

## What is NOT yet confirmed (honest gaps)

- **The BotSpend mainnet gasless/paymaster flow is currently paused**, per `networks.ts` line 31:
  `interactive: false, // mainnet bundler relayer underfunded — live runs paused`. A
  `client/test/mainnet.proof.test.ts` exists that is designed to prove the full flow live against
  mainnet 677 (`describe("MAINNET 677 — live proof of both fences", ...)`), but this assessment did
  **not** execute it (it requires private keys from `internal/keys.json`, which this assessment
  correctly did not open, per the no-secrets rule) and cannot confirm from static inspection alone
  whether it was last run successfully or is stale. **Do not assume the paymaster/gas-sponsorship
  path is currently operational on mainnet without re-running that test with the project owner's
  keys, or checking recent mainnet transaction history from the paymaster/bundler.**
- `BotSpend/security.md`'s own closing "Responsible disclosure" line states *"This is a hackathon
  testnet deployment (BOT Chain 968)... no real funds at risk"* — this sentence is **stale relative
  to the later mainnet-677 config and deployment** found in `networks.ts` and the broadcast record
  above. BotSpend's internal documentation has not been fully reconciled between its testnet-only
  origin and its later mainnet deployment. Treat `networks.ts` + live RPC/explorer evidence as
  authoritative over this one sentence in `security.md`.
- **BO Wallet EIP-1193 compliance was not confirmed.** BotSpend's `web/lib/wagmi.ts` only configures
  the generic `injected()` wagmi connector (i.e., whatever standard injected provider the browser
  exposes) — there is no BO-Wallet-specific connector or code in the repository. This assessment
  found no evidence either confirming or denying that BO Wallet exposes a standards-compliant
  EIP-1193 provider; it has not been tested by this or the BotSpend project as far as tracked files
  show. **This must be tested directly with the actual BO Wallet browser extension/app before
  relying on plain `injected()` for Bull Rush.**
- **Finality policy** (how many confirmations BotSpend or BOT Chain infra treats as final) was not
  documented in any BotSpend file this assessment found, and was not independently derived (doing so
  safely requires observing chain reorg behavior over time, out of scope for a single static pass).
  This is an open item for Bull Rush's own relayer/indexer design (Phase 7).
