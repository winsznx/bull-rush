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

    // Daily Grid lifecycle (Phase 3). Ad hoc CREATE TABLE IF NOT EXISTS, matching
    // the style already used above — Phase 5 formalizes all of this (this table
    // set included) into versioned migrations rather than boot-time DDL.
    //
    // `identity_key` is an explicit, documented placeholder for what will become
    // a real `users.id` (wallet-address-keyed) foreign key once Phase 4 (wallet +
    // SIWE) exists. Using today's display-name-based identity here is no worse
    // than the pre-existing global leaderboard's identity model (already
    // documented as a known limitation) — it does not newly introduce that gap,
    // and confining it to a clearly-named column makes the eventual swap a
    // rename + backfill, not a redesign.
    await sql`
        CREATE TABLE IF NOT EXISTS daily_grids (
            id              uuid PRIMARY KEY,
            day_id          text NOT NULL UNIQUE,
            seed            text NOT NULL,
            game_version    text NOT NULL,
            ruleset_hash    text NOT NULL,
            source_block    bigint,
            opens_at        timestamptz NOT NULL,
            closes_at       timestamptz NOT NULL,
            contract_tx     text,
            indexing_state  text NOT NULL DEFAULT 'off_chain',
            created_at      timestamptz DEFAULT now()
        )
    `;

    await sql`
        CREATE TABLE IF NOT EXISTS run_tickets (
            id            uuid PRIMARY KEY,
            grid_id       uuid NOT NULL REFERENCES daily_grids(id),
            identity_key  text NOT NULL,
            seed          text NOT NULL,
            game_version  text NOT NULL,
            ruleset_hash  text NOT NULL,
            issued_at     timestamptz NOT NULL DEFAULT now(),
            expires_at    timestamptz NOT NULL,
            consumed_at   timestamptz,
            status        text NOT NULL DEFAULT 'issued'
        )
    `;
    await sql`CREATE INDEX IF NOT EXISTS run_tickets_identity_idx ON run_tickets (identity_key)`;

    await sql`
        CREATE TABLE IF NOT EXISTS grid_runs (
            id                uuid PRIMARY KEY,
            grid_id           uuid NOT NULL REFERENCES daily_grids(id),
            ticket_id         uuid NOT NULL REFERENCES run_tickets(id),
            identity_key      text NOT NULL,
            distance          integer NOT NULL,
            score             integer NOT NULL,
            max_combo         integer DEFAULT 0,
            death_cause       text,
            duration_ms       integer DEFAULT 0,
            suspicious        boolean DEFAULT false,
            is_personal_best  boolean DEFAULT false,
            replay_len        integer DEFAULT 0,
            created_at        timestamptz DEFAULT now()
        )
    `;
    await sql`CREATE INDEX IF NOT EXISTS grid_runs_grid_idx ON grid_runs (grid_id, distance DESC)`;

    // Wallet identity + SIWE (Phase 4). Real identity, finally: a user is keyed
    // by (chain_id, wallet_address) — never by the spoofable display name that
    // `identity_key` stood in for through Phase 3. `display_name_normalized` has
    // a partial unique index (case-insensitive uniqueness; NULLs don't collide,
    // so a user can go without a display name).
    await sql`
        CREATE TABLE IF NOT EXISTS users (
            id                        uuid PRIMARY KEY,
            chain_id                  integer NOT NULL,
            wallet_address            text NOT NULL,
            display_name              text,
            display_name_normalized   text,
            status                    text NOT NULL DEFAULT 'active',
            created_at                timestamptz DEFAULT now(),
            last_seen_at              timestamptz DEFAULT now(),
            risk_state                text NOT NULL DEFAULT 'none',
            UNIQUE (chain_id, wallet_address)
        )
    `;
    await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS users_display_name_idx
        ON users (display_name_normalized) WHERE display_name_normalized IS NOT NULL
    `;

    // One-time SIWE nonces. `nonce_hash` (not the raw nonce) is stored so a
    // database read alone can't be replayed into a valid login — matches the
    // "store the hash, not the secret" discipline used for refresh tokens below.
    await sql`
        CREATE TABLE IF NOT EXISTS auth_nonces (
            nonce_hash  text PRIMARY KEY,
            wallet      text NOT NULL,
            expires_at  timestamptz NOT NULL,
            used_at     timestamptz,
            created_at  timestamptz DEFAULT now()
        )
    `;

    // Sessions: short-lived access token + longer-lived, rotating refresh
    // token. Only `refresh_token_hash` is stored (never the raw token) —
    // matches the key-management discipline documented in
    // docs/BOTSPEND-REUSE-ASSESSMENT.md (verifying/agent-owner keys server-only,
    // never logged) applied here to session secrets instead of chain keys.
    await sql`
        CREATE TABLE IF NOT EXISTS sessions (
            id                  uuid PRIMARY KEY,
            user_id             uuid NOT NULL REFERENCES users(id),
            refresh_token_hash  text NOT NULL,
            created_at          timestamptz DEFAULT now(),
            expires_at          timestamptz NOT NULL,
            revoked_at          timestamptz,
            device_label        text,
            risk_metadata       jsonb
        )
    `;
    await sql`CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id)`;
}
