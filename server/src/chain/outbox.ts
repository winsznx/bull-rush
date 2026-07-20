// The relayer's outbox: chain_jobs (migration 0006) is the durable queue of on-chain
// writes this server needs to make. Enqueue is idempotent (ON CONFLICT DO NOTHING on
// idempotency_key — calling it twice for the same logical job is always safe); dequeue
// is atomic (SELECT ... FOR UPDATE SKIP LOCKED), so multiple relayer processes could run
// concurrently without double-claiming a job, even though today only one does.
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { sql } from '../db.ts';
import { canTransitionChainJob, type ChainJobStatus } from '../stateMachines.ts';

export type ChainJobType = 'open_grid' | 'record_run';
export type ChainJobPayload = Record<string, postgres.JSONValue>;

export interface ChainJobRow {
    id: string;
    job_type: ChainJobType;
    idempotency_key: string;
    payload: ChainJobPayload;
    status: ChainJobStatus;
    attempt_count: number;
    next_attempt_at: Date | null;
    transaction_hash: string | null;
    last_error: string | null;
    created_at: Date;
    completed_at: Date | null;
}

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 30_000;

export async function enqueueChainJob(
    jobType: ChainJobType,
    idempotencyKey: string,
    payload: ChainJobPayload,
): Promise<{ enqueued: boolean }> {
    const rows = await sql<{ id: string }[]>`
        INSERT INTO chain_jobs (id, job_type, idempotency_key, payload)
        VALUES (${randomUUID()}, ${jobType}, ${idempotencyKey}, ${sql.json(payload)})
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
    `;
    return { enqueued: rows.length > 0 };
}

// Atomic dequeue: only one caller can ever receive a given job, even under concurrent
// callers, because the row lock (FOR UPDATE SKIP LOCKED) is held for the duration of
// the UPDATE that claims it.
export async function claimNextJob(): Promise<ChainJobRow | null> {
    if (!canTransitionChainJob('pending', 'processing')) throw new Error('illegal chain_job transition: pending -> processing');
    const [row] = await sql<ChainJobRow[]>`
        UPDATE chain_jobs SET status = 'processing'
        WHERE id = (
            SELECT id FROM chain_jobs
            WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= now())
            ORDER BY created_at
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING *
    `;
    return row ?? null;
}

export async function markSubmitted(jobId: string, transactionHash: string): Promise<void> {
    if (!canTransitionChainJob('processing', 'submitted')) throw new Error('illegal chain_job transition: processing -> submitted');
    await sql`UPDATE chain_jobs SET status = 'submitted', transaction_hash = ${transactionHash} WHERE id = ${jobId}`;
}

export async function markConfirmed(jobId: string): Promise<void> {
    if (!canTransitionChainJob('submitted', 'confirmed')) throw new Error('illegal chain_job transition: submitted -> confirmed');
    await sql`UPDATE chain_jobs SET status = 'confirmed', completed_at = now() WHERE id = ${jobId}`;
}

// A tx that reverted on-chain (mined, but failed) — no more retries; the payload was
// submitted, so blindly resubmitting could double-spend gas on something already wrong.
export async function markReverted(jobId: string, error: string): Promise<void> {
    if (!canTransitionChainJob('submitted', 'failed')) throw new Error('illegal chain_job transition: submitted -> failed');
    await sql`UPDATE chain_jobs SET status = 'failed', last_error = ${error} WHERE id = ${jobId}`;
}

// A failure before/while submitting (RPC hiccup, nonce contention, insufficient relayer
// balance) — retried with exponential backoff up to MAX_ATTEMPTS, then parked as failed
// for operator attention (Phase 12 will add real alerting; for now `GET
// /api/admin/chain-jobs` is the visibility this codebase has).
export async function markAttemptFailed(jobId: string, attemptCount: number, error: string): Promise<void> {
    const nextAttempt = attemptCount + 1;
    if (nextAttempt >= MAX_ATTEMPTS) {
        if (!canTransitionChainJob('processing', 'failed')) throw new Error('illegal chain_job transition: processing -> failed');
        await sql`UPDATE chain_jobs SET status = 'failed', attempt_count = ${nextAttempt}, last_error = ${error} WHERE id = ${jobId}`;
        return;
    }
    if (!canTransitionChainJob('processing', 'pending')) throw new Error('illegal chain_job transition: processing -> pending');
    const backoffMs = BASE_BACKOFF_MS * 2 ** attemptCount;
    await sql`
        UPDATE chain_jobs
        SET status = 'pending', attempt_count = ${nextAttempt}, last_error = ${error},
            next_attempt_at = now() + (${backoffMs}::text || ' milliseconds')::interval
        WHERE id = ${jobId}
    `;
}

export async function listChainJobs(limit: number): Promise<ChainJobRow[]> {
    return sql<ChainJobRow[]>`SELECT * FROM chain_jobs ORDER BY created_at DESC LIMIT ${limit}`;
}
