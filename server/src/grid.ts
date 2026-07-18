// Daily Grid lifecycle: open a grid, issue/consume run tickets, record verified
// grid runs. Postgres is the durable record; Redis provides the atomic
// one-active-ticket-per-identity lock (the same "Redis-first, Postgres-durable"
// pattern already used for the one-time run-start token).
//
// `identity_key` is today's sanitized display name — an explicit, temporary
// stand-in for what Phase 4 (wallet + SIWE) will replace with a real
// wallet-derived user key. See server/src/db.ts's schema comment.
import { randomUUID } from 'node:crypto';
import { sql } from './db.ts';
import { redis } from './redis.ts';
import { dayIdFor, deriveGridSeed, gridWindowFor } from './sim/grid.ts';
import { GAME_VERSION, RULESET_HASH } from './sim/ruleset.ts';

const TICKET_TTL_SEC = 3600;

export interface GridPublicView {
    id: string;
    dayId: string;
    seed: `0x${string}`;
    gameVersion: string;
    rulesetHash: `0x${string}`;
    publishedAt: number;
    opensAt: number;
    closesAt: number;
    isOpenForTickets: boolean;
}

interface GridRow {
    id: string;
    day_id: string;
    seed: string;
    game_version: string;
    ruleset_hash: string;
    opens_at: Date;
    closes_at: Date;
    created_at: Date;
}

function toPublicView(row: GridRow): GridPublicView {
    const opensAt = row.opens_at.getTime();
    const closesAt = row.closes_at.getTime();
    const now = Date.now();
    return {
        id: row.id,
        dayId: row.day_id,
        seed: row.seed as `0x${string}`,
        gameVersion: row.game_version,
        rulesetHash: row.ruleset_hash as `0x${string}`,
        publishedAt: row.created_at.getTime(),
        opensAt,
        closesAt,
        isOpenForTickets: now >= opensAt && now < closesAt,
    };
}

// Idempotent: calling this for a day that already has a grid just returns the
// existing one — an operator cannot reroll a day's course by calling this
// again, because the seed is a pure function of the day (see sim/grid.ts) and
// the row is create-once (day_id is UNIQUE).
export async function openGrid(dayId: string = dayIdFor(new Date())): Promise<GridPublicView> {
    const seed = deriveGridSeed(dayId);
    const id = randomUUID();
    const now = new Date();
    const { opensAt, closesAt } = gridWindowFor(now.getTime());

    await sql`
        INSERT INTO daily_grids ${sql({
            id,
            day_id: dayId,
            seed,
            game_version: GAME_VERSION,
            ruleset_hash: RULESET_HASH,
            opens_at: new Date(opensAt),
            closes_at: new Date(closesAt),
        })}
        ON CONFLICT (day_id) DO NOTHING
    `;

    const [row] = await sql<GridRow[]>`SELECT * FROM daily_grids WHERE day_id = ${dayId}`;
    return toPublicView(row);
}

export async function getGridById(gridId: string): Promise<GridPublicView | null> {
    const [row] = await sql<GridRow[]>`SELECT * FROM daily_grids WHERE id = ${gridId}`;
    return row ? toPublicView(row) : null;
}

// The most recently published grid that hasn't closed yet.
export async function getCurrentGrid(): Promise<GridPublicView | null> {
    const [row] = await sql<GridRow[]>`
        SELECT * FROM daily_grids WHERE closes_at > now() ORDER BY created_at DESC LIMIT 1
    `;
    return row ? toPublicView(row) : null;
}

export type TicketRejection = 'grid_not_found' | 'grid_not_open_yet' | 'grid_closed' | 'active_ticket_exists';

export interface TicketView {
    id: string;
    gridId: string;
    seed: `0x${string}`;
    gameVersion: string;
    rulesetHash: `0x${string}`;
    expiresAt: number;
}

const activeLockKey = (identityKey: string): string => `grid:activelock:${identityKey}`;

// One active (unconsumed, unexpired) ticket per identity at a time, enforced
// atomically via Redis SET NX before anything is written to Postgres — closes
// the race two concurrent requests from the same identity would otherwise hit.
export async function issueTicket(
    identityKey: string,
    gridId: string,
): Promise<{ ticket: TicketView } | { rejected: TicketRejection }> {
    const grid = await getGridById(gridId);
    if (!grid) return { rejected: 'grid_not_found' };
    const now = Date.now();
    if (now < grid.opensAt) return { rejected: 'grid_not_open_yet' };
    if (now >= grid.closesAt) return { rejected: 'grid_closed' };

    const id = randomUUID();
    const ttlSec = Math.max(1, Math.min(TICKET_TTL_SEC, Math.floor((grid.closesAt - now) / 1000)));
    const locked = await redis.set(activeLockKey(identityKey), id, 'EX', ttlSec, 'NX');
    if (locked !== 'OK') return { rejected: 'active_ticket_exists' };

    const expiresAt = new Date(now + ttlSec * 1000);
    await sql`
        INSERT INTO run_tickets ${sql({
            id,
            grid_id: gridId,
            identity_key: identityKey,
            seed: grid.seed,
            game_version: grid.gameVersion,
            ruleset_hash: grid.rulesetHash,
            expires_at: expiresAt,
        })}
    `;

    return {
        ticket: { id, gridId, seed: grid.seed, gameVersion: grid.gameVersion, rulesetHash: grid.rulesetHash, expiresAt: expiresAt.getTime() },
    };
}

interface TicketRow {
    id: string;
    grid_id: string;
    identity_key: string;
    seed: string;
    game_version: string;
    ruleset_hash: string;
    expires_at: Date;
}

// Atomic compare-and-set via the WHERE clause — Postgres guarantees only one
// concurrent caller can move a ticket from 'issued' to 'consumed'.
export async function consumeTicket(ticketId: string): Promise<TicketRow | null> {
    const [row] = await sql<TicketRow[]>`
        UPDATE run_tickets SET status = 'consumed', consumed_at = now()
        WHERE id = ${ticketId} AND status = 'issued' AND expires_at > now()
        RETURNING id, grid_id, identity_key, seed, game_version, ruleset_hash, expires_at
    `;
    if (row) await redis.del(activeLockKey(row.identity_key));
    return row ?? null;
}

export const LB_GRID = (gridId: string): string => `lb:grid:${gridId}`;

export interface RecordGridRunParams {
    gridId: string;
    ticketId: string;
    identityKey: string;
    distance: number;
    score: number;
    maxCombo: number;
    deathCause: string;
    durationMs: number;
    suspicious: boolean;
    replayLen: number;
}

// Every verified attempt is recorded (history); only an improvement over the
// identity's existing best on THIS grid updates the grid's leaderboard — a
// worse run never overwrites a better one, and never needs to (there is no
// on-chain receipt yet for this to needlessly re-trigger; Phase 6/7 will gate
// receipt-queueing on this same `isPersonalBest` flag).
export async function recordGridRun(p: RecordGridRunParams): Promise<{ isPersonalBest: boolean }> {
    const id = randomUUID();
    let isPersonalBest = false;

    if (!p.suspicious) {
        const prevBest = await redis.zscore(LB_GRID(p.gridId), p.identityKey);
        isPersonalBest = prevBest === null || p.distance > Number(prevBest);
        if (isPersonalBest) await redis.zadd(LB_GRID(p.gridId), 'GT', p.distance, p.identityKey);
    }

    await sql`
        INSERT INTO grid_runs ${sql({
            id,
            grid_id: p.gridId,
            ticket_id: p.ticketId,
            identity_key: p.identityKey,
            distance: p.distance,
            score: p.score,
            max_combo: p.maxCombo,
            death_cause: p.deathCause,
            duration_ms: p.durationMs,
            suspicious: p.suspicious,
            is_personal_best: isPersonalBest,
            replay_len: p.replayLen,
        })}
    `;

    return { isPersonalBest };
}

export interface GridLbEntry {
    position: number;
    identityKey: string;
    distance: number;
}

export async function getGridLeaderboard(gridId: string, limit: number): Promise<GridLbEntry[]> {
    const flat = await redis.zrevrange(LB_GRID(gridId), 0, limit - 1, 'WITHSCORES');
    const out: GridLbEntry[] = [];
    for (let i = 0; i < flat.length; i += 2) out.push({ position: i / 2 + 1, identityKey: flat[i], distance: Number(flat[i + 1]) });
    return out;
}

export async function countVerifiedGridPlayers(gridId: string): Promise<number> {
    return redis.zcard(LB_GRID(gridId));
}
