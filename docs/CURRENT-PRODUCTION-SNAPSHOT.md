# Current Production Snapshot

Captured at the start of the BOT Chain migration, before any code in this migration was written.
This is a point-in-time backup record, not a living document — update only if a rollback reference
is needed.

## Source

- Assessed commit: `e6e0468` (branch `main` at the time this migration started)
- Migration branch: `feat/botchain-mainnet-skill-rewards` (created from `e6e0468`)
- GitHub: `winsznx/bull-rush`

## Live deployment state (verified via external HTTP/RPC calls, this session)

| Target | State |
|---|---|
| `https://trybullrush.xyz/` | HTTP 200 |
| `https://api.trybullrush.xyz/health` | `{"ok":true,"startedAt":1783177712329}` |
| Production JS bundle | `assets/index-boYqJevm.js` |
| Production CSS bundle | `assets/index-nx1gksw1.css` |
| API `VERIFY_ENFORCE` | `false` (shadow mode) — per the prior assessment; not re-flipped by this snapshot |
| API deploy target | Railway, service `bull-rush-api` (per README + prior session context) |
| Frontend deploy target | Cloudflare Pages, project `bull-rush` |
| Deploy mechanism | **Manual CLI** (`wrangler pages deploy`, `railway up`) — no CI/CD exists |

## Postgres schema assumptions (current, pre-migration)

Table `runs` (defined in `server/src/db.ts`, created via boot-time `CREATE TABLE IF NOT EXISTS` +
inline `ALTER TABLE ADD COLUMN IF NOT EXISTS` — **no migration tool is in use today**):

```
id            uuid PRIMARY KEY
name          text NOT NULL
distance      integer NOT NULL
score         integer NOT NULL
rank          text NOT NULL
death_cause   text
jeets_dodged  integer DEFAULT 0
snipers_survived integer DEFAULT 0
mev_avoided   integer DEFAULT 0
max_combo     integer DEFAULT 0
duration_ms   integer DEFAULT 0
wallet        text        -- always NULL today; no producer populates it
referrer      text
suspicious    boolean DEFAULT false
verified      boolean DEFAULT false   -- added by the replay-verification work; always false in
                                       -- shadow mode since enforcement never sets it true in the
                                       -- production-used path
replay_len    integer DEFAULT 0
created_at    timestamptz DEFAULT now()
```

Indexes: `runs_distance_idx (distance DESC)`, `runs_created_idx (created_at DESC)`.

**This schema will be superseded, not incrementally bolted onto, by Phase 5's versioned migration
set** (`users`, `auth_nonces`, `sessions`, `daily_grids`, `run_tickets`, `verified_runs`,
`chain_jobs`, `claims`, `audit_logs`). The existing `runs` table's historical rows are the migration
source, not the ongoing store.

## Redis schema assumptions (current, pre-migration)

Key patterns, from `server/src/redis.ts`:

| Pattern | Purpose | TTL |
|---|---|---|
| `seed:{token}` | One-time run-start token → `{seed, t, ip}` | 3600s |
| `lb:alltime` | Sorted set, member=display name, score=best distance | none |
| `lb:daily:{YYYY-MM-DD}` | Same, daily bucket | 2 days |
| `lb:weekly:{epoch-week-bucket}` | Same, weekly bucket | 9 days |
| `lb:squad:{code}` | Same, per-referral-code bucket | 30 days |
| `rl:{route}:{ip}:{window}` | Fixed-window rate-limit counter | window length |
| `milestone:20km` | First-to-20km claim record | none |
| `verify:match` / `verify:mismatch` / `verify:noreplay` / `verify:bot` | Shadow-mode verification counters | none |
| `verify:recent` | List of the last 50 verification mismatches | none |

**This will be superseded by the `chain_jobs` outbox pattern and the new Postgres tables for
anything that needs durable, reconciled state.** Redis remains appropriate for the leaderboard
cache and rate limiting, not for anything that must survive a Redis flush without a rebuild path.

## Environment variables currently in use (names only — no values recorded)

**Server (Railway), from `server/src/index.ts` / `server/src/db.ts` / `server/src/redis.ts`:**
`DATABASE_URL`, `DATABASE_SSL`, `REDIS_URL`, `ALLOWED_ORIGIN`, `ADMIN_KEY`, `GAME_URL`, `PORT`,
`VERIFY_ENFORCE`.

**Client (Cloudflare Pages), from `vite.config.ts` / `.env.production`:** `VITE_API_URL`.

**Documented but not consumed by any code** (see prior assessment): `HMAC_SECRET` — README claims
the API reads it; `grep -rn "HMAC_SECRET" server/src` returns nothing. Either a dropped design or
stale docs. Flagged, not resolved, by this snapshot.

**New variables this migration will need to define** (names to be finalized in Phase 5/6/7,
recorded here as a placeholder so the eventual `.env.example` template has a checklist):
`RPC_URL_MAINNET`, `RPC_URL_TESTNET`, `BUNDLER_URL` (if gas sponsorship is attempted),
`VERIFIER_SIGNER_KEY`, `RELAYER_KEY`, `DEPLOYER_KEY` (deploy-time only, never in a running service),
`DAILY_GRID_REGISTRY_ADDRESS`, `VERIFIED_RUN_REGISTRY_ADDRESS`, `SEASON_PRIZE_VAULT_ADDRESS`,
`SESSION_COOKIE_SECRET`, `SIWE_DOMAIN`.

## Rollback reference

If any part of this migration needs to be reverted, the pre-migration state is:
- Git: commit `e6e0468` on `main`.
- Production: the currently-live Cloudflare Pages deployment and Railway service, both deployed
  from `e6e0468`-equivalent source (per the bundle hash captured above) at the time this file was
  written. This file is the record of that fact; it does not itself restore anything.
