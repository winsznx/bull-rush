# ADR 0011: Behavioral risk signals

## Status
Accepted

## Context
The architectural anti-cheat (deterministic re-simulation, one-time tickets, server-derived
scores, exact-hash replay uniqueness) makes score *forgery* impossible. What remains is
behavior that produces genuinely valid replays by illegitimate means: machine play, replay
theft with perturbation (the attack ADR 0009 explicitly deferred here), wall-clock-implausible
runs, and multi-wallet reward farming. Phase 11 is that layer.

## Decisions

**Signals shadow-hold; they never hard-reject.** A structural violation (bad envelope, wrong
seed) is a hard 4xx — those are certainties. A behavioral signal is a probability, so its
consequence is `risk_hold`: recorded fully, invisible on the leaderboard, zero reward points
(Phase 10 already enforces this), pollable by nobody, and the submitter's response is
indistinguishable from an ordinary accepted run that didn't chart. A false positive costs a
review, not a banned honest player.

**Every hold carries its reasons.** `verified_runs.risk_reasons` (migration 0009) records
exactly which signals fired (`too_fast`, `too_long`, `bot_like_cadence`,
`near_duplicate_replay`) so Phase 12's review reads evidence, not a bare boolean. Redis
counters (`verify:grid:risk:<reason>`) track per-reason volumes for the admin stats view.

**Signals live in one pure module (`server/src/behavior.ts`).** The cadence heuristic the
practice path has used since Phase 2 moved there verbatim (index.ts aliases `botLike =
cadenceSignal`, so the practice path's semantics are unchanged and both paths now share one
definition), joined by duration bounds and replay similarity. No I/O anywhere in the module —
14 unit tests run without services.

**Perturbed-copy detection: tolerance-based LCS over the input trace.** Two inputs "match" if
the action is identical and ticks are within ±3; similarity = LCS/max(len). This is
insertion/deletion-tolerant (padding a stolen log with decoy taps doesn't break alignment) and
timing-tolerance covers the jitter a copier must add to change the hash. The decisive
asymmetry: on a shared deterministic course, two honest humans may make similar *choices*, but
they never agree tick-exactly (±3) on ≥85% of a log — motor noise is idiosyncratic — while a
perturbed copy does by construction, because moving inputs further than a few ticks starts
desyncing the run it stole. Candidates are pre-filtered (same grid, replay length and outcome
within ±15% — a copy necessarily lands near its source) to bound the O(n·m) DP to a handful of
plausible sources; risk_hold rows stay in the candidate pool (a copy of a copy is still a copy).

**Two different sample-size floors, deliberately.** Cadence keeps its 30-input floor (variance
estimation needs a sample). Similarity uses 15: ≥85% of 15+ inputs each matching within ±3
ticks does not occur between independent players, and the higher floor left short leader runs
freely copyable — found live, not hypothetically: the extended `verify-grid-local.ts` mounted
a perturbed copy of a 28-input leader run and it sailed through under the original shared
floor of 30. Lowered, re-run, shadow-held.

**Repeat offenders escalate to a review marker, not a punishment.** Three risk_hold runs
within 7 days sets `users.risk_state = 'flagged'` — monotonic, idempotent, and deliberately
without any automated consequence: nothing changes for a flagged user's future submissions.
Phase 12's review process decides; automation only gathers.

**Sybil visibility via salted IP hints, never raw IPs.** `ip_hint` is the first 16 hex chars
of `sha256(salt:ip)`, NULL unless `IP_HINT_SALT` is configured (no accidental collection).
The admin risk overview surfaces grids where ≥2 distinct wallets share a network origin — a
*review signal only*, never an automatic hold, because households and cafés legitimately share
IPs. This is the honest version of sybil defense at this scale: correlation for a human to
look at, no pretense of automated identity resolution.

**One review surface: `GET /api/admin/risk`.** Held runs with reasons, flagged users,
shared-origin clusters — same `ADMIN_KEY` guard as every admin route (Phase 12 hardens that
auth model itself).

## What was NOT built, and why
- **Automated penalties of any kind** (bans, score wipes, auto-rejection on similarity). Every
  behavioral signal is probabilistic; consequences beyond shadow-holding belong to a human
  process (Phase 12).
- **Cross-grid behavioral profiling / reaction-time-vs-obstacle analysis.** Real signal, real
  complexity; nothing about the current data model blocks adding it later. The per-run
  reasons array is where its verdicts would land.
- **Practice-path similarity.** Practice seeds are per-run random — there is nothing to copy.

## Verification
- `behavior.test.ts` (14, pure): regular cadence flagged past 30 inputs and not under it,
  human jitter passes, superhuman rate flagged; duration bounds; similarity — identical = 1,
  ±2-tick jittered copy ≥ threshold, decoy insertions survive, independent runs well below,
  empty logs; assessRun composition incl. reason accumulation and the similarity floor.
- `behavior.integration.test.ts` (4, real Postgres + Redis): a jittered copy of a *stored*
  replay is found via the real candidates query and flagged; reasons persist and surface in
  the overview; 3 holds in the window flags the user (2 do not); shared ip_hint clusters
  surface with both identities.
- **Live over real HTTP**: the perturbed-copy attack (hash changed, run effectively identical)
  submitted through a fresh ticket returns `ok:true, hidden:true` — shadow-held, no runId,
  copier told nothing. The exact-copy 409 and every prior loop stage still pass.
- Fresh-DB proof: all 9 migrations from nothing → 28/28 integration. Full regression: both
  typechecks clean, `sim:check` clean, 87/87 unit (+14), 35/35 sim (fingerprint unchanged),
  full build.
