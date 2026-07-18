-- Named `verified_runs` (not `grid_runs`, its working name through Phase 3/4)
-- to match this project's own target schema from the start — net-new table,
-- never deployed under the old name, so no rename-in-place was needed.
--
-- `status` replaces the old plain `suspicious` boolean with the real
-- verified_run state machine (see server/src/stateMachines.ts): `risk_hold`
-- is exactly the old `suspicious = true`, `verified` is the old
-- `suspicious = false`. `received`/`verifying` are legal states but never
-- persisted today — this codebase verifies synchronously within one request,
-- so a row is only ever inserted already at `verified` or `risk_hold`.
-- `receipt_queued`/`submitted`/`confirmed` are unreachable until Phase 6/7's
-- contracts + relayer exist; modeled now so the column doesn't need to change
-- shape later.
--
-- Consolidates the original spec's separate verification/risk/receipt status
-- fields into one `status` enum, since all three were really one lifecycle —
-- documented as a deliberate simplification, not an oversight.
CREATE TABLE IF NOT EXISTS verified_runs (
    id                uuid PRIMARY KEY,
    grid_id           uuid NOT NULL REFERENCES daily_grids(id),
    ticket_id         uuid NOT NULL REFERENCES run_tickets(id),
    identity_key      text NOT NULL,
    game_version      text NOT NULL,
    replay_hash       text NOT NULL,
    distance          integer NOT NULL,
    score             integer NOT NULL,
    max_combo         integer DEFAULT 0,
    death_cause       text,
    duration_ms       integer DEFAULT 0,
    is_personal_best  boolean DEFAULT false,
    replay_len        integer DEFAULT 0,
    status            text NOT NULL DEFAULT 'received'
                      CHECK (status IN ('received', 'verifying', 'verified', 'risk_hold', 'receipt_queued', 'submitted', 'confirmed')),
    receipt_tx_hash   text,
    created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS verified_runs_grid_idx ON verified_runs (grid_id, distance DESC);
CREATE INDEX IF NOT EXISTS verified_runs_replay_hash_idx ON verified_runs (replay_hash);
