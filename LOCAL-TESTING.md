# Local testing — the sim + verification loop

Everything runs on your machine. Docker holds the DBs; the API and game run from source.

## One-time
- Docker Desktop running (already started).
- `npm install` (root) and `cd server && npm install` — already done.

## Run it (3 terminals)

**1. Databases** (already up; this is idempotent):
```bash
npm run local:db          # Postgres :5432 + Redis :6379
```

**2. API** (leave running):
```bash
npm run local:api         # http://localhost:8787  (loads server/.env)
```

**3. Game**:
```bash
npm run dev               # http://localhost:8080
```
- **Sim-driven game (the new one):** http://localhost:8080/?sim=1
- **Classic game (unchanged):** http://localhost:8080/

Play `?sim=1`, die, let it submit. The run's input log goes to the API, which
re-simulates it and records the result.

## Watch verification (shadow mode by default)
```bash
curl -s -H "x-admin-key: local-admin-key" http://localhost:8787/api/admin/stats | jq .verify
```
- `match` should climb with each honest run, `mismatch` stays 0.
- `noreplay` counts classic-client submits (the `/?sim=1` client always sends a replay).

## One-shot self-check (no browser)
```bash
npm run local:verify      # plays a run, submits, asserts honest=match + tampered=mismatch
```

## Try ENFORCE mode
Uncomment `VERIFY_ENFORCE=true` in `server/.env`, restart the API (terminal 2).
Now the server uses the **re-simulated** score, the milestone requires a verified
run, replay mismatches are hidden, and bot-like input traces are flagged.

## Stop / reset
```bash
npm run local:db:down     # stop DBs (keep data)
docker compose down -v    # stop + wipe all local data
```

## Notes
- `server/.env` and `.env.local` are git-ignored (local only). The production
  build still uses `.env.production` (real API URL) — local config can't leak into it.
- If you edit anything under `src/sim/`, run `npm run sync-sim` so the server's
  copy matches before testing the verify loop.
