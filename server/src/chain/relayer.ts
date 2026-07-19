// Processes one chain_jobs row at a time against the real chain (or a local anvil node
// in tests) — one at a time, waiting for each receipt before claiming the next, so the
// wallet client's nonce management never has to reason about concurrent in-flight txs
// from this same relayer key.
import type { Address, Hex } from 'viem';
import { sql } from '../db.ts';
import { DAILY_GRID_REGISTRY_ABI, VERIFIED_RUN_REGISTRY_ABI } from './abis.ts';
import { type ChainRelayerConfig, createChainClients } from './client.ts';
import { claimNextJob, markAttemptFailed, markConfirmed, markReverted, markSubmitted, type ChainJobRow } from './outbox.ts';
import { canTransitionGridIndexing, canTransitionVerifiedRun } from '../stateMachines.ts';

interface OpenGridPayload {
    dayId: string;
    onChainGridId: Hex;
    seed: Hex;
    rulesetHash: Hex;
    gameVersion: string;
    opensAt: number; // unix seconds
    closesAt: number; // unix seconds
}

interface RecordRunPayload {
    verifiedRunId: string; // this server's own verified_runs.id, for status bookkeeping
    runId: Hex;
    onChainGridId: Hex;
    player: Address;
    replayHash: Hex;
    distance: number;
    score: number;
    gameVersion: string;
}

type Clients = ReturnType<typeof createChainClients>;

async function sendOpenGrid(clients: Clients, address: Address, p: OpenGridPayload): Promise<Hex> {
    return clients.walletClient.writeContract({
        address,
        abi: DAILY_GRID_REGISTRY_ABI,
        functionName: 'openGrid',
        args: [p.onChainGridId, p.seed, p.rulesetHash, p.gameVersion, BigInt(p.opensAt), BigInt(p.closesAt)],
    });
}

async function sendRecordRun(clients: Clients, address: Address, p: RecordRunPayload): Promise<Hex> {
    return clients.walletClient.writeContract({
        address,
        abi: VERIFIED_RUN_REGISTRY_ABI,
        functionName: 'recordRun',
        args: [p.runId, p.onChainGridId, p.player, p.replayHash, p.distance, p.score, p.gameVersion],
    });
}

async function onSubmitted(job: ChainJobRow): Promise<void> {
    if (job.job_type === 'open_grid') {
        const p = job.payload as unknown as OpenGridPayload;
        if (canTransitionGridIndexing('queued', 'submitted')) {
            await sql`UPDATE daily_grids SET indexing_state = 'submitted' WHERE day_id = ${p.dayId}`;
        }
    } else {
        const p = job.payload as unknown as RecordRunPayload;
        if (canTransitionVerifiedRun('receipt_queued', 'submitted')) {
            await sql`UPDATE verified_runs SET status = 'submitted' WHERE id = ${p.verifiedRunId}`;
        }
    }
}

async function onConfirmed(job: ChainJobRow): Promise<void> {
    if (job.job_type === 'open_grid') {
        const p = job.payload as unknown as OpenGridPayload;
        if (canTransitionGridIndexing('submitted', 'confirmed')) {
            await sql`
                UPDATE daily_grids SET indexing_state = 'confirmed', contract_tx = ${job.transaction_hash}
                WHERE day_id = ${p.dayId}
            `;
        }
    } else {
        const p = job.payload as unknown as RecordRunPayload;
        if (canTransitionVerifiedRun('submitted', 'confirmed')) {
            await sql`
                UPDATE verified_runs SET status = 'confirmed', receipt_tx_hash = ${job.transaction_hash}
                WHERE id = ${p.verifiedRunId}
            `;
        }
    }
}

// Processes exactly one pending job, if any. Returns false when the queue was empty —
// callers (the poll loop, or an admin-triggered batch) use that to stop early.
export async function processOneJob(config: ChainRelayerConfig): Promise<boolean> {
    const job = await claimNextJob();
    if (!job) return false;

    const clients = createChainClients(config);

    try {
        const txHash =
            job.job_type === 'open_grid'
                ? await sendOpenGrid(clients, config.dailyGridRegistryAddress, job.payload as unknown as OpenGridPayload)
                : await sendRecordRun(clients, config.verifiedRunRegistryAddress, job.payload as unknown as RecordRunPayload);

        await markSubmitted(job.id, txHash);
        await onSubmitted({ ...job, transaction_hash: txHash });

        const receipt = await clients.publicClient.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status === 'reverted') {
            await markReverted(job.id, 'transaction reverted on-chain');
            return true;
        }

        await markConfirmed(job.id);
        await onConfirmed({ ...job, transaction_hash: txHash });
    } catch (err) {
        await markAttemptFailed(job.id, job.attempt_count, err instanceof Error ? err.message : String(err));
    }

    return true;
}

export async function drainJobs(config: ChainRelayerConfig, maxJobs: number): Promise<number> {
    let processed = 0;
    while (processed < maxJobs) {
        const didWork = await processOneJob(config);
        if (!didWork) break;
        processed += 1;
    }
    return processed;
}

export function startRelayerLoop(config: ChainRelayerConfig, intervalMs: number): () => void {
    const timer = setInterval(() => {
        drainJobs(config, 10).catch((err) => console.error('relayer loop error', err));
    }, intervalMs);
    return () => clearInterval(timer);
}
