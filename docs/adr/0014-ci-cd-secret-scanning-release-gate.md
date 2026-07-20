# ADR 0014: CI/CD — secret scanning and the release gate

## Status
Accepted

## Context
CI has grown organically since Phase 2 (game/server/integration/contracts jobs). Phase 14
closes the gaps a real release process needs: proof no secret was ever committed, a single
reproducible pre-release gate an operator can run without reconstructing it from memory, and a
written deploy/rollback procedure that makes the migrate-before-deploy ordering (ADR 0005)
impossible to skip by accident.

## Decisions

**Secret scanning over full history, allowlist-by-justification.** `gitleaks` scans the
entire commit graph (`fetch-depth: 0` in CI) — a secret committed and later reverted is still
leaked and must fail. The first scan surfaced 155 findings; triage:
- **151 in `contracts/lib/openzeppelin-contracts/**`** — vendored dependency test fixtures
  (published ECDSA test vectors, dummy keys in OZ's own token tests). Not this project's
  secrets; allowlisted by path.
- **3 test private keys** (`siwe.test.ts`, `relayer.integration.test.ts`,
  `seasons.integration.test.ts`) — all the *same* anvil/hardhat well-known development key #0
  (mnemonic "test test … junk"), deliberately public, used only against local anvil, holds no
  value on any real network. Allowlisted by the exact key value.
- **1 `local-admin-key`** in `LOCAL-TESTING.md` — a documented local placeholder; the real
  value only ever lives in gitignored `.env` files. Allowlisted by that literal.

Every allowlist entry in `.gitleaks.toml` carries a one-line justification. The point of the
allowlist is that anything *new* the scanner finds — a real key, a real token — fails CI until
a human removes it or adds a justified entry. Zero findings after allowlisting, on both history
and the working tree.

**Nothing real was leaked.** The triage confirmed all 155 findings are either third-party test
fixtures or the intentionally-public anvil key / a doc placeholder — consistent with this
project's discipline from Phase 0 onward of never printing or committing real keys, and of
using throwaway wallets (`generatePrivateKey()`) for every signature test.

**One-command release gate (`npm run release:check`).** A Node script running every gate in the
checklist's order, stopping at the first failure, restoring the local mp3s in a `finally` even
on failure. It deliberately duplicates what CI runs — not to replace CI, but so the operator
executes the *identical* set locally at release time instead of remembering nine commands. The
forbidden-asset check is not a standalone step: it runs inside the production build, after the
local mp3s are moved aside, because "ship" means "build output" and that is the state that
actually matters.

**CI concurrency group.** A superseded push to the same ref cancels its in-flight run
(`cancel-in-progress`), so rapid pushes don't queue redundant full-matrix runs.

**Written release checklist with rollback.** `docs/RELEASE-CHECKLIST.md` codifies: run the
gate, **migrate before deploying code** (the server refuses to boot against pending migrations,
so a skipped step fails loudly, not silently), deploy API then client, env-vars-before-the-code-
that-reads-them, post-deploy `/status` + metrics + audit verification, and rollback (code
rolls back freely since migrations are additive; migrations never roll back — fix forward;
Redis leaderboard state rebuilds from Postgres).

## What was NOT built, and why
- **A provisioned staging environment.** Specified in the checklist, not stood up: it touches
  the production Railway account and is an operator decision, not something to create
  unilaterally. The local stack is the pre-production environment until then. Documented as a
  named gap, not silently omitted.
- **Automated deploy-on-merge.** Deploys stay operator-run (Railway). The checklist is written
  so each step becomes a pipeline stage when automation is added, without redesign.
- **Signed commits / branch protection.** Repo-administration policy, not code; out of scope
  for this phase's work.

## Verification
- `gitleaks git --config .gitleaks.toml` — **no leaks** across all 16 commits of history; the
  same clean result on the full working tree (`gitleaks dir`, 63 MB incl. vendored deps).
- `npm run release:check` — run end-to-end, **all 10 gates green**, exit 0, local mp3s moved
  aside for the build and restored after (confirmed 5 present before and after).
- CI workflow: `secrets` job added with full history + `.gitleaks.toml`; concurrency group
  added; existing game/server/integration/contracts jobs unchanged. Structure validated.
- The pre-existing suites the gate wraps are all green as of this phase: 97 unit, 35 sim, 38
  integration, 43 contracts, clean build.
