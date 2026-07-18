-- Wallet identity + SIWE (Phase 4). Net-new tables.
CREATE TABLE IF NOT EXISTS users (
    id                       uuid PRIMARY KEY,
    chain_id                 integer NOT NULL,
    wallet_address           text NOT NULL,
    display_name             text,
    display_name_normalized  text,
    status                   text NOT NULL DEFAULT 'active',
    created_at               timestamptz DEFAULT now(),
    last_seen_at             timestamptz DEFAULT now(),
    risk_state               text NOT NULL DEFAULT 'none',
    UNIQUE (chain_id, wallet_address)
);

CREATE UNIQUE INDEX IF NOT EXISTS users_display_name_idx
ON users (display_name_normalized) WHERE display_name_normalized IS NOT NULL;

CREATE TABLE IF NOT EXISTS auth_nonces (
    nonce_hash  text PRIMARY KEY,
    wallet      text NOT NULL,
    expires_at  timestamptz NOT NULL,
    used_at     timestamptz,
    created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
    id                  uuid PRIMARY KEY,
    user_id             uuid NOT NULL REFERENCES users(id),
    refresh_token_hash  text NOT NULL,
    created_at          timestamptz DEFAULT now(),
    expires_at          timestamptz NOT NULL,
    revoked_at          timestamptz,
    device_label        text,
    risk_metadata       jsonb
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
