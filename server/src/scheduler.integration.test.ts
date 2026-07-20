// Proves the "there is always a grid" guarantee against real Postgres + Redis —
// the property whose absence would silently leave players with "No grid is open".
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from './db.ts';
import { runMigrations } from './migrate.ts';
import { redis } from './redis.ts';
import { ensureTodaysGrid } from './scheduler.ts';
import { getCurrentGrid, issueTicket, openGrid, recordVerifiedRun } from './grid.ts';
import { dayIdFor } from './sim/grid.ts';
import { GAME_VERSION } from './sim/ruleset.ts';
import { randomUUID } from 'node:crypto';

beforeAll(async () => {
    await runMigrations();
});

afterAll(async () => {
    await sql.end();
    redis.disconnect();
});

describe('daily grid scheduler (real Postgres + Redis)', () => {
    it("creates today's grid when none exists, and getCurrentGrid then finds it", async () => {
        // #given today's grid removed (simulating a fresh day with nothing opened)
        const today = dayIdFor(new Date());
        await sql`DELETE FROM chain_jobs WHERE idempotency_key = ${`open_grid:${today}`}`;
        await sql`DELETE FROM daily_grids WHERE day_id = ${today}`;

        // #when the scheduler runs
        await ensureTodaysGrid();

        // #then a grid exists for today and is publicly discoverable
        const grid = await getCurrentGrid();
        expect(grid).not.toBeNull();
        expect(grid?.dayId).toBe(today);
    });

    it('is idempotent — repeated runs never reroll the seed or duplicate the grid', async () => {
        const today = dayIdFor(new Date());

        await ensureTodaysGrid();
        const first = await getCurrentGrid();

        // #when it runs several more times, as the hourly interval will
        await ensureTodaysGrid();
        await ensureTodaysGrid();
        const after = await getCurrentGrid();

        // #then it is the same grid, same seed — an operator (or a restart loop)
        // cannot reroll the day's course by re-running the scheduler
        expect(after?.id).toBe(first?.id);
        expect(after?.seed).toBe(first?.seed);

        const [{ count }] = await sql<{ count: number }[]>`
            SELECT count(*)::int AS count FROM daily_grids WHERE day_id = ${today}
        `;
        expect(count).toBe(1);
    });
});

// The cost property that motivated the receipt policy: in the default mode a
// day's on-chain spend must NOT grow with the number of players.
describe('receipt policy cost containment (real Postgres + Redis)', () => {
    it('default (off) mode enqueues no per-run chain jobs no matter how many players set a best', async () => {
        const prev = process.env.CHAIN_RECEIPT_MODE;
        delete process.env.CHAIN_RECEIPT_MODE; // default = off

        const dayId = `test-cost-${randomUUID()}`;
        const grid = await openGrid(dayId);
        await sql`UPDATE daily_grids SET opens_at = now() - interval '1 minute' WHERE id = ${grid.id}`;

        const before = await countRecordRunJobs();

        // #when several distinct players each set a personal best
        // Unique per run: issueTicket holds a Redis one-active-ticket lock keyed
        // on identity (1h TTL), so reusing fixed identities across runs would
        // fail with active_ticket_exists rather than testing what we mean to.
        const runTag = randomUUID().replace(/-/g, '').slice(0, 8);
        for (let i = 0; i < 5; i++) {
            const wallet = `0x${runTag}${String(i).repeat(32)}`.slice(0, 42);
            const identity = `677:${wallet}`;
            const issued = await issueTicket(identity, grid.id);
            if (!('ticket' in issued)) throw new Error('unreachable');
            await recordVerifiedRun({
                gridId: grid.id,
                ticketId: issued.ticket.id,
                identityKey: identity,
                player: wallet as `0x${string}`,
                gameVersion: GAME_VERSION,
                replayHash: `0x${runTag}${String(i).repeat(64)}`.slice(0, 66) as `0x${string}`,
                distance: 100 + i,
                score: 100 + i,
                maxCombo: 0,
                deathCause: 'test',
                durationMs: 5000,
                suspicious: false,
                replayLen: 10,
                replayTicks: 100,
                replayInputsFlat: [],
                riskReasons: [],
                ipHint: null,
            });
        }

        // #then not a single on-chain job was created — cost is flat in players
        expect(await countRecordRunJobs()).toBe(before);

        if (prev !== undefined) process.env.CHAIN_RECEIPT_MODE = prev;
    });
});

async function countRecordRunJobs(): Promise<number> {
    const [{ count }] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM chain_jobs WHERE job_type = 'record_run'
    `;
    return count;
}
