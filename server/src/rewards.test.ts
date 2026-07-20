// Pure-logic tests (no DB): entitlement math and Merkle leaf-format compatibility.
import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, keccak256 } from 'viem';
import { GRID_POINTS, pointsForGrid, computeSeasonEntitlements, buildSeasonTree, type GridStanding } from './rewards';

const board = (...keys: string[]): GridStanding[] => keys.map((k, i) => ({ identityKey: k, bestDistance: 1000 - i }));

describe('pointsForGrid', () => {
    it('awards the published points table by position and nothing past the top 10', () => {
        const standings = board(...Array.from({ length: 12 }, (_, i) => `p${i}`));
        const pts = pointsForGrid(standings);
        expect(pts.get('p0')).toBe(GRID_POINTS[0]);
        expect(pts.get('p9')).toBe(GRID_POINTS[9]);
        expect(pts.has('p10')).toBe(false);
        expect(pts.has('p11')).toBe(false);
    });
});

describe('computeSeasonEntitlements', () => {
    it('splits the pool proportionally to points across grids', () => {
        // #given two grids: A wins both, B is second in both
        const boards = [board('A', 'B'), board('A', 'B')];
        const pool = 1_000_000_000_000_000_000n; // 1 BOT
        // #when entitlements are computed (A: 80 pts, B: 50 pts, total 130)
        const ents = computeSeasonEntitlements(boards, pool);
        // #then the shares are the floor of the proportional split
        const a = ents.find((e) => e.identityKey === 'A');
        const b = ents.find((e) => e.identityKey === 'B');
        expect(a?.points).toBe(80);
        expect(b?.points).toBe(50);
        expect(a?.amountWei).toBe((pool * 80n) / 130n);
        expect(b?.amountWei).toBe((pool * 50n) / 130n);
    });

    it('never allocates more than the pool (floor division, dust stays behind)', () => {
        const boards = [board('A', 'B', 'C'), board('B', 'C', 'A'), board('C', 'A', 'B')];
        const pool = 999_999_999_999_999_999n;
        const total = computeSeasonEntitlements(boards, pool).reduce((s, e) => s + e.amountWei, 0n);
        expect(total).toBeLessThanOrEqual(pool);
        expect(total).toBeGreaterThan((pool * 99n) / 100n); // dust only, not a real shortfall
    });

    it('is deterministic and sorted by identityKey regardless of board order', () => {
        const a = computeSeasonEntitlements([board('Z', 'A', 'M')], 10n ** 18n);
        const b = computeSeasonEntitlements([board('Z', 'A', 'M')], 10n ** 18n);
        expect(a).toEqual(b);
        expect(a.map((e) => e.identityKey)).toEqual([...a.map((e) => e.identityKey)].sort());
    });

    it('returns nothing for an empty season', () => {
        expect(computeSeasonEntitlements([], 10n ** 18n)).toEqual([]);
        expect(computeSeasonEntitlements([[]], 10n ** 18n)).toEqual([]);
    });

    it('drops zero-wei entitlements (a dust pool cannot mint empty leaves)', () => {
        const boards = [board('A', 'B')];
        const ents = computeSeasonEntitlements(boards, 1n); // 1 wei pool
        for (const e of ents) expect(e.amountWei).toBeGreaterThan(0n);
    });
});

describe('buildSeasonTree', () => {
    const alice = '0x1111111111111111111111111111111111111111' as const;
    const bob = '0x2222222222222222222222222222222222222222' as const;

    it('produces exactly SeasonPrizeVault.claim\'s leaf format (hand-computed vector)', () => {
        // #given a single leaf, where the tree root IS the leaf hash
        const amount = 4_000_000_000_000_000_000n;
        const { root } = buildSeasonTree([{ account: alice, amountWei: amount }]);
        // #then it equals keccak256(bytes.concat(keccak256(abi.encode(account, amount))))
        const inner = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [alice, amount]));
        expect(root).toBe(keccak256(inner));
    });

    it('is deterministic for the same leaf set', () => {
        const leaves = [
            { account: alice, amountWei: 3n * 10n ** 18n },
            { account: bob, amountWei: 1n * 10n ** 18n },
        ];
        expect(buildSeasonTree(leaves).root).toBe(buildSeasonTree(leaves).root);
    });

    it('root changes if any amount changes', () => {
        const a = buildSeasonTree([{ account: alice, amountWei: 1n }, { account: bob, amountWei: 2n }]);
        const b = buildSeasonTree([{ account: alice, amountWei: 1n }, { account: bob, amountWei: 3n }]);
        expect(a.root).not.toBe(b.root);
    });
});
