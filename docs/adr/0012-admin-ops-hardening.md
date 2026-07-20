# ADR 0012: Admin/ops security hardening

## Status
Accepted

## Context
Through Phase 11, every admin route used the same two lines: read `ADMIN_KEY` from env,
compare with `!==`, 403 on mismatch. That model has four problems: the comparison leaks
timing, one credential grants everything (a leaked diagnostics key can close a season), an
irreversible action executes on a single keystroke, and nothing records what an operator did.
Phase 12 replaces the model without breaking the deployment (`ADMIN_KEY` still works) and
builds the manual-review workflow Phase 11's risk signals were collecting evidence for.

## Decisions

**Constant-time comparison, by hashing both sides first.** `timingSafeEqual` over the sha256
digests of the presented and configured keys — the digest step means neither content nor
*length* of the configured key leaks through timing, and the buffers always have equal length
(a raw `timingSafeEqual` throws on length mismatch, which is itself a length oracle).

**Two credentials, write implies read, legacy key stays valid.** `ADMIN_WRITE_KEY` gates
mutations; `ADMIN_READ_KEY` gates diagnostics (`stats`, `risk`, `chain-jobs`, `audits`, and
dry-runs). The legacy `ADMIN_KEY` resolves as the write key so existing deployments don't lock
themselves out on upgrade — but is superseded (ignored) the moment `ADMIN_WRITE_KEY` is set,
so rotation to the new scheme is one env change. Failed attempts are rate-limited per IP
(10/min → 429), so the keyspace can't be hammered.

**Confirmation tokens for irreversible actions — two-step, parameter-bound, single-use.**
`season/close` (commits a payout root forever) and `purge-suspicious` (deletes rows) no longer
execute on first call: the first request returns a *preview* (season close's preview is a full
dry-run — root, claim count, total) plus a 5-minute, single-use token bound via fingerprint to
the exact action and parameters. Only replaying the identical request with that token executes.
A leaked token can't authorize a different season, can't be used twice, and a mismatch attempt
burns it (GETDEL before validation). Reversible/idempotent mutations (grid open, sweep,
rebuild, flag-implausible) stay single-step — friction should be proportional to
irreversibility, or operators start scripting around it.

**Dry-run mode with read credentials.** `?dryRun=1` on both dangerous endpoints computes
everything and writes nothing — and deliberately requires only the read key, so routine "what
would this do" checks don't need the write credential out of storage at all.

**The audit trail finally exists.** `audit_logs` (schema-ready since migration 0006, never
written until now) records every admin mutation: actor (`admin:<role>` + optional salted
network hint, never a raw IP), action, target, metadata. Best-effort by design — an audit
INSERT failure logs and continues, because a broken audit table must never take season closing
down with it (the inverse posture is a config decision for later, not a default). Reads are
not audited. `GET /api/admin/audits` serves the trail.

**Manual review actions — the workflow Phase 11's signals feed.**
- `releaseHeldRun`: the ONLY path out of `risk_hold` (the state machine now permits exactly
  `risk_hold → verified`, still nothing automated). Atomic compare-and-set, then the released
  run gets precisely the tail a clean record would have gotten: leaderboard `ZADD GT`,
  personal-best check, receipt-queue enqueue (idempotent by on-chain run id). A wrongly held
  run ends up exactly where it would have been — nothing more, no compensation lever to abuse.
- `clearUserRiskState`: `flagged → none` only; an operator cannot write arbitrary states.
- Both write-credentialed and audited.

**No named admin accounts.** Actors are recorded as role + network hint, not identities —
because there are no admin identities yet; inventing per-operator accounts for a single-
operator project would be ceremony. The audit schema's `actor` field is free-text precisely so
real identities can slot in later without a migration.

## What was NOT built, and why
- **Session-based admin UI / admin SIWE.** Header keys remain the mechanism; the hardening
  targeted the real current risks (timing, blast radius, fat-fingers, no trail), not the
  transport. Revisit if a human admin panel ever exists.
- **Refuse-on-audit-failure mode.** Documented above as a deliberate availability-over-
  completeness default.
- **Key rotation tooling.** Rotation is an env change; the dual-key scheme already permits
  staged rotation (set new write key → old ADMIN_KEY dies instantly).

## Verification
- `adminAuth.test.ts` (7, pure): role resolution for every credential combination (including
  legacy fallback and write-key precedence over legacy), write-implies-read, fingerprint
  order-independence.
- `stateMachines.test.ts` updated: `risk_hold → verified` legal (operator release);
  `risk_hold → verifying/receipt_queued` still illegal.
- `admin.integration.test.ts` (7, real Postgres + Redis): confirm tokens — exactly once, bound
  to action AND parameters, mismatch burns the token, unknown token rejected; audit rows write
  and read back with metadata; release — held run lands on the leaderboard at its real
  distance, status `receipt_queued`, exactly one chain job enqueued, second release is a
  no-op; never-held run refused; `clearUserRiskState` clears exactly once.
- **Live over real HTTP**: the season close in `verify-grid-local.ts` is now genuinely
  two-step — first call returns `confirmRequired` + preview, confirmed call executes, and the
  script asserts the preview root equals the executed root. The live audit trail was inspected
  after the run: `grid.open`, `season.create`, and `season.close` all recorded with actor,
  target, and metadata.
- Fresh-DB proof (9 migrations from nothing) → 35/35 integration (+7). Full regression:
  typechecks clean, `sim:check` clean, 94/94 unit (+7), 35/35 sim (fingerprint unchanged),
  full build.
