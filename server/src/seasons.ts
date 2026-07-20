// Season lifecycle against the database: create/close a season, persist claims,
// rebuild proofs on demand. All entitlement MATH lives in rewards.ts (pure,
// DB-free, unit-tested); this module is the durable-record side of it.
import { randomUUID } from 'node:crypto';
import type { Address } from 'viem';
import { sql } from './db.ts';
import { buildSeasonTree, computeSeasonEntitlements, type Entitlement, type GridStanding } from './rewards.ts';

export interface SeasonRow {
    id: string;
    name: string;
    asset: string;
    cap_wei: string;
    starts_at: Date;
    ends_at: Date;
    claim_window_end: Date | null;
    merkle_root: string | null;
    status: 'draft' | 'closed';
    created_at: Date;
    closed_at: Date | null;
}

export async function createSeason(p: {
    id: string;
    name: string;
    asset: string;
    capWei: bigint;
    startsAt: Date;
    endsAt: Date;
    claimWindowEnd?: Date;
}): Promise<SeasonRow> {
    const [row] = await sql<SeasonRow[]>`
        INSERT INTO seasons ${sql({
            id: p.id,
            name: p.name,
            asset: p.asset,
            cap_wei: p.capWei.toString(),
            starts_at: p.startsAt,
            ends_at: p.endsAt,
            claim_window_end: p.claimWindowEnd ?? null,
        })}
        RETURNING *
    `;
    return row;
}

export async function getSeason(id: string): Promise<SeasonRow | null> {
    const [row] = await sql<SeasonRow[]>`SELECT * FROM seasons WHERE id = ${id}`;
    return row ?? null;
}

export async function getLatestSeason(): Promise<SeasonRow | null> {
    const [row] = await sql<SeasonRow[]>`SELECT * FROM seasons ORDER BY created_at DESC LIMIT 1`;
    return row ?? null;
}

// Final standings for one grid, from the durable record: best non-risk_hold
// distance per identity. Ties break by identityKey ascending so the standings
// (and therefore points, entitlements, and the tree root) are fully
// deterministic — a payout computation must never depend on row order luck.
async function gridStandings(gridId: string): Promise<GridStanding[]> {
    const rows = await sql<{ identity_key: string; best: number }[]>`
        SELECT identity_key, max(distance)::int AS best
        FROM verified_runs
        WHERE grid_id = ${gridId} AND status <> 'risk_hold'
        GROUP BY identity_key
        ORDER BY best DESC, identity_key ASC
    `;
    return rows.map((r) => ({ identityKey: r.identity_key, bestDistance: r.best }));
}

export type CloseSeasonRejection = 'season_not_found' | 'season_not_draft' | 'season_window_still_open' | 'no_eligible_runs';

export interface CloseSeasonResult {
    root: `0x${string}`;
    claimCount: number;
    totalAllocatedWei: bigint;
}

// Closes a season: computes entitlements from every grid opened inside the
// window, builds the Merkle tree, and writes the root + eligible claim rows in
// one transaction. Close-once is atomic (UPDATE ... WHERE status = 'draft').
export async function closeSeason(seasonId: string): Promise<CloseSeasonResult | { rejected: CloseSeasonRejection }> {
    const season = await getSeason(seasonId);
    if (!season) return { rejected: 'season_not_found' };
    if (season.status !== 'draft') return { rejected: 'season_not_draft' };
    if (Date.now() < season.ends_at.getTime()) return { rejected: 'season_window_still_open' };

    const grids = await sql<{ id: string }[]>`
        SELECT id FROM daily_grids WHERE created_at >= ${season.starts_at} AND created_at < ${season.ends_at}
    `;
    const boards: GridStanding[][] = [];
    for (const g of grids) boards.push(await gridStandings(g.id));

    const entitlements = computeSeasonEntitlements(boards, BigInt(season.cap_wei));
    if (entitlements.length === 0) return { rejected: 'no_eligible_runs' };

    // Resolve each identity to its user row + wallet (the Merkle leaf account).
    const resolved: { userId: string; account: Address; entitlement: Entitlement }[] = [];
    for (const e of entitlements) {
        const [chainIdStr, wallet] = e.identityKey.split(':');
        const [user] = await sql<{ id: string; wallet_address: string }[]>`
            SELECT id, wallet_address FROM users WHERE chain_id = ${Number(chainIdStr)} AND wallet_address = ${wallet}
        `;
        // Every grid run required a session, so this cannot miss; a miss here
        // means data corruption and must fail the close loudly, not skip a payout.
        if (!user) throw new Error(`no user for identity ${e.identityKey}`);
        resolved.push({ userId: user.id, account: user.wallet_address as Address, entitlement: e });
    }
    resolved.sort((a, b) => (a.account.toLowerCase() < b.account.toLowerCase() ? -1 : 1));

    const { root } = buildSeasonTree(resolved.map((r) => ({ account: r.account, amountWei: r.entitlement.amountWei })));
    const totalAllocatedWei = resolved.reduce((sum, r) => sum + r.entitlement.amountWei, 0n);

    const closed = await sql.begin(async (tx) => {
        const updated = await tx`
            UPDATE seasons SET merkle_root = ${root}, status = 'closed', closed_at = now()
            WHERE id = ${seasonId} AND status = 'draft'
            RETURNING id
        `;
        if (updated.length === 0) return false;
        for (let i = 0; i < resolved.length; i++) {
            const r = resolved[i];
            await tx`
                INSERT INTO claims ${tx({
                    id: randomUUID(),
                    user_id: r.userId,
                    season_id: seasonId,
                    asset: season.asset,
                    amount: r.entitlement.amountWei.toString(),
                    merkle_index: i,
                })}
            `;
        }
        return true;
    });
    if (!closed) return { rejected: 'season_not_draft' };

    return { root, claimCount: resolved.length, totalAllocatedWei };
}

interface SeasonLeafRow {
    user_id: string;
    merkle_index: number;
    amount: string;
    wallet_address: string;
}

// The season's full ordered leaf set — claims rows joined to wallets. This IS
// the tree; proofs are rebuilt from it on demand.
async function seasonLeaves(seasonId: string): Promise<SeasonLeafRow[]> {
    return sql<SeasonLeafRow[]>`
        SELECT c.user_id, c.merkle_index, c.amount, u.wallet_address
        FROM claims c JOIN users u ON u.id = c.user_id
        WHERE c.season_id = ${seasonId}
        ORDER BY c.merkle_index ASC
    `;
}

export interface RewardView {
    seasonId: string;
    seasonName: string;
    asset: string;
    amountWei: string;
    merkleIndex: number;
    merkleRoot: string;
    proof: `0x${string}`[];
    status: string;
    claimTransaction: string | null;
    claimWindowEnd: number | null;
}

export async function getRewardsForUser(userId: string): Promise<RewardView[]> {
    const rows = await sql<{ season_id: string; merkle_index: number; amount: string; asset: string; status: string; claim_transaction: string | null }[]>`
        SELECT season_id, merkle_index, amount, asset, status, claim_transaction
        FROM claims WHERE user_id = ${userId} ORDER BY created_at DESC
    `;
    const out: RewardView[] = [];
    for (const row of rows) {
        const season = await getSeason(row.season_id);
        if (!season?.merkle_root) continue;
        const leaves = await seasonLeaves(row.season_id);
        const { root, proofFor } = buildSeasonTree(leaves.map((l) => ({ account: l.wallet_address as Address, amountWei: BigInt(l.amount) })));
        // The rebuilt tree must reproduce the committed root exactly — if it
        // doesn't, the claims rows were tampered with or corrupted, and no proof
        // from them can be trusted.
        if (root !== season.merkle_root) throw new Error(`season ${row.season_id}: rebuilt root does not match committed root`);
        out.push({
            seasonId: season.id,
            seasonName: season.name,
            asset: row.asset,
            amountWei: row.amount,
            merkleIndex: row.merkle_index,
            merkleRoot: season.merkle_root,
            proof: proofFor(row.merkle_index),
            status: row.status,
            claimTransaction: row.claim_transaction,
            claimWindowEnd: season.claim_window_end ? season.claim_window_end.getTime() : null,
        });
    }
    return out;
}
