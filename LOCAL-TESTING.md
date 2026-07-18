# Local testing — the deterministic engine + mandatory verification

Everything runs on your machine. Docker holds the DBs; the API and game run from source.

The deterministic sim engine is the **only** engine used in production. The classic
(client-authoritative) engine is dev-only, opt-in via `?classic=1` — see
`src/sim/flag.ts`. Every competitive submission is a replay, re-simulated
server-side; the server never trusts a claimed distance/score/death-cause.

## One-time
- Docker Desktop running.
- `npm install` (root) and `cd server && npm install`.

## Run it (3 terminals)

**1. Databases** (idempotent):
```bash
npm run local:db          # Postgres :5432 + Redis :6379
npm run db:migrate        # applies server/migrations/*.sql (idempotent, tracked in schema_migrations)
```

Schema is managed entirely by versioned migrations now — there is no more boot-time
`CREATE TABLE IF NOT EXISTS`. The API refuses to start against a database with
pending migrations (`assertMigrationsApplied()` in `server/src/index.ts`), so this
step is required after every fresh `local:db` volume.

**2. API** (leave running):
```bash
npm run local:api         # http://localhost:8787  (loads server/.env)
```

**3. Game**:
```bash
npm run dev               # http://localhost:8080
```
- **Default (production path):** http://localhost:8080/ — the deterministic engine.
- **Classic engine, dev-only:** http://localhost:8080/?classic=1 — for visual/feel
  comparison only. Never reachable in a production build regardless of query string
  (see `src/sim/flag.test.ts`); never submits a score.

Play a run, die, let it submit. The run's canonical replay (seed, game version,
ruleset hash, input trace) goes to the API, which re-simulates it and derives the
distance/score/death-cause/rank from that alone.

## Watch verification
```bash
curl -s -H "x-admin-key: local-admin-key" http://localhost:8787/api/admin/stats | jq .verify
```
- `accepted` climbs with every submitted replay that passes the envelope check
  (whether or not the resulting run is later held as suspicious).
- `rejected.<reason>` breaks down envelope/structural rejections by reason
  (`wrong_seed`, `wrong_game_version`, `wrong_ruleset`, `wrong_schema_version`,
  `missing_input_log`, `out_of_order_tick`, `unknown_action`, `future_tick`,
  `excessive_log_size`, `impossible_action_frequency`).
- `gameVersion`/`rulesetHash` show what the running server currently expects —
  useful for confirming a deploy actually picked up a sim change.

## One-shot self-check (no browser)
```bash
npm run local:verify      # plays a run, submits it, then submits one with a wrong
                           # seed, and asserts the first is accepted and the second rejected
```

## Sim engine tooling
```bash
npm run sim:sync    # copy src/sim/* -> server/src/sim/* (run after editing src/sim)
npm run sim:check   # non-mutating: fails if the server copy has drifted
npm run sim:test    # vitest suite (determinism/replay/runner/e2e) + cross-process
                     # fingerprint check
```
`sim:check` and `sim:test` both run in CI (`.github/workflows/ci.yml`) and
`sim:check` also runs as part of `npm run build`.

## Daily Grid + wallet auth
Entering Daily Grid requires connecting a wallet and signing a SIWE message —
practice play never does. For this to work against a local API, `server/.env`
needs `SITE_DOMAIN=localhost:8080` and `GAME_URL=http://localhost:8080` (the
SIWE message's domain/URI are checked against these). A browser wallet
extension (MetaMask or similar, using the injected provider) is needed to
actually click through the flow in-browser.

```bash
npm test              # fast unit tests, incl. server/src/siwe.test.ts (no DB needed)
npm run test:integration   # grid + auth lifecycle against real Postgres+Redis
                            # (server/src/{grid,auth}.integration.test.ts)
```

## Stop / reset
```bash
npm run local:db:down     # stop DBs (keep data)
docker compose down -v    # stop + wipe all local data
```

## Notes
- `server/.env` and `.env.local` are git-ignored (local only). The production
  build still uses `.env.production` (real API URL) — local config can't leak into it.
- There is no more shadow/enforce toggle. Verification is mandatory and unconditional
  — a submission without a valid, matching replay is rejected, full stop.
- Session cookies require credentialed CORS (`ALLOWED_ORIGIN` must be a real
  origin, not `*`) — already the case in every deployed environment.
