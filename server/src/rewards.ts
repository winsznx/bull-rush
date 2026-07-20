// Season Zero reward engine: computes entitlements from independently verified
// runs only, allocates out of a fixed pre-funded cap, and commits them as a
// Merkle tree in exactly SeasonPrizeVault's leaf format. The published rules
// (docs/SEASON-ZERO.md) and this file must always agree — the doc is the
// player-facing statement of what this code does.
//
// The leaderboard source of truth for a PAYOUT decision is Postgres
// (verified_runs), never the Redis sorted set — Redis is a display cache that
// an operator can legitimately rebuild; money derives only from the durable,
// audited record.
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import type { Address } from 'viem';

// Points per finishing position on each grid's final board (position 1 first).
// Published in docs/SEASON-ZERO.md before any season opens; changing this for
// a live season would violate "rules published before competition."
export const GRID_POINTS = [40, 25, 15, 8, 5, 3, 1, 1, 1, 1] as const;

export interface GridStanding {
    identityKey: string;
    bestDistance: number;
}

// Points for one grid's final standings (already ordered best-first).
export function pointsForGrid(standings: GridStanding[]): Map<string, number> {
    const out = new Map<string, number>();
    for (let i = 0; i < standings.length && i < GRID_POINTS.length; i++) {
        out.set(standings[i].identityKey, GRID_POINTS[i]);
    }
    return out;
}

export interface Entitlement {
    identityKey: string;
    points: number;
    amountWei: bigint;
}

// Splits `poolWei` proportionally to accumulated points across every grid in
// the season. Floor division — the sum of entitlements never exceeds the pool;
// the dust remainder stays unallocated in the vault (published rule). Zero
// amounts are dropped (a leaf that can claim nothing has no business in the tree).
export function computeSeasonEntitlements(boards: GridStanding[][], poolWei: bigint): Entitlement[] {
    const totals = new Map<string, number>();
    for (const board of boards) {
        for (const [identityKey, pts] of pointsForGrid(board)) {
            totals.set(identityKey, (totals.get(identityKey) ?? 0) + pts);
        }
    }
    const totalPoints = [...totals.values()].reduce((a, b) => a + b, 0);
    if (totalPoints === 0) return [];

    const out: Entitlement[] = [];
    for (const [identityKey, points] of totals) {
        const amountWei = (poolWei * BigInt(points)) / BigInt(totalPoints);
        if (amountWei > 0n) out.push({ identityKey, points, amountWei });
    }
    // Deterministic output order regardless of Map insertion order.
    out.sort((a, b) => (a.identityKey < b.identityKey ? -1 : 1));
    return out;
}

export interface SeasonLeaf {
    account: Address;
    amountWei: bigint;
}

// StandardMerkleTree(['address','uint256']) produces exactly SeasonPrizeVault's
// leaf: keccak256(bytes.concat(keccak256(abi.encode(account, amount)))) — proven
// equal in rewards.test.ts against a hand-computed viem vector, and end-to-end
// against the real contract bytecode in rewards.integration.test.ts.
export function buildSeasonTree(leaves: SeasonLeaf[]): { root: `0x${string}`; proofFor: (index: number) => `0x${string}`[] } {
    const tree = StandardMerkleTree.of(
        leaves.map((l) => [l.account, l.amountWei] as [string, bigint]),
        ['address', 'uint256'],
    );
    return {
        root: tree.root as `0x${string}`,
        proofFor: (index: number) => tree.getProof(index) as `0x${string}`[],
    };
}
