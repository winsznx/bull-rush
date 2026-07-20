// Metrics + status against real Redis/Postgres: counters round-trip, routes
// normalize before becoming key names, and the status surface does genuine
// dependency round-trips.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from './db.ts';
import { runMigrations } from './migrate.ts';
import { redis } from './redis.ts';
import { normalizeRoute, recordRequest, recordError, metricsSnapshot, statusReport } from './metrics.ts';

beforeAll(async () => {
    await runMigrations();
});

afterAll(async () => {
    await sql.end();
    redis.disconnect();
});

describe('normalizeRoute', () => {
    it('collapses UUID and numeric segments so route cardinality stays bounded', () => {
        expect(normalizeRoute('/api/grid/1b2c3d4e-5f60-7182-93a4-b5c6d7e8f901/ghost')).toBe('/api/grid/:id/ghost');
        expect(normalizeRoute('/api/grid/run/9f8e7d6c-5b4a-3921-8076-fedcba987654/status')).toBe('/api/grid/run/:id/status');
        expect(normalizeRoute('/api/season/current')).toBe('/api/season/current');
        expect(normalizeRoute('/api/thing/12345')).toBe('/api/thing/:id');
    });
});

describe('request metrics (real Redis)', () => {
    it('records count + duration bucket and reads back in the snapshot', async () => {
        // #given a request recorded against a UUID route (fire-and-forget)
        recordRequest('GET', '/api/grid/1b2c3d4e-5f60-7182-93a4-b5c6d7e8f901/ghost', 200, 42);
        recordError('test_scope');
        await new Promise((r) => setTimeout(r, 100)); // let the pipeline land

        // #then the snapshot contains the normalized key and the right bucket
        const snap = await metricsSnapshot();
        expect(snap.requests['GET:/api/grid/:id/ghost:2xx']).toBeGreaterThanOrEqual(1);
        expect(snap.durations['GET:/api/grid/:id/ghost:le50']).toBeGreaterThanOrEqual(1);
        expect(snap.errors.test_scope).toBeGreaterThanOrEqual(1);
        expect(snap.process.uptimeSec).toBeGreaterThanOrEqual(0);
        expect(snap.process.rssMb).toBeGreaterThan(0);
    });
});

describe('status report (real dependencies)', () => {
    it('reports healthy with real round-trip latencies when both deps are up', async () => {
        const report = await statusReport();
        expect(report.ok).toBe(true);
        expect(report.postgres.ok).toBe(true);
        expect(report.redis.ok).toBe(true);
        expect(report.postgres.latencyMs).not.toBeNull();
        expect(report.redis.latencyMs).not.toBeNull();
    });
});
