-- Daily Grid lifecycle (Phase 3). Net-new table — does not exist in
-- production yet, so this creates its final form directly.
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
);
