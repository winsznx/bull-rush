// Integration tests against a REAL local Postgres + Redis (docker-compose up),
// not mocks — the properties under test (UNIQUE day_id preventing a reroll,
// atomic ticket consumption, Redis-locked one-active-ticket-per-identity) are
// database/cache semantics that a mock would only prove against itself, not
// against Postgres/Redis's actual guarantees.
//
// Requires: `npm run local:db` (or docker compose up) running first. Connection
// env defaults are set in server/vitest.setup.ts (a vitest `setupFiles` entry,
// so they land before this file's imports read process.env at module load time).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from './db.ts';
import { runMigrations } from './migrate.ts';
import { redis } from './redis.ts';
import { openGrid, issueTicket, consumeTicket, recordVerifiedRun, getGridLeaderboard } from './grid.ts';
import { GAME_VERSION } from './sim/ruleset.ts';

beforeAll(async () => {
    await runMigrations();
});

afterAll(async () => {
    await sql.end();
    redis.disconnect();
});

describe('Daily Grid lifecycle (real Postgres + Redis)', () => {
    it('opening the same day twice is idempotent — never rerolls the seed', async () => {
        // #given a unique test day id
        const dayId = `test-${randomUUID()}`;
        // #when opened twice
        const a = await openGrid(dayId);
        const b = await openGrid(dayId);
        // #then both calls return the identical grid id and seed
        expect(b.id).toBe(a.id);
        expect(b.seed).toBe(a.seed);
    });

    it('rejects a ticket request before the grid has opened for tickets', async () => {
        // #given a freshly-opened grid (inspection delay has not elapsed)
        const grid = await openGrid(`test-${randomUUID()}`);
        // #when a ticket is requested immediately
        const result = await issueTicket(`player-${randomUUID()}`, grid.id);
        // #then it is rejected as not yet open
        expect(result).toEqual({ rejected: 'grid_not_open_yet' });
    });

    it('rejects a ticket request for an unknown grid', async () => {
        const result = await issueTicket(`player-${randomUUID()}`, randomUUID());
        expect(result).toEqual({ rejected: 'grid_not_found' });
    });

    it('enforces one active ticket per identity, and releases the lock on consumption', async () => {
        // #given a grid manually back-dated to already be open (bypassing the
        // inspection delay for this test only, by writing opens_at directly)
        const dayId = `test-${randomUUID()}`;
        const grid = await openGrid(dayId);
        await sql`UPDATE daily_grids SET opens_at = now() - interval '1 minute' WHERE id = ${grid.id}`;
        const identity = `player-${randomUUID()}`;

        // #when a first ticket is issued, then a second is requested before
        // the first is consumed
        const first = await issueTicket(identity, grid.id);
        const second = await issueTicket(identity, grid.id);
        // #then the second is rejected — only one active run at a time
        expect('ticket' in first).toBe(true);
        expect(second).toEqual({ rejected: 'active_ticket_exists' });

        // #when the first ticket is consumed
        if (!('ticket' in first)) throw new Error('unreachable');
        const consumed = await consumeTicket(first.ticket.id);
        expect(consumed?.id).toBe(first.ticket.id);

        // #then a new ticket can now be issued for the same identity
        const third = await issueTicket(identity, grid.id);
        expect('ticket' in third).toBe(true);
    });

    it('a ticket cannot be consumed twice', async () => {
        const dayId = `test-${randomUUID()}`;
        const grid = await openGrid(dayId);
        await sql`UPDATE daily_grids SET opens_at = now() - interval '1 minute' WHERE id = ${grid.id}`;
        const issued = await issueTicket(`player-${randomUUID()}`, grid.id);
        if (!('ticket' in issued)) throw new Error('unreachable');

        const first = await consumeTicket(issued.ticket.id);
        const second = await consumeTicket(issued.ticket.id);
        expect(first).not.toBeNull();
        expect(second).toBeNull();
    });

    it('only an improved personal best updates the grid leaderboard', async () => {
        const dayId = `test-${randomUUID()}`;
        const grid = await openGrid(dayId);
        await sql`UPDATE daily_grids SET opens_at = now() - interval '1 minute' WHERE id = ${grid.id}`;
        const identity = `player-${randomUUID()}`;
        // verified_runs.ticket_id has a real FK to run_tickets — a run must
        // reference an actual issued ticket, same as the live endpoint flow.
        const issued = await issueTicket(identity, grid.id);
        if (!('ticket' in issued)) throw new Error('unreachable');
        const base = {
            gridId: grid.id,
            ticketId: issued.ticket.id,
            identityKey: identity,
            gameVersion: GAME_VERSION,
            replayHash: '0xdeadbeef' as `0x${string}`,
            maxCombo: 0,
            deathCause: 'test',
            durationMs: 1000,
            suspicious: false,
            replayLen: 10,
        };

        const first = await recordVerifiedRun({ ...base, distance: 500, score: 500 });
        expect(first.isPersonalBest).toBe(true);

        const worse = await recordVerifiedRun({ ...base, distance: 300, score: 300 });
        expect(worse.isPersonalBest).toBe(false);

        const better = await recordVerifiedRun({ ...base, distance: 800, score: 800 });
        expect(better.isPersonalBest).toBe(true);

        const board = await getGridLeaderboard(grid.id, 10);
        const entry = board.find((r) => r.identityKey === identity);
        expect(entry?.distance).toBe(800); // the worse run never overwrote the best
    });
});
