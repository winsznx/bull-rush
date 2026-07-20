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
import { openGrid, issueTicket, consumeTicket, recordVerifiedRun, getVerifiedRunStatus, getGridLeaderboard, getGridGhost, gridHasReplayHash } from './grid.ts';
import { decodeInputsFlat, replayHash } from './sim/replay.ts';
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
            player: '0x1111111111111111111111111111111111111111' as `0x${string}`,
            gameVersion: GAME_VERSION,
            replayTicks: 600,
            replayInputsFlat: [10, 1, 30, 2, 55, 0],
            maxCombo: 0,
            deathCause: 'test',
            durationMs: 1000,
            suspicious: false,
            riskReasons: [],
            ipHint: null,
            replayLen: 10,
        };

        // distinct replay hashes per attempt — (grid_id, replay_hash) is UNIQUE
        // since migration 0007; two genuinely different runs never share one.
        const first = await recordVerifiedRun({ ...base, replayHash: `0x${'d1'.repeat(32)}` as `0x${string}`, distance: 500, score: 500 });
        expect(first.isPersonalBest).toBe(true);

        const worse = await recordVerifiedRun({ ...base, replayHash: `0x${'d2'.repeat(32)}` as `0x${string}`, distance: 300, score: 300 });
        expect(worse.isPersonalBest).toBe(false);

        const better = await recordVerifiedRun({ ...base, replayHash: `0x${'d3'.repeat(32)}` as `0x${string}`, distance: 800, score: 800 });
        expect(better.isPersonalBest).toBe(true);

        const board = await getGridLeaderboard(grid.id, 10);
        const entry = board.find((r) => r.identityKey === identity);
        expect(entry?.distance).toBe(800); // the worse run never overwrote the best
    });

    it('a personal best starts at receipt_queued and is pollable by its own identity only', async () => {
        const dayId = `test-${randomUUID()}`;
        const grid = await openGrid(dayId);
        await sql`UPDATE daily_grids SET opens_at = now() - interval '1 minute' WHERE id = ${grid.id}`;
        const identity = `player-${randomUUID()}`;
        const issued = await issueTicket(identity, grid.id);
        if (!('ticket' in issued)) throw new Error('unreachable');

        const { id, status } = await recordVerifiedRun({
            gridId: grid.id,
            ticketId: issued.ticket.id,
            identityKey: identity,
            player: '0x2222222222222222222222222222222222222222' as `0x${string}`,
            gameVersion: GAME_VERSION,
            replayTicks: 600,
            replayInputsFlat: [10, 1, 30, 2, 55, 0],
            replayHash: `0x${'ab'.repeat(32)}` as `0x${string}`,
            distance: 900,
            score: 900,
            maxCombo: 0,
            deathCause: 'test',
            durationMs: 1000,
            suspicious: false,
            riskReasons: [],
            ipHint: null,
            replayLen: 10,
        });
        // a fresh personal best is enqueued for an on-chain receipt immediately —
        // the relayer itself may not be running (CHAIN_RELAYER_ENABLED unset here),
        // so it rests at receipt_queued, not further along.
        expect(status).toBe('receipt_queued');

        const own = await getVerifiedRunStatus(id, identity);
        expect(own?.status).toBe('receipt_queued');
        expect(own?.isPersonalBest).toBe(true);
        expect(own?.receiptTxHash).toBeNull();

        // #then a different identity cannot read this run's status
        const stranger = await getVerifiedRunStatus(id, `player-${randomUUID()}`);
        expect(stranger).toBeNull();
    });

    it('a non-personal-best run has no receipt to track and rests at verified', async () => {
        const dayId = `test-${randomUUID()}`;
        const grid = await openGrid(dayId);
        await sql`UPDATE daily_grids SET opens_at = now() - interval '1 minute' WHERE id = ${grid.id}`;
        const identity = `player-${randomUUID()}`;
        // recordVerifiedRun doesn't consume the ticket itself (only the real
        // HTTP handler's separate consumeTicket() call does) — one issued ticket
        // is reused across both calls, matching the established pattern above.
        const issued = await issueTicket(identity, grid.id);
        if (!('ticket' in issued)) throw new Error('unreachable');
        await recordVerifiedRun({
            gridId: grid.id,
            ticketId: issued.ticket.id,
            identityKey: identity,
            player: '0x3333333333333333333333333333333333333333' as `0x${string}`,
            gameVersion: GAME_VERSION,
            replayTicks: 600,
            replayInputsFlat: [10, 1, 30, 2, 55, 0],
            replayHash: `0x${'11'.repeat(32)}` as `0x${string}`,
            distance: 900,
            score: 900,
            maxCombo: 0,
            deathCause: 'test',
            durationMs: 1000,
            suspicious: false,
            riskReasons: [],
            ipHint: null,
            replayLen: 10,
        });

        const { id, status } = await recordVerifiedRun({
            gridId: grid.id,
            ticketId: issued.ticket.id,
            identityKey: identity,
            player: '0x3333333333333333333333333333333333333333' as `0x${string}`,
            gameVersion: GAME_VERSION,
            replayTicks: 600,
            replayInputsFlat: [10, 1, 30, 2, 55, 0],
            replayHash: `0x${'22'.repeat(32)}` as `0x${string}`,
            distance: 400,
            score: 400,
            maxCombo: 0,
            deathCause: 'test',
            durationMs: 1000,
            suspicious: false,
            riskReasons: [],
            ipHint: null,
            replayLen: 10,
        });
        expect(status).toBe('verified');

        const view = await getVerifiedRunStatus(id, identity);
        expect(view?.status).toBe('verified');
        expect(view?.isPersonalBest).toBe(false);
    });

    it('serves the leader ghost with a replay whose recomputed hash matches the stored hash', async () => {
        // #given two identities with verified runs, one clearly leading
        const dayId = `test-${randomUUID()}`;
        const grid = await openGrid(dayId);
        await sql`UPDATE daily_grids SET opens_at = now() - interval '1 minute' WHERE id = ${grid.id}`;
        const leader = `player-${randomUUID()}`;
        const trailer = `player-${randomUUID()}`;

        const leaderInputsFlat = [25, 2, 44, 1, 63, 0, 82, 2];
        const leaderTicks = 1200;
        const leaderHash = replayHash({ inputs: decodeInputsFlat(leaderInputsFlat), ticks: leaderTicks });

        const base = {
            gridId: grid.id,
            gameVersion: GAME_VERSION,
            maxCombo: 0,
            deathCause: 'test',
            durationMs: 1000,
            suspicious: false,
            riskReasons: [],
            ipHint: null,
            replayLen: 4,
        };
        const lt = await issueTicket(leader, grid.id);
        if (!('ticket' in lt)) throw new Error('unreachable');
        await recordVerifiedRun({
            ...base,
            ticketId: lt.ticket.id,
            identityKey: leader,
            player: '0x4444444444444444444444444444444444444444' as `0x${string}`,
            replayHash: leaderHash,
            replayTicks: leaderTicks,
            replayInputsFlat: leaderInputsFlat,
            distance: 1500,
            score: 1500,
        });
        const tt = await issueTicket(trailer, grid.id);
        if (!('ticket' in tt)) throw new Error('unreachable');
        await recordVerifiedRun({
            ...base,
            ticketId: tt.ticket.id,
            identityKey: trailer,
            player: '0x5555555555555555555555555555555555555555' as `0x${string}`,
            replayHash: `0x${'77'.repeat(32)}` as `0x${string}`,
            replayTicks: 300,
            replayInputsFlat: [12, 1],
            distance: 200,
            score: 200,
        });

        // #when the ghost is fetched with no identity (leader mode)
        const ghost = await getGridGhost(grid.id);

        // #then it is the leader's run, and the served trace re-hashes to the stored hash
        expect(ghost).not.toBeNull();
        expect(ghost?.identityKey).toBe(leader);
        expect(ghost?.distance).toBe(1500);
        expect(ghost?.seed).toBe(grid.seed);
        expect(ghost?.inputs).toEqual(leaderInputsFlat);
        const recomputed = replayHash({ inputs: decodeInputsFlat(ghost?.inputs ?? []), ticks: ghost?.ticks ?? 0 });
        expect(recomputed).toBe(ghost?.replayHash);
        expect(ghost?.replayHash).toBe(leaderHash);

        // #then a specific identity can also be requested directly (self mode)
        const own = await getGridGhost(grid.id, trailer);
        expect(own?.identityKey).toBe(trailer);
        expect(own?.distance).toBe(200);
    });

    it('returns no ghost for a grid with no verified runs', async () => {
        const grid = await openGrid(`test-${randomUUID()}`);
        expect(await getGridGhost(grid.id)).toBeNull();
    });

    it('rejects a second run with the same replay hash on the same grid (anti-copy gate)', async () => {
        // #given a verified run whose (public, ghost-servable) replay is recorded
        const dayId = `test-${randomUUID()}`;
        const grid = await openGrid(dayId);
        await sql`UPDATE daily_grids SET opens_at = now() - interval '1 minute' WHERE id = ${grid.id}`;
        const original = `player-${randomUUID()}`;
        const copier = `player-${randomUUID()}`;
        const sharedHash = `0x${'c0'.repeat(32)}` as `0x${string}`;

        const base = {
            gridId: grid.id,
            gameVersion: GAME_VERSION,
            replayHash: sharedHash,
            replayTicks: 600,
            replayInputsFlat: [10, 1, 30, 2, 55, 0],
            distance: 900,
            score: 900,
            maxCombo: 0,
            deathCause: 'test',
            durationMs: 1000,
            suspicious: false,
            riskReasons: [],
            ipHint: null,
            replayLen: 10,
        };
        const ot = await issueTicket(original, grid.id);
        if (!('ticket' in ot)) throw new Error('unreachable');
        await recordVerifiedRun({
            ...base,
            ticketId: ot.ticket.id,
            identityKey: original,
            player: '0x6666666666666666666666666666666666666666' as `0x${string}`,
        });

        // #then the friendly pre-check sees the duplicate
        expect(await gridHasReplayHash(grid.id, sharedHash)).toBe(true);

        // #when a different identity re-submits the identical replay through its own ticket
        const ct = await issueTicket(copier, grid.id);
        if (!('ticket' in ct)) throw new Error('unreachable');
        // #then the unique index rejects it at the database level (the race-proof gate)
        await expect(
            recordVerifiedRun({
                ...base,
                ticketId: ct.ticket.id,
                identityKey: copier,
                player: '0x7777777777777777777777777777777777777777' as `0x${string}`,
            }),
        ).rejects.toMatchObject({ code: '23505' });

        // #then the copier never reached the leaderboard — the board still shows only the original
        const board = await getGridLeaderboard(grid.id, 10);
        expect(board.some((e) => e.identityKey === copier)).toBe(false);
        expect(board.some((e) => e.identityKey === original)).toBe(true);
    });
});
