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

export async function initSchema(): Promise<void> {
    await sql`
        CREATE TABLE IF NOT EXISTS runs (
            id          uuid PRIMARY KEY,
            name        text NOT NULL,
            distance    integer NOT NULL,
            score       integer NOT NULL,
            rank        text NOT NULL,
            death_cause text,
            jeets_dodged integer DEFAULT 0,
            snipers_survived integer DEFAULT 0,
            mev_avoided integer DEFAULT 0,
            max_combo   integer DEFAULT 0,
            duration_ms integer DEFAULT 0,
            wallet      text,
            referrer    text,
            suspicious  boolean DEFAULT false,
            created_at  timestamptz DEFAULT now()
        )
    `;
    await sql`ALTER TABLE runs ADD COLUMN IF NOT EXISTS verified boolean DEFAULT false`;
    await sql`ALTER TABLE runs ADD COLUMN IF NOT EXISTS replay_len integer DEFAULT 0`;
    await sql`CREATE INDEX IF NOT EXISTS runs_distance_idx ON runs (distance DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS runs_created_idx ON runs (created_at DESC)`;
}
