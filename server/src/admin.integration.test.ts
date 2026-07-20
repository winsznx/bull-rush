// Phase 12 admin-ops flows against real Postgres + Redis: single-use confirm
// tokens, the audited operator release of a held run (the only path out of
// risk_hold), and repeat-offender clearing.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from './db.ts';
import { runMigrations } from './migrate.ts';
import { redis } from './redis.ts';
import { actionFingerprint } from './adminAuth.ts';
import { issueConfirmToken, consumeConfirmToken } from './adminConfirm.ts';
import { audit, recentAudits } from './audit.ts';
import { openGrid, issueTicket, consumeTicket, recordVerifiedRun, releaseHeldRun, clearUserRiskState, getGridLeaderboard } from './grid.ts';
import { GAME_VERSION } from './sim/ruleset.ts';

beforeAll(async () => {
    await runMigrations();
});

afterAll(async () => {
    await sql.end();
    redis.disconnect();
});

describe('confirm tokens (real Redis)', () => {
    it('a token works exactly once, for its own action + parameters only', async () => {
        // #given a token bound to closing season-x
        const fp = actionFingerprint({ seasonId: 'season-x' });
        const token = await issueConfirmToken('season.close', fp);

        // #then it fails for a different action or different parameters
        expect(await consumeConfirmToken(token, 'runs.purge_suspicious', fp)).toBe(false);
        // (the mismatch attempt burned it — single-use regardless of outcome)
        expect(await consumeConfirmToken(token, 'season.close', fp)).toBe(false);

        // #given a fresh token
        const token2 = await issueConfirmToken('season.close', fp);
        // #then the exact match consumes it once, and never again
        expect(await consumeConfirmToken(token2, 'season.close', fp)).toBe(true);
        expect(await consumeConfirmToken(token2, 'season.close', fp)).toBe(false);
    });

    it('a token for one season cannot confirm closing another', async () => {
        const token = await issueConfirmToken('season.close', actionFingerprint({ seasonId: 'season-a' }));
        expect(await consumeConfirmToken(token, 'season.close', actionFingerprint({ seasonId: 'season-b' }))).toBe(false);
    });

    it('an unknown token is rejected', async () => {
        expect(await consumeConfirmToken('deadbeef', 'season.close', actionFingerprint({ seasonId: 's' }))).toBe(false);
    });
});

describe('audit trail (real Postgres)', () => {
    it('writes and reads back an audit row with metadata', async () => {
        const action = `test.action.${randomUUID().slice(0, 8)}`;
        await audit('admin:write@testhint', action, 'some-target', { count: 3, note: 'hello' });

        const rows = await recentAudits(50);
        const row = rows.find((r) => r.action === action);
        expect(row).toBeDefined();
        expect(row?.actor).toBe('admin:write@testhint');
        expect(row?.target).toBe('some-target');
        expect(row?.metadata).toEqual({ count: 3, note: 'hello' });
    });
});

describe('operator release of a held run (real Postgres + Redis)', () => {
    async function seedHeldRun(identity: string): Promise<{ runId: string; gridId: string }> {
        const grid = await openGrid(`test-${randomUUID()}`);
        await sql`UPDATE daily_grids SET opens_at = now() - interval '1 minute' WHERE id = ${grid.id}`;
        const issued = await issueTicket(identity, grid.id);
        if (!('ticket' in issued)) throw new Error('unreachable');
        await consumeTicket(issued.ticket.id);
        const { id } = await recordVerifiedRun({
            gridId: grid.id,
            ticketId: issued.ticket.id,
            identityKey: identity,
            player: identity.split(':')[1] as `0x${string}`,
            gameVersion: GAME_VERSION,
            replayHash: `0x${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}` as `0x${string}`,
            replayTicks: 600,
            replayInputsFlat: [10, 1, 30, 2],
            distance: 1200,
            score: 1200,
            maxCombo: 0,
            deathCause: 'test',
            durationMs: 20_000,
            suspicious: true,
            riskReasons: ['bot_like_cadence'],
            ipHint: null,
            replayLen: 2,
        });
        return { runId: id, gridId: grid.id };
    }

    it('release moves the run to the leaderboard and queues its receipt — once', async () => {
        // #given a held run that would lead its grid (real-format identity —
        // release derives the receipt's wallet from the identity key)
        const wallet = `0x${randomUUID().replace(/-/g, '')}${'0'.repeat(8)}`.slice(0, 42);
        const identity = `677:${wallet}`;
        const { runId, gridId } = await seedHeldRun(identity);
        const boardBefore = await getGridLeaderboard(gridId, 10);
        expect(boardBefore.some((e) => e.identityKey === identity)).toBe(false);

        // #when the operator releases it
        const result = await releaseHeldRun(runId);

        // #then it lands exactly where a clean record would have
        expect(result.released).toBe(true);
        expect(result.isPersonalBest).toBe(true);
        const board = await getGridLeaderboard(gridId, 10);
        expect(board.some((e) => e.identityKey === identity && e.distance === 1200)).toBe(true);
        const [row] = await sql<{ status: string }[]>`SELECT status FROM verified_runs WHERE id = ${runId}`;
        expect(row.status).toBe('receipt_queued');
        const jobs = await sql`SELECT id FROM chain_jobs WHERE payload->>'verifiedRunId' = ${runId}`;
        expect(jobs.length).toBe(1);

        // #then a second release is a no-op (no longer held)
        expect((await releaseHeldRun(runId)).released).toBe(false);
    });

    it('release refuses a run that was never held', async () => {
        expect((await releaseHeldRun(randomUUID())).released).toBe(false);
    });

    it('clearUserRiskState clears flagged -> none, exactly once', async () => {
        const wallet = `0x${randomUUID().replace(/-/g, '')}${'0'.repeat(8)}`.slice(0, 42);
        const identity = `677:${wallet}`;
        await sql`INSERT INTO users ${sql({ id: randomUUID(), chain_id: 677, wallet_address: wallet, risk_state: 'flagged' })}`;

        expect(await clearUserRiskState(identity)).toBe(true);
        const [user] = await sql<{ risk_state: string }[]>`SELECT risk_state FROM users WHERE wallet_address = ${wallet}`;
        expect(user.risk_state).toBe('none');
        // already clear — nothing to do
        expect(await clearUserRiskState(identity)).toBe(false);
    });
});
