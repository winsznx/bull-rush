// Explicit state machines for the three lifecycles that carry real
// consequences (a ticket, a scored run, an eventual reward claim). Each is a
// pure adjacency map + a pure check function — no I/O, fully unit-testable —
// used by the actual mutation code as an assertion, not just documentation.
//
// `verified_run` and `claim` include states this codebase cannot reach yet
// (RECEIPT_QUEUED/SUBMITTED/CONFIRMED need Phase 6/7's contracts + relayer;
// `claim` is entirely unreachable until Phase 10). They're modeled now so the
// schema and the transition rules don't need to change shape when those
// phases land — only new code that reaches the already-defined states does.

export type TicketStatus = 'issued' | 'consumed' | 'expired';

// Deliberately NOT including a distinct "started" state from the original
// spec's ISSUED -> STARTED -> CONSUMED -> EXPIRED: nothing today distinguishes
// "ticket issued, player hasn't pressed a key yet" from "issued, mid-run" —
// both are simply "issued, not yet consumed, not yet expired." Adding a
// STARTED transition with no observable event to trigger it would be state
// with no purpose. Revisit if a future phase needs to detect abandoned runs.
const TICKET_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
    issued: ['consumed', 'expired'],
    consumed: [],
    expired: [],
};

export function canTransitionTicket(from: TicketStatus, to: TicketStatus): boolean {
    return TICKET_TRANSITIONS[from].includes(to);
}

export type VerifiedRunStatus = 'received' | 'verifying' | 'verified' | 'risk_hold' | 'receipt_queued' | 'submitted' | 'confirmed';

const VERIFIED_RUN_TRANSITIONS: Record<VerifiedRunStatus, VerifiedRunStatus[]> = {
    received: ['verifying'],
    verifying: ['verified', 'risk_hold'],
    verified: ['receipt_queued'],
    risk_hold: [], // manual review path (Phase 12) — no automatic transition out
    receipt_queued: ['submitted'],
    submitted: ['confirmed'],
    confirmed: [],
};

export function canTransitionVerifiedRun(from: VerifiedRunStatus, to: VerifiedRunStatus): boolean {
    return VERIFIED_RUN_TRANSITIONS[from].includes(to);
}

export type ClaimStatus = 'eligible' | 'queued' | 'submitted' | 'confirmed';

const CLAIM_TRANSITIONS: Record<ClaimStatus, ClaimStatus[]> = {
    eligible: ['queued'],
    queued: ['submitted'],
    submitted: ['confirmed'],
    confirmed: [],
};

export function canTransitionClaim(from: ClaimStatus, to: ClaimStatus): boolean {
    return CLAIM_TRANSITIONS[from].includes(to);
}
