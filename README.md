# 🐂 BULL RUSH

Bull Rush is a **verifiable skill runner** built on BOT Chain. Every Daily Grid gives players the same deterministic course, every competitive run is replay-verified, and sponsor-funded rewards settle through transparent onchain prize vaults.

**Same grid. Prove the run.**

**Play:** [trybullrush.xyz](https://trybullrush.xyz)

## Onchain (BOT Chain mainnet, chain 677)

| Contract | Address |
|---|---|
| `DailyGridRegistry` | [`0x9794a7E9bECE87dEe375fE6Eb55620f8Aa788172`](https://scan.botchain.ai/address/0x9794a7e9bece87dee375fe6eb55620f8aa788172) |
| `VerifiedRunRegistry` | [`0xcce26fFAd015ee01A4c0BEe9aaEd28C9785D43aF`](https://scan.botchain.ai/address/0xcce26ffad015ee01a4c0bee9aaed28c9785d43af) |
| `SeasonPrizeVault` | [`0x50D4129474c6204c870c7F141B9A6BE68264b6Ee`](https://scan.botchain.ai/address/0x50d4129474c6204c870c7f141b9a6be68264b6ee) |

All three source-verified on BOTScan. Deployment evidence: [`docs/MAINNET-DEPLOYMENT.md`](docs/MAINNET-DEPLOYMENT.md).

> **Status:** the contracts are live, but the migration branch
> (`feat/botchain-mainnet-skill-rewards`) is **not yet deployed** — the production URL currently
> serves the pre-migration build, and no relayer is running. See
> [`docs/submission/TESTING-STATUS.md`](docs/submission/TESTING-STATUS.md) for exactly what is and
> isn't live.

---

## Stack

- **Game (frontend):** React 19 + [React Three Fiber](https://github.com/pmndrs/react-three-fiber) + three.js + `@react-three/postprocessing` (bloom) + zustand + Vite. Deployed as a static site on **Cloudflare Pages**.
- **API (backend):** [Hono](https://hono.dev) on Node + **Redis** (leaderboards via sorted sets, rate limiting, one-time run tokens) + **Postgres** (source of truth). Deployed on **Railway**.
- **Share cards:** dynamic OG image rendered server-side with `@napi-rs/canvas`.

## Project layout

```
src/                 # the game (R3F)
  three/             # Canvas, Bull, Track, Obstacles, Game
  ui/                # HTML/CSS overlays (menu, tutorial, HUD, board, Daily Grid, share)
  sim/               # deterministic engine (shared byte-identical with the server)
  wallet/            # wagmi config, BOT Chain defs, SIWE, useAuth
  data/              # ranks, hazards
  store.ts           # zustand game state + per-frame refs
  api.ts             # thin client for the API (offline-safe)
functions/           # Cloudflare Pages Function (/s share page)
server/              # the Hono API (routes, redis, postgres, replay verification, chain relayer)
  migrations/        # versioned SQL, applied explicitly (never at boot)
contracts/           # Foundry: DailyGridRegistry, VerifiedRunRegistry, SeasonPrizeVault
public/              # static assets (skybox, textures, logo, favicon, styles)
```

## Local development

**Game:**
```bash
npm install
npm run dev          # http://localhost:8080
```

**API** (needs Redis + Postgres; uses the Railway ones via the CLI):
```bash
cd server
npm install
railway run npm run dev
```

Environment: the game reads `VITE_API_URL` (in `.env.production`) — the public API base. The API reads `DATABASE_URL`, `REDIS_URL`, `HMAC_SECRET`, `ALLOWED_ORIGIN`, `GAME_URL` (all set in Railway, never committed).

## Build & deploy

```bash
npm run build                                   # game -> dist/
npx wrangler pages deploy dist --project-name bull-rush --branch main   # -> Cloudflare Pages

cd server && railway up --service bull-rush-api # API -> Railway
```

## A note on the music 🎵

The production soundtrack is **not** included in this repo and, as of this migration, **must not
be deployed** until it is replaced with licensed or commissioned music — see
[`ASSET_PROVENANCE.md`](./ASSET_PROVENANCE.md) for the full status of every audio/visual asset and
[`scripts/check-forbidden-assets.mjs`](./scripts/check-forbidden-assets.mjs), which fails the build
if any of the known-unlicensed filenames are present. SFX are synthesized in-browser, so the game
runs fine without any music files at all. If you have your own licensed tracks, drop them into
`public/assets/audio/music/` matching the names in `src/audio.ts` (`super-rush`, `butterfly-war`,
`night-cloud`, `green-motion`, `vamp-charge`) — those are mood-slot labels only, not song titles.

## Rewards

Rewards are funded before each competition and distributed only from verified results. Playing
does not guarantee a reward, and Bull Rush does not issue an inflationary game token.

## License

[MIT](./LICENSE)

*Not financial advice. Not an investment.*
