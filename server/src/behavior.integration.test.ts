// Behavioral-signal persistence against real Postgres + Redis: risk reasons
// land on the row, repeat offenders escalate to users.risk_state, and
// shared-IP clusters surface in the review overview.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from './db.ts';
import { runMigrations } from './migrate.ts';
import { redis } from './redis.ts';
import { openGrid, issueTicket, consumeTicket, recordVerifiedRun, escalateRepeatOffender, getRiskOverview, getSimilarityCandidates } from './grid.ts';
import { assessRun, SIMILARITY_LEN_WINDOW, SIMILARITY_DISTANCE_WINDOW } from './behavior.ts';
import { decodeInputsFlat, encodeInputsFlat, type ReplayInput } from './sim/replay.ts';
import { GAME_VERSION } from './sim/ruleset.ts';

beforeAll(async () => {
    await runMigrations();
});

afterAll(async () => {
    await sql.end();
    redis.disconnect();
});

function humanLog(count: number, seedOffset = 0): ReplayInput[] {
    const gaps = [13, 27, 18, 34, 15, 22, 41, 17, 25, 19];
    const out: ReplayInput[] = [];
    let t = 25 + seedOffset;
    for (let i = 0; i < count; i++) {
        out.push({ tick: t, action: i % 4 === 0 ? 2 : i % 2 === 0 ? 0 : 1 });
        t += gaps[(i + seedOffset) % gaps.length];
    }
    return out;
}

async function openBackdatedGrid(): Promise<string> {
    const grid = await openGrid(`test-${randomUUID()}`);
    await sql`UPDATE daily_grids SET opens_at = now() - interval '1 minute' WHERE id = ${grid.id}`;
    return grid.id;
}

interface SeedOpts {
    suspicious?: boolean;
    riskReasons?: string[];
    ipHint?: string | null;
    inputs?: ReplayInput[];
    distance?: number;
}

async function seedRun(identityKey: string, gridId: string, opts: SeedOpts = {}): Promise<void> {
    const issued = await issueTicket(identityKey, gridId);
    if (!('ticket' in issued)) throw new Error('unreachable');
    // Consume like the real submit handler does — releases the per-identity
    // active-ticket lock so one identity can run across multiple grids here.
    await consumeTicket(issued.ticket.id);
    const inputs = opts.inputs ?? humanLog(50);
    await recordVerifiedRun({
        gridId,
        ticketId: issued.ticket.id,
        identityKey,
        player: '0x9999999999999999999999999999999999999999',
        gameVersion: GAME_VERSION,
        replayHash: `0x${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}` as `0x${string}`,
        replayTicks: 2000,
        replayInputsFlat: encodeInputsFlat(inputs),
        distance: opts.distance ?? 500,
        score: opts.distance ?? 500,
        maxCombo: 0,
        deathCause: 'test',
        durationMs: 30_000,
        suspicious: opts.suspicious ?? false,
        riskReasons: opts.riskReasons ?? [],
        ipHint: opts.ipHint ?? null,
        replayLen: inputs.length,
    });
}

describe('behavioral risk persistence (real Postgres + Redis)', () => {
    it('a jittered copy of a stored replay is caught via the candidates query + assessRun', async () => {
        // #given a victim's verified replay stored on the grid
        const gridId = await openBackdatedGrid();
        const victim = `player-${randomUUID()}`;
        const original = humanLog(80);
        await seedRun(victim, gridId, { inputs: original, distance: 700 });

        // #when a copier perturbs every tick by ±2 and submits at a similar outcome
        const jittered = original.map((ev, i) => ({ tick: ev.tick + ((i % 5) - 2), action: ev.action }));
        const candidates = (await getSimilarityCandidates(gridId, 690, jittered.length, SIMILARITY_LEN_WINDOW, SIMILARITY_DISTANCE_WINDOW)).map(
            (cand) => ({ identityKey: cand.identityKey, inputs: decodeInputsFlat(cand.replay.inputs) }),
        );
        // #then the stored replay is found as a candidate and flagged near-duplicate
        expect(candidates.some((cand) => cand.identityKey === victim)).toBe(true);
        const assessment = assessRun({ inputs: jittered, endTick: 2000, durationMs: 30_000, candidates });
        expect(assessment.suspicious).toBe(true);
        expect(assessment.reasons).toContain('near_duplicate_replay');
    });

    it('risk reasons persist on the row and surface in the review overview', async () => {
        const gridId = await openBackdatedGrid();
        const identity = `player-${randomUUID()}`;
        await seedRun(identity, gridId, { suspicious: true, riskReasons: ['bot_like_cadence', 'too_fast'] });

        const overview = await getRiskOverview(100);
        const row = overview.heldRuns.find((r) => r.identityKey === identity);
        expect(row).toBeDefined();
        expect(row?.riskReasons).toEqual(['bot_like_cadence', 'too_fast']);
    });

    it('escalates a repeat offender to users.risk_state = flagged after 3 holds in the window', async () => {
        // #given a real user whose runs keep getting held
        const wallet = `0x${randomUUID().replace(/-/g, '')}${'0'.repeat(8)}`.slice(0, 42);
        const identity = `677:${wallet}`;
        await sql`INSERT INTO users ${sql({ id: randomUUID(), chain_id: 677, wallet_address: wallet })}`;

        for (let i = 0; i < 3; i++) {
            const gridId = await openBackdatedGrid();
            await seedRun(identity, gridId, { suspicious: true, riskReasons: ['bot_like_cadence'] });
        }

        // #when escalation runs after the third hold
        expect(await escalateRepeatOffender(identity)).toBe(true);
        const [user] = await sql<{ risk_state: string }[]>`SELECT risk_state FROM users WHERE wallet_address = ${wallet}`;
        expect(user.risk_state).toBe('flagged');

        // #then two holds would NOT have been enough (fresh identity)
        const wallet2 = `0x${randomUUID().replace(/-/g, '')}${'0'.repeat(8)}`.slice(0, 42);
        const identity2 = `677:${wallet2}`;
        await sql`INSERT INTO users ${sql({ id: randomUUID(), chain_id: 677, wallet_address: wallet2 })}`;
        for (let i = 0; i < 2; i++) {
            const gridId = await openBackdatedGrid();
            await seedRun(identity2, gridId, { suspicious: true, riskReasons: ['too_fast'] });
        }
        expect(await escalateRepeatOffender(identity2)).toBe(false);
        const [user2] = await sql<{ risk_state: string }[]>`SELECT risk_state FROM users WHERE wallet_address = ${wallet2}`;
        expect(user2.risk_state).toBe('none');
    });

    it('surfaces wallets sharing a network origin on one grid as a review cluster', async () => {
        // #given two identities submitting from the same hashed network origin
        const gridId = await openBackdatedGrid();
        const hint = randomUUID().slice(0, 16);
        const a = `player-${randomUUID()}`;
        const b = `player-${randomUUID()}`;
        await seedRun(a, gridId, { ipHint: hint });
        await seedRun(b, gridId, { ipHint: hint });

        // #then the cluster appears with both identities — as information for
        // review, not as any automatic hold on either run
        const overview = await getRiskOverview(100);
        const cluster = overview.sharedIpClusters.find((cl) => cl.gridId === gridId && cl.ipHint === hint);
        expect(cluster).toBeDefined();
        expect(cluster?.identities.sort()).toEqual([a, b].sort());
    });
});
