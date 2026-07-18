# BotSpend Reuse Assessment

Source: `/Users/mac/botspend` (local, separate git repository, inspected **read-only** — nothing in
that repository was modified). BotSpend had pre-existing uncommitted local changes at inspection
time (`web/app/api/sponsor/route.ts` and four other files under `web/`, per `git status`); these
were **not touched, viewed for content, or referenced** by this assessment.

BotSpend is a real, working ERC-4337 gasless-spend project for AI agents. It is **not a game and
not a leaderboard/reward system** — its domain is "give an agent a wallet it can't drain," not
"verify a player's run." So reuse here is about **infrastructure patterns and proven BOT Chain
integration**, not domain logic.

## Corrected framing vs. the task's stated assumption

The task described BotSpend as "migrated to BOT Chain mainnet... awarded second place in the BOT
Chain Agent Track, where no first place was awarded." Verified findings:

- **Mainnet deployment: confirmed real**, independently, via live RPC (`docs/BOTCHAIN-NETWORK-VALIDATION.md`).
- **Award/placement claim: no supporting evidence found anywhere in the BotSpend repository.**
  `grep -rniE "second place|first place|award|placement|agent track|winner" **/*.md` (excluding
  vendored library changelogs) returned **zero matches**. Per the task's own instruction — *"Do not
  publish this claim unless local evidence or official communication supports it"* — **this claim
  must not be included in any Bull Rush submission material** until the project owner supplies
  independent, external evidence (an award announcement, email, or official BOT Chain
  communication). This assessment cannot manufacture that evidence and did not find it locally.

## Reuse table

| BotSpend component | Location | Proven working? | Reusable for Bull Rush? | Required adaptation |
|---|---|---:|---:|---|
| BOT Chain mainnet network config (chain ID, RPC, explorer, native currency) | `web/lib/networks.ts` | **Yes** — chain ID independently re-verified live via `eth_chainId` this session | **Yes, directly** | None structurally; Bull Rush needs its own `contracts` addresses once its own contracts deploy |
| `viemChain()` chain definition helper | `web/lib/networks.ts:77-85` | Yes (used to build both live wagmi chains) | Yes | Copy pattern, not the BotSpend-specific fields |
| wagmi config (`injected()` only, both chains registered) | `web/lib/wagmi.ts` | Partially — wired and typed correctly; **not confirmed against BO Wallet specifically** (only generic injected) | Yes as a starting point | Must explicitly test BO Wallet's injected provider for EIP-1193 compliance before shipping; add WalletConnect only if BO Wallet doesn't cover mobile |
| `networkByChainId()` / explorer link helpers | `web/lib/networks.ts:87-92` | Yes | Yes | Trivial port |
| EIP-4337 SimpleAccount + Factory pattern | `src/` (Foundry), `lib/account-abstraction` (vendored v0.7.0) | **Yes, deployed and verified on mainnet 677** (see network validation doc) | **Only if Bull Rush adopts smart-account gas sponsorship for the self-claim fallback** — the task's Wallet UX spec (item 15) makes this conditional on BotSpend's flow being *proven* in production | BotSpend's own config currently marks mainnet gasless runs `interactive: false` (paused — bundler underfunded). **This flow is not currently confirmed operational in production.** Do not depend on it for Bull Rush's launch critical path; treat as a stretch goal pending BotSpend's own bundler being refunded and re-verified live. |
| `BOTSpendPaymaster.sol` (storage-free, immutable-destination-gated paymaster) | `src/BOTSpendPaymaster.sol` | Yes, deployed + verified mainnet | Not directly reusable — Bull Rush's contracts (`DailyGridRegistry`, `VerifiedRunRegistry`, `SeasonPrizeVault`) are not agent-spend-policy contracts; the paymaster's *pattern* (storage-free validation, ERC-7562 stake-exemption awareness) is a useful reference if Bull Rush ever sponsors the self-claim fallback, but the contract itself solves a different problem domain | Do not port verbatim; re-read for the ERC-7562 storage-free-validation lesson only, if/when gas sponsorship is attempted |
| `BOTSpendVault.sol` (caps, allowlists, dedup, no-revert-on-policy, hand-rolled reentrancy guard, CEI ordering) | `src/BOTSpendVault.sol` | Yes, deployed + verified mainnet | **Pattern-reusable for `SeasonPrizeVault.sol`**: the CEI-ordering discipline, hand-rolled reentrancy guard, and "policy violations emit+return rather than revert" design philosophy are directly applicable engineering lessons | Bull Rush's vault is a **reward-claim vault**, not a spend-policy vault — different function surface (`claim`/`claimFor` vs `executeSpend`), but the safety patterns (CEI, reentrancy guard, explicit balance accounting, `SafeERC20`) transfer directly per the task's own contract requirements |
| Foundry project layout (`src/`, `test/`, `script/`, `foundry.toml` with `evm_version=cancun`, OZ 5.x + forge-std vendored under `lib/`) | repo root | Yes — builds and tests pass per BotSpend's own README quick-start (not re-run in this assessment to avoid touching that repo's build artifacts) | Yes, directly | Bull Rush should mirror this exact `foundry.toml` shape (`solc 0.8.28`, `evm_version cancun`, `optimizer_runs 200`) since it's already confirmed compatible with BOT Chain 677/968 |
| Deployment script shape (`script/DeployAll.s.sol` style, one script per logical deploy unit) | `script/*.s.sol` | Yes — produced the real, verified mainnet deployment above | Yes as a structural pattern | Bull Rush needs its own scripts (`DeployDailyGridRegistry.s.sol`, etc.); do not copy BotSpend's constructor args or contract logic |
| `.env.example` shape (`VERIFYING_SIGNER_KEY`, `AGENT_OWNER_KEY` — names only) | `web/.env.example` | Yes | Pattern-reusable | Bull Rush needs analogous but differently-named vars (e.g. `VERIFIER_SIGNER_KEY`, `RELAYER_KEY`) — do not reuse BotSpend's actual key material, obviously, and none was read or copied |
| Key-management discipline: signer keys server-only, never `NEXT_PUBLIC_`, `internal/` + Foundry `cache/` gitignored, client bundle grep-verified to contain zero key material | `security.md` "Key management" section | Yes, documented practice | **Yes — directly adopt this checklist for Bull Rush's relayer/verifier keys** | Add the same "grep the client bundle for key material" check to Bull Rush's CI (Phase 14) |
| Two-network toggle UI pattern (mainnet/testnet switch, `NetworkToggle.tsx`) | `web/components/dashboard/NetworkToggle.tsx` | Yes, functioning UI | Optionally reusable if Bull Rush ships a staging/mainnet toggle for testers | Low priority; Bull Rush's public product should default straight to mainnet per the task's brief |
| CI (GitHub Actions) | none found in BotSpend itself (only vendored-library CI under `lib/`) | N/A | **Not reusable — BotSpend has no CI of its own to borrow.** Bull Rush's CI (Phase 14) must be built fresh. | — |
| Award/placement claim | — | **No local evidence found** | **Not reusable — do not publish without external confirmation** | Ask the project owner directly for the actual award evidence before drafting `FORM-ANSWERS.md` |

## Summary recommendation

Reuse from BotSpend at the **pattern and configuration level**, not the code level:

1. Adopt `networks.ts`'s exact chain-config shape (chain ID, RPC, explorer, `viemChain()` helper) — this is the single highest-value, lowest-risk port, and it's independently verified live.
2. Adopt the Foundry project skeleton and dependency pinning (`solc 0.8.28`, `evm_version cancun`, OZ 5.x, forge-std) — already proven compatible with BOT Chain.
3. Adopt the security *disciplines* documented in `security.md` (CEI ordering, hand-rolled reentrancy guard, no-revert-on-policy for non-safety-critical checks, key-management checklist, client-bundle key-leak grep) for `SeasonPrizeVault.sol` and the relayer.
4. **Do not** depend on BotSpend's gasless/paymaster flow for Bull Rush's launch-critical path — it is unconfirmed as currently operational in production (mainnet `interactive: false`).
5. **Do not** publish the award/placement claim without independent evidence from the project owner.
