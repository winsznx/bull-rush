# ADR 0008: End-of-run receipt-status UX

## Status
Accepted

## Context
Phase 7 made `verified_runs.status` and `daily_grids.indexing_state` actually move through
`verified -> receipt_queued -> submitted -> confirmed`, but nothing surfaced that progression to
the player. `GameOver.tsx` showed the server-canonical result the instant the submit HTTP request
resolved and then never looked at the run again — a personal best's on-chain receipt could
confirm minutes later (once Phase 15 deploys a relayer target) and the player would have no way
to see it happened, undermining the whole "onchain competitive receipt" pitch.

The original mega-prompt's Phase 8 also names "claim UX." Nothing built through Phase 7 produces
a claimable reward — there is no season, no funded vault, no Merkle tree (all Phase 10). Building
a claim button now would mean fabricating a UI for an entitlement that provably doesn't exist yet.
Per this project's standing rule against fabricating anything not genuinely real and testable,
claim UX is explicitly deferred to Phase 10, where a real claimable balance will exist to build
against.

## Decisions

**A dedicated poll endpoint, not a bigger submit response.** `GET
/api/grid/run/:id/status` (server/src/index.ts) is separate from `POST /api/grid/submit` because
the two have different lifetimes: submit resolves once, synchronously, the moment re-simulation
finishes; the receipt's `queued -> submitted -> confirmed` progression happens later, driven by a
relayer process the HTTP request has already returned from. A client that wants to watch that
progression has to ask again, more than once — a single response object can't represent "check
back later."

**Ownership-checked by identity, not merely by an unguessable UUID.**
`getVerifiedRunStatus(runId, identityKey)` (server/src/grid.ts) filters on `identity_key` in the
same query as the `id` lookup, so a different session gets `null` (surfaced as 404) rather than
another player's run details, even though the id itself is already an unguessable v4 UUID. Cheap
insurance, consistent with this project's habit of not relying solely on obscurity where an
explicit check costs nothing.

**Only a personal best is ever worth polling — a worse run has no receipt, and the UI knows
this without a special "no receipt" server response.** `recordVerifiedRun`'s return value already
tells the submit handler (and, through it, the client) exactly which status a run rested at;
`GameOver.tsx`'s `receiptRunId` is derived (not a separate fetch) from `verified.isPersonalBest`
and `verified.runId` together — no receiptRunId, no polling, no UI. A non-personal-best run's
`status` would just read `'verified'` forever if polled (accurate, not broken), but the client
never bothers asking, since it already knows from the submit response alone that there's nothing
to watch.

**A shadow-hidden (suspicious) run gets no `runId` in the response at all**, not a `runId` that
resolves to `risk_hold`. This preserves the existing anti-cheat posture (ADR 0002/Phase 2): a
flagged run already shows the player nothing different from an ordinary unlisted result; handing
back a pollable id whose status happened to read `risk_hold` would be a distinguishing signal a
cheater could learn to watch for.

**Bounded client-side polling (3s interval, 40 attempts, ~2 minutes), not indefinite.** Phase 7's
ADR already decided against confirmation-count finality waits and dead-letter alerting; the
client mirrors that same "don't pretend to guarantee something the backend doesn't" posture —
polling stops once `confirmed` is reached or the attempt budget runs out, leaving the UI at
whatever the last known state was (today, in every real environment, that's `receipt_queued` or
`verified`, since no relayer is live anywhere — see below). This is honest: it reflects the real
state of a job sitting in a real, unprocessed queue, not a fabricated "confirmed" the backend
never produced.

**No claim UX built.** See Context — nothing exists yet for a player to claim. Deferred to Phase
10 in full, not stubbed with a disabled button or placeholder copy that could be mistaken for a
real (if not-yet-available) feature.

## What this looks like today, honestly
Every environment through Phase 8 has `CHAIN_RELAYER_ENABLED` unset (Phase 15 is still the gated
point where a relayer target exists). A player who sets a personal best today will see "RECEIPT
QUEUED…" and it will stay there — accurately, since the job really is queued and nothing is
processing it yet. This is not a bug being papered over; it is what a durable, honestly-reported
outbox looks like before its consumer exists. The moment Phase 15 stands up a real relayer against
a real deployed contract, the exact same client code starts showing `SUBMITTED` and then
`CONFIRMED ▸ VIEW ON BOTSCAN` with no further changes required — this was the point of building
the outbox and this UI against real, if currently idle, infrastructure rather than mocking either
side.

## Verification
- `server/src/grid.integration.test.ts` — two new tests against real Postgres + Redis: a personal
  best starts at `receipt_queued` and is pollable only by its own identity (a different identity
  gets `null`); a non-personal-best run rests at `verified` with `isPersonalBest: false`.
- **Real, live end-to-end HTTP verification** — a new committed script,
  `scripts/verify-grid-local.ts` (`npm run local:verify:grid`), exercises the entire path against
  a running local server with no mocks: a throwaway wallet signs a real SIWE message, verifies,
  opens a grid, requests a ticket, plays and submits a real deterministic run, and polls its own
  run's status — confirmed the submit response's `runId`/`status` and the poll endpoint's
  response agree exactly, and that `isPersonalBest` reads back correctly.
- Client bundle sanity-checked via headless Chrome (CDP): the dev server's bundle imports
  (including the new `wallet/chain.ts` and `gridApi.ts` exports pulled into `GameOver.tsx`)
  resolve and React mounts successfully — the run stops only at Three.js's WebGL context
  creation, a headless-sandbox GPU limitation unrelated to this change, not an import or render
  error in the code touched here. Full interactive visual verification of the receipt-status UI
  in an actual gameplay session was not possible in this sandboxed environment; the data flow it
  renders was instead proven correct via the real HTTP script above, and the component
  typechecks cleanly against the exact response shapes that script confirmed the server returns.
- Full regression pass: `tsc --noEmit` clean on both packages; `sim:sync`/`sim:check` clean;
  `npm test` 56/56 unchanged; `sim:test` 27/27 unchanged; `test:integration` 18/18 (+2); full
  `npm run build` (mp3s relocated per the established pattern, restored after).
