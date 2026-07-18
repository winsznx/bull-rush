-- Schema-ready for Phase 6/7 (chain_jobs, the relayer's outbox) and Phase 10
-- (claims, reward entitlements). Unused until those phases land — created now
-- so the state machines in server/src/stateMachines.ts have a real table to
-- eventually govern, and so Phase 6/7/10 land as new code against an existing
-- table, not a new migration racing new feature code.
CREATE TABLE IF NOT EXISTS chain_jobs (
    id                uuid PRIMARY KEY,
    job_type          text NOT NULL,
    idempotency_key   text NOT NULL UNIQUE,
    payload           jsonb NOT NULL,
    status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'processing', 'submitted', 'confirmed', 'failed')),
    attempt_count     integer NOT NULL DEFAULT 0,
    next_attempt_at   timestamptz,
    transaction_hash  text,
    last_error        text,
    created_at        timestamptz DEFAULT now(),
    completed_at      timestamptz
);

CREATE INDEX IF NOT EXISTS chain_jobs_status_idx ON chain_jobs (status, next_attempt_at);

-- claim state machine: ELIGIBLE -> QUEUED -> SUBMITTED -> CONFIRMED
-- (server/src/stateMachines.ts).
CREATE TABLE IF NOT EXISTS claims (
    id                 uuid PRIMARY KEY,
    user_id            uuid NOT NULL REFERENCES users(id),
    season_id          text NOT NULL,
    asset              text NOT NULL,
    amount             numeric NOT NULL,
    merkle_index       integer NOT NULL,
    status             text NOT NULL DEFAULT 'eligible'
                       CHECK (status IN ('eligible', 'queued', 'submitted', 'confirmed')),
    claim_transaction  text,
    created_at         timestamptz DEFAULT now(),
    completed_at       timestamptz
);

CREATE INDEX IF NOT EXISTS claims_user_idx ON claims (user_id);

CREATE TABLE IF NOT EXISTS audit_logs (
    id          uuid PRIMARY KEY,
    actor       text NOT NULL,
    action      text NOT NULL,
    target      text,
    metadata    jsonb,
    created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs (created_at DESC);
