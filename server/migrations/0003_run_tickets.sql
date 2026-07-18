-- run_ticket state machine: ISSUED -> CONSUMED | EXPIRED (see
-- server/src/stateMachines.ts for the transition rules this constraint
-- mirrors). Net-new table.
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
    status        text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'consumed', 'expired'))
);

CREATE INDEX IF NOT EXISTS run_tickets_identity_idx ON run_tickets (identity_key);
CREATE INDEX IF NOT EXISTS run_tickets_sweep_idx ON run_tickets (status, expires_at) WHERE status = 'issued';
