# Release checklist

The complete gate for shipping Bull Rush (game client + API) to production. Deploys are
currently operator-run (Railway for the API, static hosting for the client); this checklist is
the pipeline until automation replaces the manual steps — at which point each item becomes a
pipeline stage, not a suggestion.

## 1. Pre-release gate (one command)

```bash
npm run local:db        # Postgres + Redis up (integration tests need them)
npm run release:check
```

`release:check` runs, in order, and stops at the first failure:

| Step | What it proves |
|------|----------------|
| gitleaks (full history) | no secret has ever been committed (`.gitleaks.toml` allowlists only justified, documented entries) |
| typecheck ×2 | game + server compile clean |
| sim:check | client and server deterministic engines are byte-identical |
| unit tests | fast suite, no services |
| sim tests + fingerprint | determinism holds across processes |
| forge fmt + forge test | contracts clean, 43 tests green |
| integration tests | grid/auth/relayer/season/admin flows against real Postgres + Redis + anvil |
| production build | includes the forbidden-asset check (the 5 unlicensed local mp3s cannot ship), with those local files moved aside and restored automatically |

Also run the live end-to-end loop against a local server:

```bash
npm run local:api        # separate terminal
npm run local:verify:grid
```

Expect the final line: `✅ WALLET + GRID + ... LOOP WORKS`.

## 2. Database migrations — BEFORE deploying code

Migrations are an explicit step, never automatic at boot (ADR 0005). The server **refuses to
start** against a database with pending migrations, so order matters:

```bash
DATABASE_URL=<production url> DATABASE_SSL=true npm run db:migrate
```

- Review `server/migrations/` diff since the last release first.
- Migrations are forward-only; there is no `down`. A bad migration is fixed by a new one.
- The deploy that follows must be the code version those migrations were written for.

## 3. Deploy

1. **API** (Railway): deploy the new server code. Boot runs `assertMigrationsApplied()` — a
   forgotten step 2 fails loudly here, before traffic.
2. **Client**: `npm run build` output (`dist/`) to static hosting. Never commit `dist/`.
3. Environment changes (new vars this cycle) go in BEFORE the deploy that reads them:
   `ADMIN_WRITE_KEY`/`ADMIN_READ_KEY` (supersede `ADMIN_KEY`), `IP_HINT_SALT`, `LOG_LEVEL`,
   and — Phase 15 only, gated — `CHAIN_RELAYER_ENABLED` + relayer vars.

## 4. Post-deploy verification

```bash
curl -s https://<api-host>/status | jq .
```

- `ok: true`, both dependencies healthy with sane latencies, expected `gameVersion`.
- Play one practice run end-to-end in a real browser; confirm the score verifies.
- `GET /api/admin/metrics` (read key): requests flowing, no error-counter jumps.
- `GET /api/admin/audits` (read key): the trail is recording.

## 5. Rollback

- **Code**: redeploy the previous image/build (Railway keeps deploy history). Safe at any
  point — migrations are additive, so old code runs against the new schema.
- **Migrations**: never rolled back. If a migration itself is the problem, ship a corrective
  migration forward.
- **Leaderboard state**: Redis is a rebuildable cache — `POST /api/admin/rebuild` restores it
  from Postgres if it was polluted during a bad window.

## Staging (not yet provisioned)

A staging environment (separate Railway service + Postgres/Redis + a staging client build
against BOT Chain **testnet 968**) is specified but not stood up — provisioning touches the
production Railway account and is an operator decision. When created, every step above runs
against staging first; production deploys only follow a green staging pass. Until then, the
local stack (`local:db` + `local:api` + `local:verify:grid`) is the pre-production environment.

## CI relationship

Every push/PR runs the same gates in `.github/workflows/ci.yml` (secret scan, game, server,
integration with real service containers, contracts). `release:check` exists so the operator
runs the identical set locally at release time without reconstructing it from memory.
