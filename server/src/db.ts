import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

// Pooled per instance (cap so horizontal replicas can't exhaust Postgres).
// SSL on for public connections (local dev / proxy); off on Railway private net.
export const sql = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: process.env.DATABASE_SSL === 'true' ? 'require' : false,
});

// Schema is managed by versioned migrations (server/migrations/*.sql, applied
// via `npm run db:migrate` — see server/src/migrate.ts), not by code in this
// file. This replaces the ad hoc boot-time `CREATE TABLE IF NOT EXISTS` calls
// every table before Phase 5 was created with.
