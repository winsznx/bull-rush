-- Marks when a closed grid's final standings were settled on-chain (the
-- 'top_n' receipt policy — see server/src/receiptPolicy.ts). Nullable and
-- defaulted to NULL so every existing grid is simply "not settled yet", which
-- is accurate: they predate the policy.
ALTER TABLE daily_grids ADD COLUMN IF NOT EXISTS settled_at timestamptz;

-- Supports the "closed but unsettled" sweep without scanning the table.
CREATE INDEX IF NOT EXISTS daily_grids_unsettled_idx
    ON daily_grids (closes_at)
    WHERE settled_at IS NULL;
