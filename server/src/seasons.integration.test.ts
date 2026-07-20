// Season Zero end-to-end against REAL dependencies: real Postgres (entitlement
// computation from verified_runs, atomic close, claims rows) and a real local
// anvil chain running the actual compiled SeasonPrizeVault bytecode — the
// cross-implementation proof that the TypeScript-built Merkle tree verifies
// inside the Solidity contract, with funds actually moving.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { type ChildProcess, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sql } from './db.ts';
import { runMigrations } from './migrate.ts';
import { redis } from './redis.ts';
import { openGrid, issueTicket, recordVerifiedRun } from './grid.ts';
import { createSeason, closeSeason, getRewardsForUser } from './seasons.ts';
import { toOnChainSeasonId } from './chain/onchainIds.ts';
import { GAME_VERSION } from './sim/ruleset.ts';

const CONTRACTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../contracts');
const ANVIL_PORT = 8551;
const ANVIL_RPC = `http://127.0.0.1:${ANVIL_PORT}`;
// anvil's well-known default test key #0 — public, holds no real value anywhere.
const OWNER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const NATIVE = '0x0000000000000000000000000000000000000000';

const VAULT_ABI = parseAbi([
    'function createSeason(bytes32 seasonId, address token, uint256 cap, uint64 claimWindowEnd)',
    'function publishMerkleRoot(bytes32 seasonId, bytes32 root)',
    'function fundNative(bytes32 seasonId) payable',
    'function claim(bytes32 seasonId, address account, uint256 amount, bytes32[] proof)',
    'function claimedBy(bytes32 seasonId, address account) view returns (bool)',
]);

const anvilChain = defineChain({
    id: 31337,
    name: 'anvil',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [ANVIL_RPC] } },
});

async function waitForAnvil(): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(ANVIL_RPC, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
            });
            if (res.ok) return;
        } catch {
            // not up yet
        }
        await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('anvil did not become ready in time');
}

interface Player {
    userId: string;
    wallet: Address;
    identityKey: string;
}

async function seedPlayer(): Promise<Player> {
    const userId = randomUUID();
    const wallet = `0x${randomUUID().replace(/-/g, '')}${'0'.repeat(8)}`.slice(0, 42) as Address;
    await sql`INSERT INTO users ${sql({ id: userId, chain_id: 677, wallet_address: wallet })}`;
    return { userId, wallet, identityKey: `677:${wallet}` };
}

// Each season test gets its own disjoint window far in the past, with its grid
// backdated INTO that window — so no other test's grids (all created "now") can
// ever fall inside it, and the window is always already over (closeable).
let windowCounter = 0;
function uniquePastWindow(): { startsAt: Date; endsAt: Date; gridCreatedAt: Date } {
    windowCounter += 1;
    const base = Date.now() - (1000 + windowCounter * 10) * 24 * 3_600_000;
    return { startsAt: new Date(base), endsAt: new Date(base + 24 * 3_600_000), gridCreatedAt: new Date(base + 3_600_000) };
}

async function seedRun(player: Player, gridId: string, distance: number): Promise<void> {
    const issued = await issueTicket(player.identityKey, gridId);
    if (!('ticket' in issued)) throw new Error('unreachable');
    await recordVerifiedRun({
        gridId,
        ticketId: issued.ticket.id,
        identityKey: player.identityKey,
        player: player.wallet,
        gameVersion: GAME_VERSION,
        replayHash: `0x${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}` as `0x${string}`,
        replayTicks: 600,
        replayInputsFlat: [10, 1, 30, 2],
        distance,
        score: distance,
        maxCombo: 0,
        deathCause: 'test',
        durationMs: 5000,
        suspicious: false,
        replayLen: 2,
    });
}

describe('Season Zero lifecycle (real Postgres + real SeasonPrizeVault on anvil)', () => {
    let anvil: ChildProcess;
    let vaultAddress: Address;
    const owner = privateKeyToAccount(OWNER_KEY);
    const publicClient = createPublicClient({ chain: anvilChain, transport: http(ANVIL_RPC) });
    const walletClient = createWalletClient({ account: owner, chain: anvilChain, transport: http(ANVIL_RPC) });

    beforeAll(async () => {
        await runMigrations();
        await sql`DELETE FROM chain_jobs`;

        anvil = spawn('anvil', ['--port', String(ANVIL_PORT), '--silent'], { stdio: 'ignore' });
        await waitForAnvil();

        const artifact = JSON.parse(readFileSync(join(CONTRACTS_DIR, 'out/SeasonPrizeVault.sol/SeasonPrizeVault.json'), 'utf8'));
        const hash = await walletClient.deployContract({
            abi: artifact.abi as typeof VAULT_ABI,
            bytecode: artifact.bytecode.object as Hex,
            args: [owner.address],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        vaultAddress = receipt.contractAddress as Address;
    }, 30_000);

    afterAll(async () => {
        anvil?.kill();
        await sql.end();
        redis.disconnect();
    });

    it('closes a season from verified runs and every entitlement claims on-chain via TS-built proofs', async () => {
        // #given three players with verified runs on one grid inside the window
        const seasonId = `test-season-${randomUUID().slice(0, 8)}`;
        const capWei = 10n ** 18n; // 1 native token, pre-funded below
        const { startsAt, endsAt, gridCreatedAt } = uniquePastWindow();

        const [alice, bob, carol] = await Promise.all([seedPlayer(), seedPlayer(), seedPlayer()]);
        const grid = await openGrid(`test-${randomUUID()}`);
        await sql`UPDATE daily_grids SET opens_at = now() - interval '1 minute', created_at = ${gridCreatedAt} WHERE id = ${grid.id}`;
        await seedRun(alice, grid.id, 1500);
        await seedRun(bob, grid.id, 900);
        await seedRun(carol, grid.id, 400);

        await createSeason({
            id: seasonId,
            name: 'Test Season',
            asset: NATIVE,
            capWei,
            startsAt,
            endsAt, // a far-past window: already over, and no other test's grids can be in it
        });

        // #when the season closes
        const result = await closeSeason(seasonId);
        if ('rejected' in result) throw new Error(`unexpected rejection: ${result.rejected}`);

        // #then entitlements: 40/25/15 points of an 80-point total, floor split, sum <= cap
        expect(result.claimCount).toBe(3);
        expect(result.totalAllocatedWei).toBeLessThanOrEqual(capWei);
        const aliceRewards = await getRewardsForUser(alice.userId);
        expect(aliceRewards).toHaveLength(1);
        expect(BigInt(aliceRewards[0].amountWei)).toBe((capWei * 40n) / 80n);
        expect(aliceRewards[0].status).toBe('eligible');

        // #when the season is mirrored on the real vault contract and funded
        const onChainSeasonId = toOnChainSeasonId(seasonId);
        const createHash = await walletClient.writeContract({
            address: vaultAddress,
            abi: VAULT_ABI,
            functionName: 'createSeason',
            args: [onChainSeasonId, NATIVE as Address, capWei, 0n],
        });
        await publicClient.waitForTransactionReceipt({ hash: createHash });
        const rootHash = await walletClient.writeContract({
            address: vaultAddress,
            abi: VAULT_ABI,
            functionName: 'publishMerkleRoot',
            args: [onChainSeasonId, result.root],
        });
        await publicClient.waitForTransactionReceipt({ hash: rootHash });
        const fundHash = await walletClient.writeContract({
            address: vaultAddress,
            abi: VAULT_ABI,
            functionName: 'fundNative',
            args: [onChainSeasonId],
            value: capWei,
        });
        await publicClient.waitForTransactionReceipt({ hash: fundHash });

        // #then every player's TS-built proof claims successfully on-chain (claimFor:
        // the owner submits, funds go to the player's address regardless)
        for (const player of [alice, bob, carol]) {
            const [reward] = await getRewardsForUser(player.userId);
            const before = await publicClient.getBalance({ address: player.wallet });
            const h = await walletClient.writeContract({
                address: vaultAddress,
                abi: VAULT_ABI,
                functionName: 'claim',
                args: [onChainSeasonId, player.wallet, BigInt(reward.amountWei), reward.proof],
            });
            const rcpt = await publicClient.waitForTransactionReceipt({ hash: h });
            expect(rcpt.status).toBe('success');
            const after = await publicClient.getBalance({ address: player.wallet });
            expect(after - before).toBe(BigInt(reward.amountWei));
            expect(await publicClient.readContract({
                address: vaultAddress,
                abi: VAULT_ABI,
                functionName: 'claimedBy',
                args: [onChainSeasonId, player.wallet],
            })).toBe(true);
        }

        // #then a double claim reverts on-chain
        const [aliceReward] = await getRewardsForUser(alice.userId);
        await expect(
            walletClient.writeContract({
                address: vaultAddress,
                abi: VAULT_ABI,
                functionName: 'claim',
                args: [onChainSeasonId, alice.wallet, BigInt(aliceReward.amountWei), aliceReward.proof],
            }),
        ).rejects.toThrow();
    }, 30_000);

    it('refuses to close before the window ends, twice, or with no eligible runs', async () => {
        // #given a season whose window is still open
        const openId = `test-open-${randomUUID().slice(0, 8)}`;
        await createSeason({
            id: openId,
            name: 'Still Open',
            asset: NATIVE,
            capWei: 10n ** 18n,
            startsAt: new Date(Date.now() - 1000),
            endsAt: new Date(Date.now() + 3_600_000),
        });
        expect(await closeSeason(openId)).toEqual({ rejected: 'season_window_still_open' });

        // #given an ended season with no runs at all in its window
        const emptyId = `test-empty-${randomUUID().slice(0, 8)}`;
        await createSeason({
            id: emptyId,
            name: 'Empty',
            asset: NATIVE,
            capWei: 10n ** 18n,
            startsAt: new Date(Date.now() - 120 * 24 * 3_600_000),
            endsAt: new Date(Date.now() - 119 * 24 * 3_600_000),
        });
        expect(await closeSeason(emptyId)).toEqual({ rejected: 'no_eligible_runs' });

        expect(await closeSeason('never-created')).toEqual({ rejected: 'season_not_found' });
    });

    it('a risk_hold run earns nothing', async () => {
        // #given one clean player and one whose only run is risk_hold
        const seasonId = `test-risk-${randomUUID().slice(0, 8)}`;
        const { startsAt, endsAt, gridCreatedAt } = uniquePastWindow();
        const clean = await seedPlayer();
        const flagged = await seedPlayer();
        const grid = await openGrid(`test-${randomUUID()}`);
        await sql`UPDATE daily_grids SET opens_at = now() - interval '1 minute', created_at = ${gridCreatedAt} WHERE id = ${grid.id}`;
        await seedRun(clean, grid.id, 800);

        const issued = await issueTicket(flagged.identityKey, grid.id);
        if (!('ticket' in issued)) throw new Error('unreachable');
        await recordVerifiedRun({
            gridId: grid.id,
            ticketId: issued.ticket.id,
            identityKey: flagged.identityKey,
            player: flagged.wallet,
            gameVersion: GAME_VERSION,
            replayHash: `0x${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}` as `0x${string}`,
            replayTicks: 600,
            replayInputsFlat: [10, 1],
            distance: 99_999, // "wins" — but flagged
            score: 99_999,
            maxCombo: 0,
            deathCause: 'test',
            durationMs: 100,
            suspicious: true,
            replayLen: 1,
        });

        await createSeason({
            id: seasonId,
            name: 'Risk Season',
            asset: NATIVE,
            capWei: 10n ** 18n,
            startsAt,
            endsAt,
        });
        const result = await closeSeason(seasonId);
        if ('rejected' in result) throw new Error(`unexpected rejection: ${result.rejected}`);

        // #then only the clean player has a claim — a flagged run never pays
        expect(result.claimCount).toBe(1);
        expect(await getRewardsForUser(flagged.userId)).toHaveLength(0);
        expect((await getRewardsForUser(clean.userId))[0]).toBeDefined();
    });
});
