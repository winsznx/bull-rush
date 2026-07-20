-- Reproduces the `runs` table exactly as it exists in production today
-- (including the `verified`/`replay_len` columns added by a later ad hoc
-- ALTER TABLE, folded directly into the CREATE here). CREATE TABLE IF NOT
-- EXISTS is a no-op against the real production database, which already has
-- this table with this exact shape — this migration exists so a *fresh*
-- database (local/CI) reaches the same state via the same migration history,
-- not so production changes.
CREATE TABLE IF NOT EXISTS runs (
    id               uuid PRIMARY KEY,
    name             text NOT NULL,
    distance         integer NOT NULL,
    score            integer NOT NULL,
    rank             text NOT NULL,
    death_cause      text,
    jeets_dodged     integer DEFAULT 0,
    snipers_survived integer DEFAULT 0,
    mev_avoided      integer DEFAULT 0,
    max_combo        integer DEFAULT 0,
    duration_ms      integer DEFAULT 0,
    wallet           text,
    referrer         text,
    suspicious       boolean DEFAULT false,
    created_at       timestamptz DEFAULT now(),
    verified         boolean DEFAULT false,
    replay_len       integer DEFAULT 0
);

CREATE INDEX IF NOT EXISTS runs_distance_idx ON runs (distance DESC);
CREATE INDEX IF NOT EXISTS runs_created_idx ON runs (created_at DESC);
