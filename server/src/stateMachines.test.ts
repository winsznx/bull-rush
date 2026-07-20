import { describe, expect, it } from 'vitest';
import {
    canTransitionTicket,
    canTransitionVerifiedRun,
    canTransitionClaim,
    canTransitionChainJob,
    canTransitionGridIndexing,
} from './stateMachines';

describe('run_ticket state machine', () => {
    it('allows issued -> consumed and issued -> expired', () => {
        expect(canTransitionTicket('issued', 'consumed')).toBe(true);
        expect(canTransitionTicket('issued', 'expired')).toBe(true);
    });
    it('allows no transitions out of consumed or expired (terminal states)', () => {
        expect(canTransitionTicket('consumed', 'issued')).toBe(false);
        expect(canTransitionTicket('consumed', 'expired')).toBe(false);
        expect(canTransitionTicket('expired', 'consumed')).toBe(false);
    });
});

describe('verified_run state machine', () => {
    it('allows the full happy path from received to confirmed', () => {
        expect(canTransitionVerifiedRun('received', 'verifying')).toBe(true);
        expect(canTransitionVerifiedRun('verifying', 'verified')).toBe(true);
        expect(canTransitionVerifiedRun('verified', 'receipt_queued')).toBe(true);
        expect(canTransitionVerifiedRun('receipt_queued', 'submitted')).toBe(true);
        expect(canTransitionVerifiedRun('submitted', 'confirmed')).toBe(true);
    });
    it('allows verifying -> risk_hold, with operator release as the only way out', () => {
        expect(canTransitionVerifiedRun('verifying', 'risk_hold')).toBe(true);
        // Phase 12: an explicit, audited operator release clears a hold...
        expect(canTransitionVerifiedRun('risk_hold', 'verified')).toBe(true);
        // ...but a hold can never rewind into the automated pipeline.
        expect(canTransitionVerifiedRun('risk_hold', 'verifying')).toBe(false);
        expect(canTransitionVerifiedRun('risk_hold', 'receipt_queued')).toBe(false);
    });
    it('rejects skipping a state (received straight to verified)', () => {
        expect(canTransitionVerifiedRun('received', 'verified')).toBe(false);
    });
});

describe('claim state machine', () => {
    it('allows the full happy path', () => {
        expect(canTransitionClaim('eligible', 'queued')).toBe(true);
        expect(canTransitionClaim('queued', 'submitted')).toBe(true);
        expect(canTransitionClaim('submitted', 'confirmed')).toBe(true);
    });
    it('rejects skipping a state and moving backwards', () => {
        expect(canTransitionClaim('eligible', 'confirmed')).toBe(false);
        expect(canTransitionClaim('confirmed', 'eligible')).toBe(false);
    });
});

describe('chain_job state machine', () => {
    it('allows the full happy path', () => {
        expect(canTransitionChainJob('pending', 'processing')).toBe(true);
        expect(canTransitionChainJob('processing', 'submitted')).toBe(true);
        expect(canTransitionChainJob('submitted', 'confirmed')).toBe(true);
    });
    it('allows a retryable failure to fall back to pending', () => {
        expect(canTransitionChainJob('processing', 'pending')).toBe(true);
    });
    it('allows a terminal failure from processing or a reverted tx from submitted', () => {
        expect(canTransitionChainJob('processing', 'failed')).toBe(true);
        expect(canTransitionChainJob('submitted', 'failed')).toBe(true);
    });
    it('rejects transitions out of terminal states', () => {
        expect(canTransitionChainJob('confirmed', 'pending')).toBe(false);
        expect(canTransitionChainJob('failed', 'pending')).toBe(false);
    });
});

describe('daily_grids.indexing_state machine', () => {
    it('allows the full happy path from off_chain to confirmed', () => {
        expect(canTransitionGridIndexing('off_chain', 'queued')).toBe(true);
        expect(canTransitionGridIndexing('queued', 'submitted')).toBe(true);
        expect(canTransitionGridIndexing('submitted', 'confirmed')).toBe(true);
    });
    it('allows failure from queued or submitted', () => {
        expect(canTransitionGridIndexing('queued', 'failed')).toBe(true);
        expect(canTransitionGridIndexing('submitted', 'failed')).toBe(true);
    });
    it('rejects transitions out of terminal states', () => {
        expect(canTransitionGridIndexing('confirmed', 'queued')).toBe(false);
        expect(canTransitionGridIndexing('failed', 'queued')).toBe(false);
    });
});
