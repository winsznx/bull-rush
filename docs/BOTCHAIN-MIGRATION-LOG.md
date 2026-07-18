# BOT Chain Migration Log

Running, chronological journal of this migration. Append entries; do not rewrite history.

---

## 2026 — Phase 0: Baseline and reusable-pattern assessment

**Starting state:** commit `e6e0468` on `main`, working tree clean. Branch
`feat/botchain-mainnet-skill-rewards` created from this point.

**Confirmed (not re-litigated) from the prior evidence-based repository assessment:** client-
authoritative/nondeterministic default engine, gameplay-affecting `Math.random()`, manipulable
client-submitted scores, an existing deterministic engine in `src/sim/` hidden behind `?sim=1`,
shadow-only server verification, display-name-keyed leaderboard, zero blockchain integration, no
authentication, manual deploys, ANSEM-specific copy, a slur in the gate quiz, gitignored-but-
live-in-production commercial music, and undocumented-provenance visual assets.

**BotSpend (`/Users/mac/botspend`) inspected read-only.** Findings in
`docs/BOTSPEND-REUSE-ASSESSMENT.md`. Headline corrections to the task's stated assumptions:

- BOT Chain **mainnet is chain ID 677** (not 968 — that's testnet). Both independently confirmed
  live via `eth_chainId`.
- BotSpend's mainnet deployment (4 contracts, 4 transactions, blocks 16,256,258–16,256,261) is
  **real and independently re-verified** against the live chain and explorer in this pass.
- BotSpend's mainnet **gasless/paymaster flow is currently paused** ("bundler underfunded" per its
  own config) — not confirmed operational in production today. Do not depend on it for Bull Rush's
  critical path.
- **No evidence found anywhere in BotSpend for the claimed "second place, BOT Chain Agent Track"
  award.** Per the task's own instruction, this claim is **excluded** from all Bull Rush submission
  material pending the project owner supplying independent, external evidence.

**Network validation performed live** (`docs/BOTCHAIN-NETWORK-VALIDATION.md`): `eth_chainId`,
`eth_blockNumber`, `eth_getBlockByNumber`, `eth_estimateGas`, `eth_feeHistory`, `eth_gasPrice`,
malformed-method error shape, explorer reachability, and Etherscan-compatible contract-ABI
verification endpoint — all checked against both networks where relevant, all passing.

**Current production snapshotted** (`docs/CURRENT-PRODUCTION-SNAPSHOT.md`): live URLs, current
bundle hashes, the current (non-migrated) Postgres/Redis schema, and every environment variable
name in use today — no values recorded.

**Decision:** Phase 0 is committed as its own focused commit before any product code changes begin,
so the evidence baseline is preserved independent of what Phase 1+ does to the repository.

**Explicitly not done in Phase 0, and why:** no BOT Chain deployer wallet, sponsor funds, or
independent human testers exist yet for this project — those are the project owner's inputs to
provide, not something to fabricate. Contract writing, mainnet deployment, and submission evidence
collection are sequenced after the application-layer work (Phases 1–13) specifically so that when
real funds and real testers are involved, everything they're touching is already hardened.

---

<!-- Append future phase entries below this line, in commit order. -->
