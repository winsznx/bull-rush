-- Phase 11 (behavioral risk signals). `risk_reasons` records exactly WHY a run
-- was shadow-held (too_fast / too_long / bot_like_cadence / near_duplicate_replay)
-- so Phase 12's manual review reads evidence, not a bare boolean.
--
-- `ip_hint` is a salted hash prefix of the submitting IP (never the raw IP):
-- enough to see that N distinct wallets on one grid share a network origin —
-- a sybil review signal, deliberately NOT an automatic hold, since households
-- and cafés legitimately share IPs. NULL when IP_HINT_SALT is unset.
ALTER TABLE verified_runs ADD COLUMN IF NOT EXISTS risk_reasons text[] NOT NULL DEFAULT '{}';
ALTER TABLE verified_runs ADD COLUMN IF NOT EXISTS ip_hint text;

CREATE INDEX IF NOT EXISTS verified_runs_ip_hint_idx ON verified_runs (grid_id, ip_hint) WHERE ip_hint IS NOT NULL;
CREATE INDEX IF NOT EXISTS verified_runs_risk_idx ON verified_runs (created_at DESC) WHERE status = 'risk_hold';
