import { describe, expect, it } from 'vitest';
import { canTransitionTicket, canTransitionVerifiedRun, canTransitionClaim } from './stateMachines';

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
    it('allows verifying -> risk_hold as a branch, with no automatic way out', () => {
        expect(canTransitionVerifiedRun('verifying', 'risk_hold')).toBe(true);
        expect(canTransitionVerifiedRun('risk_hold', 'verified')).toBe(false);
        expect(canTransitionVerifiedRun('risk_hold', 'verifying')).toBe(false);
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
