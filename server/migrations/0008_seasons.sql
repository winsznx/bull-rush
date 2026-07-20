-- Phase 10 (Season Zero, Merkle entitlements). A season is the narrowly-scoped
-- reward unit the locked economy decisions require: pre-funded, capped, rules
-- published before the window opens, entitlements computed only from
-- independently verified runs after it closes.
--
-- `asset` is a token address; address(0) = native BOT (same sentinel as
-- SeasonPrizeVault.NATIVE). `cap_wei` is the publicly visible ceiling — the
-- entitlement computation allocates out of exactly this number, and the vault
-- contract independently enforces it again at claim time.
CREATE TABLE IF NOT EXISTS seasons (
    id                text PRIMARY KEY,
    name              text NOT NULL,
    asset             text NOT NULL,
    cap_wei           numeric NOT NULL,
    starts_at         timestamptz NOT NULL,
    ends_at           timestamptz NOT NULL,
    claim_window_end  timestamptz,
    merkle_root       text,
    status            text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'closed')),
    created_at        timestamptz DEFAULT now(),
    closed_at         timestamptz
);

-- One claim row per user per season; merkle_index addresses the leaf in the
-- season's tree, so it must be unique within the season too. The full ordered
-- (season_id, merkle_index) claim set IS the leaf set — proofs are recomputed
-- from these rows on demand, never stored.
CREATE UNIQUE INDEX IF NOT EXISTS claims_season_user_uniq ON claims (season_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS claims_season_index_uniq ON claims (season_id, merkle_index);
