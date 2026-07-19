-- Phase 9 (verified ghost races): store each recorded run's canonical replay
-- (flat-encoded input trace + tick count) so a ghost can be served from it and
-- any past run can be independently re-verified later. Shape:
--   { "v": <replay schema version>, "ticks": <int>, "inputs": [tick, action, ...] }
-- Typical size is a few KB; bounded by the replay validator's 20k-input hard cap.
-- risk_hold rows keep their replay too — Phase 12's manual-review path needs the
-- trace, not just the derived numbers.
ALTER TABLE verified_runs ADD COLUMN IF NOT EXISTS replay jsonb;

-- One replay per grid, regardless of identity. Ghost replays are necessarily
-- public (racing a ghost means downloading its input log), and every player in a
-- grid shares one seed — so an exact copy of the leader's input log re-submitted
-- through a fresh ticket would re-simulate to the same result. This index makes
-- that a database-level rejection, closing the race two concurrent identical
-- submissions would win against an application-level check alone. Near-duplicate
-- (perturbed-copy) detection is behavioral-signals work, deferred to Phase 11.
-- De-duplicate before the unique index lands. verified_runs has never been
-- deployed to production (net-new in migration 0004) — the only rows that can
-- exist are local-dev/CI test data, where early fixtures reused one replay_hash
-- across attempts. Keep one row per (grid_id, replay_hash).
DELETE FROM verified_runs WHERE id NOT IN (
    SELECT DISTINCT ON (grid_id, replay_hash) id FROM verified_runs ORDER BY grid_id, replay_hash, created_at
);

CREATE UNIQUE INDEX IF NOT EXISTS verified_runs_grid_replay_uniq ON verified_runs (grid_id, replay_hash);
