// Request metrics + dependency health (Phase 13). Counters live in Redis so
// they survive restarts and aggregate across replicas; route cardinality is
// bounded by normalizing paths (UUID/hex segments collapse to `:id`) before
// they become key names. Latency uses fixed histogram buckets — enough to see
// "p95 blew up" on the admin surface without a real TSDB (which stays a
// deliberate non-goal until traffic justifies one; see ADR 0013).
import { redis } from './redis.ts';
import { sql } from './db.ts';

const BUCKETS_MS = [25, 50, 100, 250, 500, 1000, 2500] as const;

// `/api/grid/1b2c.../ghost` and friends must not mint one Redis key per UUID.
export function normalizeRoute(path: string): string {
    return (
        path
            .split('/')
            .map((seg) => (/^[0-9a-f-]{16,}$/i.test(seg) || /^\d+$/.test(seg) ? ':id' : seg))
            .join('/') || '/'
    );
}

function bucketFor(durationMs: number): string {
    for (const b of BUCKETS_MS) if (durationMs <= b) return `le${b}`;
    return 'inf';
}

// Fire-and-forget: metrics must never add latency or failure modes to the
// request path itself.
export function recordRequest(method: string, path: string, status: number, durationMs: number): void {
    const route = normalizeRoute(path);
    const statusClass = `${Math.floor(status / 100)}xx`;
    const key = `${method}:${route}`;
    void redis
        .multi()
        .hincrby('metrics:req:count', `${key}:${statusClass}`, 1)
        .hincrby('metrics:req:duration', `${key}:${bucketFor(durationMs)}`, 1)
        .exec()
        .catch(() => undefined);
}

export function recordError(scope: string): void {
    void redis.hincrby('metrics:errors', scope, 1).catch(() => undefined);
}

export interface MetricsSnapshot {
    requests: Record<string, number>;
    durations: Record<string, number>;
    errors: Record<string, number>;
    process: { uptimeSec: number; rssMb: number; heapUsedMb: number };
}

export async function metricsSnapshot(): Promise<MetricsSnapshot> {
    const [requests, durations, errors] = await Promise.all([
        redis.hgetall('metrics:req:count'),
        redis.hgetall('metrics:req:duration'),
        redis.hgetall('metrics:errors'),
    ]);
    const mem = process.memoryUsage();
    return {
        requests: Object.fromEntries(Object.entries(requests).map(([k, v]) => [k, Number(v)])),
        durations: Object.fromEntries(Object.entries(durations).map(([k, v]) => [k, Number(v)])),
        errors: Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, Number(v)])),
        process: {
            uptimeSec: Math.floor(process.uptime()),
            rssMb: Math.round(mem.rss / 1024 / 1024),
            heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        },
    };
}

export interface DependencyHealth {
    ok: boolean;
    latencyMs: number | null;
    error?: string;
}

async function timed(check: () => Promise<unknown>): Promise<DependencyHealth> {
    const start = Date.now();
    try {
        await check();
        return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
        return { ok: false, latencyMs: null, error: err instanceof Error ? err.message : String(err) };
    }
}

export interface StatusReport {
    ok: boolean;
    uptimeSec: number;
    postgres: DependencyHealth;
    redis: DependencyHealth;
}

// The public status surface's substance: real round-trips to both hard
// dependencies, not a hardcoded "ok".
export async function statusReport(): Promise<StatusReport> {
    const [postgres, redisHealth] = await Promise.all([timed(() => sql`SELECT 1`), timed(() => redis.ping())]);
    return {
        ok: postgres.ok && redisHealth.ok,
        uptimeSec: Math.floor(process.uptime()),
        postgres,
        redis: redisHealth,
    };
}
