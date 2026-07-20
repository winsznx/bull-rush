// Daily Grid lifecycle: open a grid, issue/consume run tickets, record verified
// grid runs. Postgres is the durable record; Redis provides the atomic
// one-active-ticket-per-identity lock (the same "Redis-first, Postgres-durable"
// pattern already used for the one-time run-start token).
//
// `identity_key` is today's sanitized display name — an explicit, temporary
// stand-in for what Phase 4 (wallet + SIWE) will replace with a real
// wallet-derived user key. See server/src/db.ts's schema comment.
import { randomUUID } from 'node:crypto';
import type { Address } from 'viem';
import { sql } from './db.ts';
import { redis } from './redis.ts';
import { dayIdFor, deriveGridSeed, gridWindowFor } from './sim/grid.ts';
import { REPLAY_SCHEMA_VERSION } from './sim/replay.ts';
import { GAME_VERSION, RULESET_HASH } from './sim/ruleset.ts';
import { canTransitionTicket, type VerifiedRunStatus } from './stateMachines.ts';
import { enqueueChainJob } from './chain/outbox.ts';
import { toOnChainGridId, toOnChainRunId } from './chain/onchainIds.ts';

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

    // Idempotent regardless of whether the row above was freshly inserted or already
    // existed — enqueueChainJob's own idempotency_key uniqueness makes a repeat call
    // harmless, so the indexing_state transition only fires the one time it actually
    // enqueues (a guarded off_chain -> queued UPDATE, never regressing an already
    // queued/submitted/confirmed grid).
    const { enqueued } = await enqueueChainJob('open_grid', `open_grid:${dayId}`, {
        dayId,
        onChainGridId: toOnChainGridId(dayId),
        seed: row.seed,
        rulesetHash: row.ruleset_hash,
        gameVersion: row.game_version,
        opensAt: Math.floor(row.opens_at.getTime() / 1000),
        closesAt: Math.floor(row.closes_at.getTime() / 1000),
    });
    if (enqueued) {
        await sql`UPDATE daily_grids SET indexing_state = 'queued' WHERE day_id = ${dayId} AND indexing_state = 'off_chain'`;
    }

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
// concurrent caller can move a ticket from 'issued' to 'consumed'. The WHERE
// clause IS the state-machine check at the database level; canTransitionTicket
// is asserted too so a future edit that adds a status this doesn't expect
// fails loudly in tests rather than silently allowing an illegal transition.
export async function consumeTicket(ticketId: string): Promise<TicketRow | null> {
    if (!canTransitionTicket('issued', 'consumed')) throw new Error('illegal ticket transition: issued -> consumed');
    const [row] = await sql<TicketRow[]>`
        UPDATE run_tickets SET status = 'consumed', consumed_at = now()
        WHERE id = ${ticketId} AND status = 'issued' AND expires_at > now()
        RETURNING id, grid_id, identity_key, seed, game_version, ruleset_hash, expires_at
    `;
    if (row) await redis.del(activeLockKey(row.identity_key));
    return row ?? null;
}

// Sweeps tickets whose expiry has passed while they were still sitting at
// 'issued' (nobody ever consumed them) into the explicit 'expired' state, so
// `status` reflects reality instead of silently going stale. No scheduler
// exists yet (Phase 6's contract-driven scheduling is the eventual real one);
// exposed as an admin-triggered endpoint in the interim — see index.ts.
export async function sweepExpiredTickets(): Promise<number> {
    if (!canTransitionTicket('issued', 'expired')) throw new Error('illegal ticket transition: issued -> expired');
    const rows = await sql`
        UPDATE run_tickets SET status = 'expired'
        WHERE status = 'issued' AND expires_at <= now()
        RETURNING id
    `;
    return rows.length;
}

export const LB_GRID = (gridId: string): string => `lb:grid:${gridId}`;

export interface RecordVerifiedRunParams {
    gridId: string;
    ticketId: string;
    identityKey: string;
    player: Address;
    gameVersion: string;
    replayHash: `0x${string}`;
    // The canonical trace itself (flat [tick, action, ...] encoding + tick count),
    // persisted so ghosts can be served from it and any run re-verified later.
    replayTicks: number;
    replayInputsFlat: number[];
    distance: number;
    score: number;
    maxCombo: number;
    deathCause: string;
    durationMs: number;
    suspicious: boolean;
    riskReasons: string[];
    ipHint: string | null;
    replayLen: number;
}

// Every verified attempt is recorded (history); only an improvement over the
// identity's existing best on THIS grid updates the grid's leaderboard — a
// worse run never overwrites a better one, and never needs to. `status` is set
// directly to its resting state (`verified` or `risk_hold`) — this codebase
// verifies synchronously in one request, so `received`/`verifying` are never
// actually persisted, only legal per the state machine (server/src/stateMachines.ts).
// Only a personal best is queued for an on-chain receipt (`receipt_queued`) — a
// worse run has nothing new to attest to (the leaderboard already reflects the
// better one) and isn't worth the relayer's gas.
export interface RecordVerifiedRunResult {
    id: string;
    isPersonalBest: boolean;
    status: VerifiedRunStatus;
}

export async function recordVerifiedRun(p: RecordVerifiedRunParams): Promise<RecordVerifiedRunResult> {
    const id = randomUUID();
    let isPersonalBest = false;

    if (!p.suspicious) {
        const prevBest = await redis.zscore(LB_GRID(p.gridId), p.identityKey);
        isPersonalBest = prevBest === null || p.distance > Number(prevBest);
    }

    // INSERT before the Redis leaderboard write: the (grid_id, replay_hash) unique
    // index is the atomic anti-copy gate (migration 0007), and it must reject a
    // duplicate BEFORE anything touches the leaderboard — otherwise a racing
    // copied replay could land on the board and only then fail to persist.
    await sql`
        INSERT INTO verified_runs (
            id, grid_id, ticket_id, identity_key, game_version, replay_hash, replay,
            distance, score, max_combo, death_cause, duration_ms, is_personal_best, replay_len, status,
            risk_reasons, ip_hint
        ) VALUES (
            ${id}, ${p.gridId}, ${p.ticketId}, ${p.identityKey}, ${p.gameVersion}, ${p.replayHash},
            ${sql.json({ v: REPLAY_SCHEMA_VERSION, ticks: p.replayTicks, inputs: p.replayInputsFlat })},
            ${p.distance}, ${p.score}, ${p.maxCombo}, ${p.deathCause}, ${p.durationMs},
            ${isPersonalBest}, ${p.replayLen}, ${p.suspicious ? 'risk_hold' : 'verified'},
            ${p.riskReasons}, ${p.ipHint}
        )
    `;

    // ZADD GT: only a strictly greater distance ever wins, so a stale
    // isPersonalBest read above can never regress the board under concurrency.
    if (isPersonalBest) await redis.zadd(LB_GRID(p.gridId), 'GT', p.distance, p.identityKey);

    let status: VerifiedRunStatus = p.suspicious ? 'risk_hold' : 'verified';

    if (isPersonalBest) {
        const [grid] = await sql<{ day_id: string }[]>`SELECT day_id FROM daily_grids WHERE id = ${p.gridId}`;
        const onChainGridId = toOnChainGridId(grid.day_id);
        const runId = toOnChainRunId(onChainGridId, p.player, p.replayHash);

        const { enqueued } = await enqueueChainJob('record_run', `record_run:${runId}`, {
            verifiedRunId: id,
            runId,
            onChainGridId,
            player: p.player,
            replayHash: p.replayHash,
            distance: p.distance,
            score: p.score,
            gameVersion: p.gameVersion,
        });
        if (enqueued) {
            await sql`UPDATE verified_runs SET status = 'receipt_queued' WHERE id = ${id} AND status = 'verified'`;
            status = 'receipt_queued';
        }
    }

    return { id, isPersonalBest, status };
}

export interface VerifiedRunStatusView {
    status: VerifiedRunStatus;
    receiptTxHash: string | null;
    isPersonalBest: boolean;
}

// Ownership-checked: a player can only poll their own run's on-chain receipt
// progress, not enumerate anyone else's by id.
export async function getVerifiedRunStatus(runId: string, identityKey: string): Promise<VerifiedRunStatusView | null> {
    const [row] = await sql<{ status: VerifiedRunStatus; receipt_tx_hash: string | null; is_personal_best: boolean }[]>`
        SELECT status, receipt_tx_hash, is_personal_best FROM verified_runs
        WHERE id = ${runId} AND identity_key = ${identityKey}
    `;
    if (!row) return null;
    return { status: row.status, receiptTxHash: row.receipt_tx_hash, isPersonalBest: row.is_personal_best };
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

// Friendly-path pre-check for the submit handler; the (grid_id, replay_hash)
// unique index (migration 0007) remains the atomic gate under a true race.
export async function gridHasReplayHash(gridId: string, replayHash: `0x${string}`): Promise<boolean> {
    const rows = await sql`SELECT 1 FROM verified_runs WHERE grid_id = ${gridId} AND replay_hash = ${replayHash} LIMIT 1`;
    return rows.length > 0;
}

export interface GhostView {
    identityKey: string;
    distance: number;
    score: number;
    replayHash: `0x${string}`;
    gameVersion: string;
    seed: `0x${string}`;
    ticks: number;
    inputs: number[]; // flat [tick, action, ...] encoding (src/sim/replay.ts)
}

// The best non-risk-hold run for an identity on this grid, replay included — what
// a client re-simulates locally to race against. `identityKey` omitted = the
// current leaderboard leader. Serving the replay is deliberate and public: racing
// a ghost means downloading its input log, and the anti-copy protection is the
// per-grid replay-hash uniqueness at submit time, not secrecy of the trace.
export async function getGridGhost(gridId: string, identityKey?: string): Promise<GhostView | null> {
    let key = identityKey ?? null;
    if (!key) {
        const [top] = await getGridLeaderboard(gridId, 1);
        if (!top) return null;
        key = top.identityKey;
    }
    const [row] = await sql<
        { identity_key: string; distance: number; score: number; replay_hash: string; game_version: string; replay: { v: number; ticks: number; inputs: number[] } | null; seed: string }[]
    >`
        SELECT vr.identity_key, vr.distance, vr.score, vr.replay_hash, vr.game_version, vr.replay, dg.seed
        FROM verified_runs vr
        JOIN daily_grids dg ON dg.id = vr.grid_id
        WHERE vr.grid_id = ${gridId} AND vr.identity_key = ${key}
          AND vr.status <> 'risk_hold' AND vr.replay IS NOT NULL
        ORDER BY vr.distance DESC
        LIMIT 1
    `;
    if (!row || !row.replay) return null;
    return {
        identityKey: row.identity_key,
        distance: row.distance,
        score: row.score,
        replayHash: row.replay_hash as `0x${string}`,
        gameVersion: row.game_version,
        seed: row.seed as `0x${string}`,
        ticks: row.replay.ticks,
        inputs: row.replay.inputs,
    };
}

// Candidate replays for near-duplicate comparison: only runs whose input count
// AND outcome land near the submission's (a perturbed copy necessarily does;
// honest unrelated runs rarely do) — keeps the O(n*m) LCS bounded to a handful
// of genuinely plausible sources. Includes risk_hold rows: a copy of a copy is
// still a copy.
export async function getSimilarityCandidates(
    gridId: string,
    distance: number,
    inputCount: number,
    lenWindow: number,
    distanceWindow: number,
): Promise<{ identityKey: string; replay: { ticks: number; inputs: number[] } }[]> {
    const minLen = Math.floor(inputCount * (1 - lenWindow));
    const maxLen = Math.ceil(inputCount * (1 + lenWindow));
    const minDist = Math.floor(distance * (1 - distanceWindow));
    const maxDist = Math.ceil(distance * (1 + distanceWindow));
    const rows = await sql<{ identity_key: string; replay: { ticks: number; inputs: number[] } }[]>`
        SELECT identity_key, replay FROM verified_runs
        WHERE grid_id = ${gridId} AND replay IS NOT NULL
          AND replay_len BETWEEN ${minLen} AND ${maxLen}
          AND distance BETWEEN ${minDist} AND ${maxDist}
        ORDER BY created_at DESC
        LIMIT 25
    `;
    return rows.map((r) => ({ identityKey: r.identity_key, replay: r.replay }));
}

const REPEAT_OFFENDER_WINDOW_DAYS = 7;
const REPEAT_OFFENDER_THRESHOLD = 3;

// A user whose runs keep landing in risk_hold gets marked for review — a
// marker, not a punishment: nothing automated changes for a 'flagged' user
// (Phase 12's review process decides). Idempotent, monotonic (never un-flags).
export async function escalateRepeatOffender(identityKey: string): Promise<boolean> {
    const [{ count }] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM verified_runs
        WHERE identity_key = ${identityKey} AND status = 'risk_hold'
          AND created_at > now() - make_interval(days => ${REPEAT_OFFENDER_WINDOW_DAYS})
    `;
    if (count < REPEAT_OFFENDER_THRESHOLD) return false;
    const [chainIdStr, wallet] = identityKey.split(':');
    await sql`
        UPDATE users SET risk_state = 'flagged'
        WHERE chain_id = ${Number(chainIdStr)} AND wallet_address = ${wallet} AND risk_state = 'none'
    `;
    return true;
}

export interface RiskOverview {
    heldRuns: { id: string; gridId: string; identityKey: string; distance: number; riskReasons: string[]; createdAt: number }[];
    flaggedUsers: { identityKey: string; heldCount: number }[];
    sharedIpClusters: { gridId: string; ipHint: string; identities: string[] }[];
}

// Read-only review surface for Phase 12: what is held and why, who keeps
// getting held, and which wallets share a network origin on the same grid.
export async function getRiskOverview(limit: number): Promise<RiskOverview> {
    const held = await sql<{ id: string; grid_id: string; identity_key: string; distance: number; risk_reasons: string[]; created_at: Date }[]>`
        SELECT id, grid_id, identity_key, distance, risk_reasons, created_at
        FROM verified_runs WHERE status = 'risk_hold'
        ORDER BY created_at DESC LIMIT ${limit}
    `;
    const flagged = await sql<{ identity_key: string; held_count: number }[]>`
        SELECT vr.identity_key, count(*)::int AS held_count
        FROM verified_runs vr
        JOIN users u ON u.chain_id::text = split_part(vr.identity_key, ':', 1) AND u.wallet_address = split_part(vr.identity_key, ':', 2)
        WHERE u.risk_state = 'flagged' AND vr.status = 'risk_hold'
        GROUP BY vr.identity_key
    `;
    const clusters = await sql<{ grid_id: string; ip_hint: string; identities: string[] }[]>`
        SELECT grid_id, ip_hint, array_agg(DISTINCT identity_key) AS identities
        FROM verified_runs
        WHERE ip_hint IS NOT NULL
        GROUP BY grid_id, ip_hint
        HAVING count(DISTINCT identity_key) >= 2
        ORDER BY count(DISTINCT identity_key) DESC
        LIMIT ${limit}
    `;
    return {
        heldRuns: held.map((r) => ({
            id: r.id,
            gridId: r.grid_id,
            identityKey: r.identity_key,
            distance: r.distance,
            riskReasons: r.risk_reasons,
            createdAt: r.created_at.getTime(),
        })),
        flaggedUsers: flagged.map((r) => ({ identityKey: r.identity_key, heldCount: r.held_count })),
        sharedIpClusters: clusters.map((r) => ({ gridId: r.grid_id, ipHint: r.ip_hint, identities: r.identities })),
    };
}
