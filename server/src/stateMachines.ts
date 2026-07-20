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
    // The ONLY way out of risk_hold is an operator's explicit release after
    // manual review (Phase 12's releaseHeldRun — write-credentialed, audited).
    // No automated path ever clears a hold.
    risk_hold: ['verified'],
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

// Phase 7's relayer outbox (chain_jobs). `processing` can fall back to `pending` on a
// retryable failure (network hiccup, nonce contention) — that's a legal transition, not
// an error — or move to `failed` once retries are exhausted.
export type ChainJobStatus = 'pending' | 'processing' | 'submitted' | 'confirmed' | 'failed';

const CHAIN_JOB_TRANSITIONS: Record<ChainJobStatus, ChainJobStatus[]> = {
    pending: ['processing'],
    processing: ['submitted', 'pending', 'failed'],
    submitted: ['confirmed', 'failed'], // failed: the tx was mined but reverted
    confirmed: [],
    failed: [],
};

export function canTransitionChainJob(from: ChainJobStatus, to: ChainJobStatus): boolean {
    return CHAIN_JOB_TRANSITIONS[from].includes(to);
}

// daily_grids.indexing_state (Phase 3 added the column pre-emptively, defaulted to
// 'off_chain'; Phase 7 is the first phase that actually moves it).
export type GridIndexingState = 'off_chain' | 'queued' | 'submitted' | 'confirmed' | 'failed';

const GRID_INDEXING_TRANSITIONS: Record<GridIndexingState, GridIndexingState[]> = {
    off_chain: ['queued'],
    queued: ['submitted', 'failed'],
    submitted: ['confirmed', 'failed'],
    confirmed: [],
    failed: [],
};

export function canTransitionGridIndexing(from: GridIndexingState, to: GridIndexingState): boolean {
    return GRID_INDEXING_TRANSITIONS[from].includes(to);
}
