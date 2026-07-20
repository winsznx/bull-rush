// Real end-to-end proof of the relayer, against a real local anvil chain running the
// actual compiled Phase 6 contracts (not mocked ABI calls) — the same "real dependency,
// not a stand-in" standard every other *.integration.test.ts in this repo holds to.
// Requires `forge build` to have already produced contracts/out/*.json (CI's `contracts`
// job step, or run manually from contracts/ locally) and a real local Postgres + Redis
// (docker compose up), same as every other integration test here.
import { readFileSync } from 'node:fs';
import { type ChildProcess, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPublicClient, createWalletClient, defineChain, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sql } from '../db.ts';
import { runMigrations } from '../migrate.ts';
import { redis } from '../redis.ts';
import { openGrid, issueTicket, recordVerifiedRun } from '../grid.ts';
import { GAME_VERSION } from '../sim/ruleset.ts';
import type { ChainRelayerConfig } from './client.ts';
import { drainJobs } from './relayer.ts';
import { toOnChainGridId, toOnChainRunId } from './onchainIds.ts';
import { fetchGridOpenedEvents, fetchRunRecordedEvents } from './indexer.ts';
import { DAILY_GRID_REGISTRY_ABI, VERIFIED_RUN_REGISTRY_ABI } from './abis.ts';

const CONTRACTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../contracts');
const ANVIL_PORT = 8549;
const ANVIL_RPC = `http://127.0.0.1:${ANVIL_PORT}`;
// anvil's well-known default account #0 (mnemonic "test test test test test test test
// test test test test junk") — public, test-only, holds no real value on any network.
const RELAYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;

function readArtifact(contractName: string): { abi: unknown; bytecode: Hex } {
    const path = join(CONTRACTS_DIR, 'out', `${contractName}.sol`, `${contractName}.json`);
    const artifact = JSON.parse(readFileSync(path, 'utf8'));
    return { abi: artifact.abi, bytecode: artifact.bytecode.object as Hex };
}

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

describe('relayer + indexer (real anvil chain, real Phase 6 contracts)', () => {
    let anvil: ChildProcess;
    let config: ChainRelayerConfig;
    let dailyGridRegistryAddress: Address;
    let verifiedRunRegistryAddress: Address;

    beforeAll(async () => {
        await runMigrations();
        // Start with an empty queue: chain_jobs persists across separate local runs of
        // this suite (unlike other tables here, nothing in it needs to survive between
        // runs), and a stale row from an earlier local run would otherwise get drained
        // against this run's freshly-deployed, unrelated anvil contracts.
        await sql`DELETE FROM chain_jobs`;

        anvil = spawn('anvil', ['--port', String(ANVIL_PORT), '--silent'], { stdio: 'ignore' });
        await waitForAnvil();

        const chain = defineChain({
            id: 31337,
            name: 'anvil',
            nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
            rpcUrls: { default: { http: [ANVIL_RPC] } },
        });
        const account = privateKeyToAccount(RELAYER_KEY);
        const publicClient = createPublicClient({ chain, transport: http(ANVIL_RPC) });
        const walletClient = createWalletClient({ account, chain, transport: http(ANVIL_RPC) });

        const gridRegistryArtifact = readArtifact('DailyGridRegistry');
        const gridDeployHash = await walletClient.deployContract({
            abi: gridRegistryArtifact.abi as typeof DAILY_GRID_REGISTRY_ABI,
            bytecode: gridRegistryArtifact.bytecode,
            args: [account.address, account.address],
        });
        const gridReceipt = await publicClient.waitForTransactionReceipt({ hash: gridDeployHash });
        dailyGridRegistryAddress = gridReceipt.contractAddress as Address;

        const runRegistryArtifact = readArtifact('VerifiedRunRegistry');
        const runDeployHash = await walletClient.deployContract({
            abi: runRegistryArtifact.abi as typeof VERIFIED_RUN_REGISTRY_ABI,
            bytecode: runRegistryArtifact.bytecode,
            args: [account.address, account.address, dailyGridRegistryAddress],
        });
        const runReceipt = await publicClient.waitForTransactionReceipt({ hash: runDeployHash });
        verifiedRunRegistryAddress = runReceipt.contractAddress as Address;

        config = {
            chainId: 31337,
            rpcUrl: ANVIL_RPC,
            relayerPrivateKey: RELAYER_KEY,
            dailyGridRegistryAddress,
            verifiedRunRegistryAddress,
        };
    }, 30_000);

    afterAll(async () => {
        anvil?.kill();
        await sql.end();
        redis.disconnect();
    });

    it('drains an open_grid job to confirmed and the grid exists on-chain', async () => {
        const dayId = `test-relayer-${Date.now()}`;
        await openGrid(dayId);

        const processed = await drainJobs(config, 5);
        expect(processed).toBeGreaterThan(0);

        const [row] = await sql<{ indexing_state: string; contract_tx: string | null }[]>`
            SELECT indexing_state, contract_tx FROM daily_grids WHERE day_id = ${dayId}
        `;
        expect(row.indexing_state).toBe('confirmed');
        expect(row.contract_tx).toMatch(/^0x[0-9a-f]{64}$/);

        const publicClient = createPublicClient({
            chain: defineChain({ id: 31337, name: 'anvil', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [ANVIL_RPC] } } }),
            transport: http(ANVIL_RPC),
        });
        const exists = await publicClient.readContract({
            address: dailyGridRegistryAddress,
            abi: DAILY_GRID_REGISTRY_ABI,
            functionName: 'gridExists',
            args: [toOnChainGridId(dayId)],
        });
        expect(exists).toBe(true);
    }, 20_000);

    it('drains a record_run job to confirmed and the run is recorded on-chain', async () => {
        const dayId = `test-relayer-run-${Date.now()}`;
        const grid = await openGrid(dayId);
        await sql`UPDATE daily_grids SET opens_at = now() - interval '1 minute' WHERE id = ${grid.id}`;
        await drainJobs(config, 5); // clear the grid's own open_grid job first

        const player = '0x3333333333333333333333333333333333333333' as Address;
        const identity = `player-${Date.now()}`;
        const issued = await issueTicket(identity, grid.id);
        if (!('ticket' in issued)) throw new Error('unreachable');

        const replayHash = `0x${'cc'.repeat(32)}` as Hex;
        const { isPersonalBest } = await recordVerifiedRun({
            gridId: grid.id,
            ticketId: issued.ticket.id,
            identityKey: identity,
            player,
            gameVersion: GAME_VERSION,
            replayHash,
            replayTicks: 600,
            replayInputsFlat: [10, 1, 30, 2, 55, 0],
            distance: 777,
            score: 777,
            maxCombo: 3,
            deathCause: 'test',
            durationMs: 5000,
            suspicious: false,
            riskReasons: [],
            ipHint: null,
            replayLen: 20,
        });
        expect(isPersonalBest).toBe(true);

        const processed = await drainJobs(config, 5);
        expect(processed).toBeGreaterThan(0);

        const [row] = await sql<{ status: string; receipt_tx_hash: string | null }[]>`
            SELECT status, receipt_tx_hash FROM verified_runs
            WHERE grid_id = ${grid.id} AND identity_key = ${identity}
        `;
        expect(row.status).toBe('confirmed');
        expect(row.receipt_tx_hash).toMatch(/^0x[0-9a-f]{64}$/);

        const onChainGridId = toOnChainGridId(dayId);
        const runId = toOnChainRunId(onChainGridId, player, replayHash);
        const publicClient = createPublicClient({
            chain: defineChain({ id: 31337, name: 'anvil', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [ANVIL_RPC] } } }),
            transport: http(ANVIL_RPC),
        });
        const recorded = await publicClient.readContract({
            address: verifiedRunRegistryAddress,
            abi: VERIFIED_RUN_REGISTRY_ABI,
            functionName: 'recorded',
            args: [runId],
        });
        expect(recorded).toBe(true);
    }, 20_000);

    it('the indexer independently reads back GridOpened and RunRecorded events', async () => {
        const publicClient = createPublicClient({
            chain: defineChain({ id: 31337, name: 'anvil', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [ANVIL_RPC] } } }),
            transport: http(ANVIL_RPC),
        });

        const gridEvents = await fetchGridOpenedEvents(publicClient, dailyGridRegistryAddress, 0n);
        expect(gridEvents.length).toBeGreaterThan(0);
        expect(gridEvents[0].gameVersion).toBe(GAME_VERSION);

        const runEvents = await fetchRunRecordedEvents(publicClient, verifiedRunRegistryAddress, 0n);
        expect(runEvents.length).toBeGreaterThan(0);
        expect(runEvents[0].distance).toBe(777);
        expect(runEvents[0].isPersonalBest).toBe(true);
    });

    it('enqueueing the same grid twice never produces two chain_jobs (idempotent outbox)', async () => {
        const dayId = `test-relayer-idem-${Date.now()}`;
        await openGrid(dayId);
        await openGrid(dayId); // same dayId — enqueueChainJob's ON CONFLICT must no-op

        const jobs = await sql<{ id: string }[]>`SELECT id FROM chain_jobs WHERE idempotency_key = ${`open_grid:${dayId}`}`;
        expect(jobs.length).toBe(1);
    });
});
