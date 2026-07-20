# ADR 0004: Wallet stack (wagmi/viem) and SIWE session design

## Status
Accepted

## Context
Phase 4 needed to replace the `identity_key` placeholder (Phase 3, ADR 0003)
with real wallet-derived identity, and needed a wallet-connection stack. The
task brief said to prefer viem/wagmi "where they already exist and work
correctly" — BotSpend's `web/package.json` pins `viem ^2.21.0` and
`wagmi ^2.14.0` against BOT Chain successfully (independently re-verified in
Phase 0). This ADR records the stack choice, the dependency-vulnerability
assessment that choice surfaced, and the session design built on top of it.

## Decision: match BotSpend's wallet stack, injected-connector-only

Installed `viem`, `wagmi`, `@tanstack/react-query` (wagmi v2's required peer)
at the same major versions BotSpend uses. `src/wallet/wagmiConfig.ts`
registers only the bare `injected()` connector — no WalletConnect, no
MetaMask SDK deep-linking — mirroring BotSpend's own minimal choice
(`web/lib/wagmi.ts`: `connectors: [injected()]`).

### The dependency-vulnerability finding, and why it doesn't block this decision

`npm install` surfaced 21 `npm audit` findings (20 moderate, 1 high) the
moment `wagmi` was installed. Investigated rather than ignored or
force-upgraded:

1. `wagmi`'s `package.json` hard-depends on `@wagmi/connectors` (there is no
   way to install `wagmi` without it landing in `node_modules`).
2. Every flagged vulnerability traces back to `@wagmi/connectors`' **optional**
   `metaMask.js` and `walletConnect.js` connector modules (MetaMask SDK's
   `uuid` usage, WalletConnect's `ws` usage) — confirmed by inspecting
   `node_modules/@wagmi/connectors/dist/esm/injected.js` directly: it has
   **zero** imports of `metamask-sdk` or `@walletconnect/*`. Those live in
   sibling files this project's `wagmiConfig.ts` never imports.
3. Confirmed empirically, not just theoretically, in the actual **built
   production bundle** (`npm run build`, then `grep` the output): zero
   occurrences of the vulnerable packages' distinctive runtime code (`ws`'s
   `WebSocketBrowser`, `uuid`'s generation internals, WalletConnect's
   `RelayPersistence`/`sdk-communication-layer`). The only related strings
   present are (a) `WalletConnectSessionSettlementError` — a generic error-
   class **name** wagmi/viem define as part of a broad error taxonomy, never
   thrown by code that's actually reachable, and (b) a `coinbaseWallet: {id,
   name, provider}` entry in a wallet-ID **display/detection metadata table**
   (EIP-6963 multi-injected-provider discovery — used to show a recognized
   wallet's name if it announces itself, not to run its SDK). Neither
   executes the vulnerable code paths.

**Decision: keep the vulnerable packages in the dependency tree (harmless —
they compile to nothing reachable) rather than force `wagmi@3.x` (a breaking
change, unevaluated against BOT Chain) mid-migration.** Tracked, not ignored:
`npm audit` runs in CI (`.github/workflows/ci.yml`, `game` job) with
`continue-on-error` — informational, not a blocking gate, specifically
because this exact finding is assessed-safe; a *different* future finding
would still show up in CI output for a human to triage. Revisit wagmi v3 as a
deliberate, separately-tested upgrade, not a forced side effect of a security
scan false-positive-in-practice.

## Decision: SIWE is hand-rolled (message builder + parser), not the `siwe` npm package

EIP-4361 is a public, stable text format. `src/wallet/siwe.ts` builds the
message client-side; `server/src/siwe.ts` parses and verifies it
server-side, using `viem`'s `verifyMessage` for the actual signature check.
The two sides share the *format*, not code — there is nothing to keep in
sync the way `src/sim/` needs `sim:sync`, since EIP-4361 doesn't change.
Avoids pulling in the `siwe` package's own dependency tree (historically
ethers-based) for a format simple enough to parse with a handful of regexes,
covered by 8 unit tests including a genuinely-signed message (via a
throwaway test key, `viem/accounts`), a forged-signature rejection, wrong-
domain/chain rejections, and expiry bounds.

## Decision: two-tier session — short Redis-backed access token, rotating Postgres-backed refresh token

- **Access**: opaque random token, Redis-only (`auth:access:{token}` →
  `{sessionId, userId, chainId, walletAddress}`), 15-minute TTL. Checked on
  every session-gated request — cheap (one Redis GET), matching this
  project's existing hot-path pattern (run tokens, grid tickets) rather than
  a JWT that would need its own signing-key management for no real benefit
  at this scale.
- **Refresh**: opaque random token, only its SHA-256 **hash** ever stored
  (`sessions.refresh_token_hash`) — the raw token exists only in the HTTP-only
  cookie and the moment it's minted. 30-day TTL, single-use rotation: every
  `POST /api/auth/refresh` call replaces the stored hash with a new one and
  mints a fresh access token, so replaying an already-rotated raw refresh
  token fails outright (its hash no longer matches any row) — proven in
  `server/src/auth.integration.test.ts` against a real Postgres.
- **Cookies**: `br_session` (`Path=/`, access token) and `br_refresh`
  (`Path=/api/auth`, refresh token, deliberately scoped narrower) — both
  `HttpOnly`, `SameSite=Lax`, `Secure` in production. CORS updated to
  `credentials: true` (required for cookies to cross the game/API origin
  split) — noted in-code that this only works once `ALLOWED_ORIGIN` is a real
  origin, not `*`, which is already required in every deployed environment.
- **Explicit revocation**: `POST /api/auth/logout` deletes the Redis access
  entry and sets `sessions.revoked_at` — proven to immediately invalidate
  both tokens, not just let them expire naturally.

**Simplification made explicitly, not by accident:** full refresh-token
**reuse-detection** (if a rotated-away token is replayed, treat it as a signal
the whole session was compromised and revoke every session for that user) was
**not** built. Today's rotation prevents simple replay but doesn't yet detect
and respond to theft-and-race. Documented here as a deferred hardening, not
silently dropped.

## Decision: `identity_key` becomes real — `${chainId}:${walletAddress}`

`/api/grid/ticket` and `/api/grid/submit` now require a valid session
(`requireGridSession`, checked before any other logic) and derive
`identityKey` from the resolved session, never from a client-supplied field.
`/api/grid/submit` additionally checks the consumed ticket's stored
`identity_key` matches the current session's — closing the gap where a
ticket issued to one identity could otherwise be submitted under another's
name. **Practice play and the pre-existing global leaderboard remain fully
unauthenticated** — guest players can still play immediately with zero
friction, per the product's own wallet-UX spec ("guest players can play
practice... cannot enter the reward-bearing leaderboard"); Daily Grid is the
one surface Phase 4 gates, because it's the one surface Phase 3 already
identified as needing real identity before anything of value attaches to it.

## Verification
`server/src/siwe.test.ts` (8 tests, pure logic, real cryptographic
signatures via a throwaway test key — not mocked) and
`server/src/auth.integration.test.ts` (6 tests, against a real local
Postgres + Redis): session creation, nonce single-use, refresh rotation
(old token provably dead after use), revocation (both tokens dead
immediately), and display-name validation (reserved names, case-insensitive
uniqueness, minimum length). Beyond the test suites, the full HTTP path was
exercised live against a real running server: request nonce → sign a genuine
SIWE message with a throwaway wallet → verify → receive session cookies →
confirm an unauthenticated grid-ticket request is rejected (401) →confirm
the same request with the session cookie passes the auth gate → refresh
(confirmed the access token actually changes) → logout (confirmed the
session no longer resolves).

## What was NOT built, and why
- Refresh-token reuse-detection / session-family revocation (noted above).
- WalletConnect / mobile wallet support — the task said "only if mobile
  support requires it"; not evaluated yet, and doing so now would reintroduce
  exactly the dependency tree just assessed as unnecessary risk.
- BO Wallet-specific testing. `injected()` covers any EIP-1193-compliant
  injected provider, which BO Wallet may or may not expose identically to
  MetaMask — Phase 0's network-validation doc already flagged this as
  unconfirmed and it remains unconfirmed; must be tested against the actual
  BO Wallet extension before launch.
- Rate-limiting is per-IP (existing `rateLimit` helper) for nonce/verify/
  display-name, not yet per-wallet — acceptable for now since nothing of
  value is reachable without a real signature regardless of request volume.
