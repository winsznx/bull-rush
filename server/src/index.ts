import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { sql } from './db.ts';
import { assertMigrationsApplied } from './migrate.ts';
import {
    redis,
    LB,
    rateLimit,
    recordScore,
    topScores,
    rebuildLeaderboards,
    claimMilestone,
    getMilestone,
    MILESTONE_DISTANCE,
} from './redis.ts';
import { rankFor } from './ranks.ts';
import { simulate, type Act, type InputEvent } from './sim/sim.ts';
import { verifyReplayEnvelope } from './sim/verify.ts';
import { REPLAY_SCHEMA_VERSION, replayHash, encodeInputsFlat, type RunReplay } from './sim/replay.ts';
import { GAME_VERSION, RULESET_HASH } from './sim/ruleset.ts';
import {
    openGrid,
    getCurrentGrid,
    issueTicket,
    consumeTicket,
    recordVerifiedRun,
    getVerifiedRunStatus,
    getGridLeaderboard,
    countVerifiedGridPlayers,
    sweepExpiredTickets,
    gridHasReplayHash,
    getGridGhost,
} from './grid.ts';
import { listChainJobs } from './chain/outbox.ts';
import { drainJobs, startRelayerLoop } from './chain/relayer.ts';
import { loadChainConfig } from './chain/client.ts';
import { createSeason, closeSeason, getLatestSeason, getRewardsForUser } from './seasons.ts';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import {
    issueNonce,
    verifyAndCreateSession,
    resolveAccessToken,
    refreshSession,
    revokeSession,
    setDisplayName,
    BOT_CHAIN_MAINNET_ID,
    type SessionTokens,
} from './auth.ts';

// A run can't plausibly last longer than this (a policy cap, stricter than the
// engine's own technical ceiling in sim.ts/replay.ts), and its derived duration
// can't exceed how long the token actually existed (+ slack for the game-over
// screen, name entry, and network). Together these kill crafted, absurdly-long runs.
const MAX_RUN_MS = 1_800_000;
const RUN_TIME_SLACK_MS = 30_000;

// Share-card assets (bundled, loaded once at boot).
const ASSET_DIR = join(dirname(fileURLToPath(import.meta.url)), '../assets');
GlobalFonts.registerFromPath(join(ASSET_DIR, 'anton.ttf'), 'Anton');
const cardBase = await loadImage(readFileSync(join(ASSET_DIR, 'card-base.jpg')));

const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Log-only bot signals on the (already replay-verified) trace: robotic regularity
// or superhuman input rate. Reaction-time-vs-obstacle analysis is a later add.
function botLike(inputs: InputEvent[], endTick: number): boolean {
    if (inputs.length < 30) return false;
    const gaps: number[] = [];
    for (let i = 1; i < inputs.length; i++) gaps.push(inputs[i].tick - inputs[i - 1].tick);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (mean <= 0) return true;
    const variance = gaps.reduce((a, g) => a + (g - mean) * (g - mean), 0) / gaps.length;
    const cv = Math.sqrt(variance) / mean;
    const perSec = inputs.length / (endTick / 60 || 1);
    return cv < 0.06 || perSec > 12;
}

const app = new Hono();

const allow = (process.env.ALLOWED_ORIGIN || '*').split(',').map((s) => s.trim());
app.use(
    '*',
    cors({
        origin: (o) => (allow.includes('*') ? o || '*' : allow.includes(o) ? o : allow[0] || ''),
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: ['Content-Type'],
        // Session cookies require credentialed CORS. Browsers reject a wildcard
        // origin combined with credentials, so this only actually works once
        // ALLOWED_ORIGIN is set to a real origin list (already required in
        // every deployed environment) — harmless if still '*' in a from-scratch
        // local setup, since cookie-based auth just won't work until it's set.
        credentials: true,
    }),
);

const SITE_DOMAIN = process.env.SITE_DOMAIN || 'trybullrush.xyz';
const SITE_URL = process.env.GAME_URL || 'https://trybullrush.xyz';
const ACCESS_COOKIE = 'br_session';
const REFRESH_COOKIE = 'br_refresh';
const isProd = process.env.NODE_ENV === 'production';

function setSessionCookies(c: Parameters<typeof setCookie>[0], tokens: SessionTokens): void {
    setCookie(c, ACCESS_COOKIE, tokens.accessToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: 'Lax',
        path: '/',
        expires: new Date(tokens.accessExpiresAt),
    });
    setCookie(c, REFRESH_COOKIE, tokens.refreshToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: 'Lax',
        path: '/api/auth',
        expires: new Date(tokens.refreshExpiresAt),
    });
}

const ipOf = (c: { req: { header: (k: string) => string | undefined } }) =>
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'anon';

const BOOT_TIME = Date.now();
app.get('/', (c) => c.text('BULL RUSH API — charge.'));
app.get('/health', (c) => c.json({ ok: true, startedAt: BOOT_TIME }));

app.post('/api/run/start', async (c) => {
    const ip = ipOf(c);
    if (!(await rateLimit(ip, 'start', 60, 60))) return c.json({ error: 'rate_limited' }, 429);

    const token = randomUUID();
    const seed = (`0x${randomBytes(16).toString('hex')}`) as `0x${string}`;
    // TTL must exceed the longest possible run — a marathon past ~9500m takes
    // several minutes, and a short TTL silently dropped those high scores.
    // Token is single-use (getdel on submit), so a generous window is safe.
    await redis.set(`seed:${token}`, JSON.stringify({ seed, t: Date.now(), ip }), 'EX', 3600);
    return c.json({ seed, token });
});

const ReplaySchema = z.object({
    schemaVersion: z.number().int(),
    gameVersion: z.string().max(32),
    rulesetHash: z.string().regex(/^0x[0-9a-f]+$/i),
    seed: z.string().regex(/^0x[0-9a-f]+$/i),
    runId: z.string().max(64),
    inputs: z
        .array(z.object({ tick: z.number().int().min(0).max(200_000), action: z.number().int() }))
        .max(20_000),
    ticks: z.number().int().min(0).max(60 * 60 * 45),
});

// Shared identity sanitizer. Used both for the practice leaderboard's display
// name and — until Phase 4 introduces real wallet-keyed identity — as the
// Daily Grid's `identity_key`. Same caveat applies in both places: a raw,
// unauthenticated string is spoofable/collidable (see the project's own
// documented assessment of this limitation), which is exactly why grid
// rewards are gated behind Phase 4 landing before anything of value attaches
// to a `identity_key`.
const NameSchema = z
    .string()
    .max(24)
    .transform((s) => s.replace(/[^\x20-\x7E]/g, '').trim().slice(0, 16) || 'ANON');

const SubmitSchema = z.object({
    token: z.string().min(8).max(64),
    name: NameSchema,
    wallet: z.string().max(64).optional(),
    ref: z.string().regex(/^[A-Za-z0-9_-]{1,24}$/).optional(),
    replay: ReplaySchema,
});

// Competitive scoring is replay-only: the client never sends distance/score/death
// cause as trusted fields — every one of those is derived below from re-simulating
// `replay` against the server's own seed, game version, and ruleset. A submission
// with no replay, a mismatched version/ruleset/seed, or a structurally impossible
// trace is rejected before a re-simulation is ever run (see verifyReplayEnvelope).
app.post('/api/run/submit', async (c) => {
    const ip = ipOf(c);
    if (!(await rateLimit(ip, 'submit', 30, 60))) return c.json({ error: 'rate_limited' }, 429);

    const parsed = SubmitSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request' }, 400);
    const b = parsed.data;
    const replay = b.replay as RunReplay;

    // one-time token: must exist (issued by /run/start, not yet used)
    const stored = await redis.getdel(`seed:${b.token}`);
    if (!stored) return c.json({ error: 'invalid_token' }, 400);

    let meta: { seed?: `0x${string}`; t?: number } = {};
    try {
        meta = JSON.parse(stored) as { seed?: `0x${string}`; t?: number };
    } catch {
        meta = {};
    }
    if (!meta.seed) return c.json({ error: 'invalid_token' }, 400);

    const rejection = verifyReplayEnvelope(replay, { serverSeed: meta.seed });
    if (rejection) {
        await redis.incr(`verify:rejected:${rejection}`);
        return c.json({ error: rejection }, 400);
    }

    // --- deterministic replay verification: re-simulate from the server's own
    // seed and derive EVERY canonical value from the result. Nothing here reads
    // a client-claimed distance/score/duration/death-cause, because the client no
    // longer sends any — see src/api.ts buildReplay().
    const inputs: InputEvent[] = replay.inputs.map((i) => ({ tick: i.tick, act: i.action as Act }));
    const r = simulate(meta.seed, inputs, replay.ticks);
    const botFlag = botLike(inputs, r.endTick);
    await redis.incr('verify:accepted');
    if (botFlag) await redis.incr('verify:bot');

    // How long the token actually existed. A real run's derived duration can't
    // exceed this — crafting a 50-minute run requires actually holding the token
    // 50 real minutes, not POSTing a long tick count instantly.
    const wallClockMs = meta.t ? Date.now() - meta.t : Infinity;
    const durationMs = Math.round((r.endTick / 60) * 1000);
    const suspicious =
        durationMs < 1500 || durationMs > wallClockMs + RUN_TIME_SLACK_MS || durationMs > MAX_RUN_MS || botFlag;

    const id = randomUUID();
    const rank = rankFor(r.distance);
    const deathCause = r.alive ? 'RUN ENDED (TIME LIMIT).' : r.deathCause;

    await sql`INSERT INTO runs ${sql({
        id,
        name: b.name,
        distance: r.distance,
        score: r.score,
        rank,
        death_cause: deathCause,
        jeets_dodged: 0,
        snipers_survived: 0,
        mev_avoided: 0,
        max_combo: r.maxCombo,
        duration_ms: durationMs,
        wallet: b.wallet ?? null,
        referrer: b.ref ?? null,
        suspicious,
        verified: true,
        replay_len: replay.inputs.length,
    })}`;

    if (suspicious) return c.json({ ok: true, hidden: true, rank });

    await recordScore(b.name, r.distance, b.ref);
    const firstTo20k = r.distance >= MILESTONE_DISTANCE ? await claimMilestone(b.name, r.distance) : false;
    const position = await redis.zrevrank(LB.alltime, b.name);
    return c.json({
        ok: true,
        rank,
        distance: r.distance,
        score: r.score,
        deathCause,
        position: position === null ? null : position + 1,
        firstTo20k,
    });
});

app.get('/api/leaderboard', async (c) => {
    const period = c.req.query('period') || 'alltime';
    const squad = c.req.query('squad');
    const limit = Math.min(Number(c.req.query('limit') || 100), 200);
    const key = squad ? LB.squad(squad) : period === 'daily' ? LB.daily() : period === 'weekly' ? LB.weekly() : LB.alltime;
    const entries = await topScores(key, limit);
    c.header('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
    return c.json({ period: squad ? `squad:${squad}` : period, entries });
});

// The "first to 20km" bounty — the single player who claimed it, or null.
app.get('/api/milestone', async (c) => {
    const milestone = await getMilestone();
    c.header('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
    return c.json({ milestone });
});

// ---- Wallet identity + SIWE (Phase 4) ----
// Guest players never hit any of these routes — practice play and the global
// leaderboard above stay fully open. Only Daily Grid entry (below) requires a
// session, per the product's own wallet-UX spec: connect only when it matters.

const NonceRequestSchema = z.object({ wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });

app.post('/api/auth/nonce', async (c) => {
    const ip = ipOf(c);
    if (!(await rateLimit(ip, 'auth-nonce', 20, 60))) return c.json({ error: 'rate_limited' }, 429);
    const parsed = NonceRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request' }, 400);
    const nonce = await issueNonce(parsed.data.wallet);
    return c.json({ nonce });
});

const VerifyRequestSchema = z.object({ message: z.string().max(2000), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) });

app.post('/api/auth/verify', async (c) => {
    const ip = ipOf(c);
    if (!(await rateLimit(ip, 'auth-verify', 20, 60))) return c.json({ error: 'rate_limited' }, 429);
    const parsed = VerifyRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request' }, 400);

    const result = await verifyAndCreateSession(parsed.data.message, parsed.data.signature as `0x${string}`, {
        expectedDomain: SITE_DOMAIN,
        expectedUri: SITE_URL,
        expectedChainId: BOT_CHAIN_MAINNET_ID,
    });
    // Never log the raw message/signature — only the outcome. (No log call
    // here at all today; noted so a future logging pass doesn't add one.)
    if (!result.ok) return c.json({ error: result.reason }, 401);

    setSessionCookies(c, result.tokens);
    return c.json({
        ok: true,
        wallet: result.user.wallet_address,
        chainId: result.user.chain_id,
        displayName: result.user.display_name,
    });
});

app.get('/api/auth/session', async (c) => {
    const accessToken = getCookie(c, ACCESS_COOKIE);
    const session = accessToken ? await resolveAccessToken(accessToken) : null;
    if (!session) return c.json({ authenticated: false });
    return c.json({ authenticated: true, wallet: session.walletAddress, chainId: session.chainId });
});

app.post('/api/auth/refresh', async (c) => {
    const refreshToken = getCookie(c, REFRESH_COOKIE);
    if (!refreshToken) return c.json({ error: 'no_refresh_token' }, 401);
    const result = await refreshSession(refreshToken);
    if (!result.ok) {
        deleteCookie(c, ACCESS_COOKIE, { path: '/' });
        deleteCookie(c, REFRESH_COOKIE, { path: '/api/auth' });
        return c.json({ error: result.reason }, 401);
    }
    setSessionCookies(c, result.tokens);
    return c.json({ ok: true });
});

app.post('/api/auth/logout', async (c) => {
    const accessToken = getCookie(c, ACCESS_COOKIE);
    const refreshToken = getCookie(c, REFRESH_COOKIE);
    await revokeSession(refreshToken, accessToken);
    deleteCookie(c, ACCESS_COOKIE, { path: '/' });
    deleteCookie(c, REFRESH_COOKIE, { path: '/api/auth' });
    return c.json({ ok: true });
});

const DisplayNameRequestSchema = z.object({ name: z.string().max(24) });

app.post('/api/auth/display-name', async (c) => {
    const ip = ipOf(c);
    if (!(await rateLimit(ip, 'display-name', 3, 24 * 60 * 60))) return c.json({ error: 'rate_limited' }, 429);
    const accessToken = getCookie(c, ACCESS_COOKIE);
    const session = accessToken ? await resolveAccessToken(accessToken) : null;
    if (!session) return c.json({ error: 'not_authenticated' }, 401);
    const parsed = DisplayNameRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request' }, 400);
    const result = await setDisplayName(session.userId, parsed.data.name);
    if (!result.ok) return c.json({ error: result.reason }, 409);
    return c.json({ ok: true });
});

// A grid attempt requires a real session — this is the point past which
// something (a leaderboard position, eventually a reward) attaches to the
// identity, so the identity must be wallet-verified, not a typed display name.
async function requireGridSession<E extends Record<string, unknown>, P extends string>(c: Context<E, P>) {
    const accessToken = getCookie(c, ACCESS_COOKIE);
    return accessToken ? resolveAccessToken(accessToken) : null;
}

// ---- Daily Grid (Phase 3 lifecycle, Phase 4 identity) ----
// Every player on an open grid plays the identical, publicly re-derivable seed.
// A run only counts if it was played against a server-issued, grid-bound,
// one-time ticket, and is re-simulated exactly like a practice run (see
// verifyReplayEnvelope/simulate above) but checked against the TICKET's seed,
// not a per-run random one. identityKey is now `${chainId}:${walletAddress}` —
// derived from the session, never from a client-supplied name.

app.get('/api/grid/current', async (c) => {
    const grid = await getCurrentGrid();
    if (!grid) return c.json({ grid: null });
    const [players] = await Promise.all([countVerifiedGridPlayers(grid.id)]);
    c.header('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
    return c.json({ grid, verifiedPlayers: players });
});

app.get('/api/grid/:id/leaderboard', async (c) => {
    const gridId = c.req.param('id');
    const limit = Math.min(Number(c.req.query('limit') || 100), 200);
    const entries = await getGridLeaderboard(gridId, limit);
    c.header('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
    return c.json({ gridId, entries });
});

const TicketRequestSchema = z.object({ gridId: z.string().uuid() });

app.post('/api/grid/ticket', async (c) => {
    const ip = ipOf(c);
    if (!(await rateLimit(ip, 'grid-ticket', 20, 60))) return c.json({ error: 'rate_limited' }, 429);
    const session = await requireGridSession(c);
    if (!session) return c.json({ error: 'not_authenticated' }, 401);
    const parsed = TicketRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request' }, 400);
    const identityKey = `${session.chainId}:${session.walletAddress}`;
    const result = await issueTicket(identityKey, parsed.data.gridId);
    if ('rejected' in result) return c.json({ error: result.rejected }, 409);
    return c.json({ ticket: result.ticket });
});

const GridSubmitSchema = z.object({
    ticketId: z.string().uuid(),
    replay: ReplaySchema,
});

app.post('/api/grid/submit', async (c) => {
    const ip = ipOf(c);
    if (!(await rateLimit(ip, 'grid-submit', 30, 60))) return c.json({ error: 'rate_limited' }, 429);
    const session = await requireGridSession(c);
    if (!session) return c.json({ error: 'not_authenticated' }, 401);

    const parsed = GridSubmitSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request' }, 400);
    const b = parsed.data;
    const replay = b.replay as RunReplay;

    const ticket = await consumeTicket(b.ticketId);
    if (!ticket) return c.json({ error: 'invalid_or_expired_ticket' }, 400);
    const identityKey = `${session.chainId}:${session.walletAddress}`;
    if (ticket.identity_key !== identityKey) return c.json({ error: 'ticket_identity_mismatch' }, 403);

    const rejection = verifyReplayEnvelope(replay, { serverSeed: ticket.seed as `0x${string}` });
    if (rejection) {
        await redis.incr(`verify:grid:rejected:${rejection}`);
        return c.json({ error: rejection }, 400);
    }

    const inputs: InputEvent[] = replay.inputs.map((i) => ({ tick: i.tick, act: i.action as Act }));
    const r = simulate(ticket.seed, inputs, replay.ticks);
    const botFlag = botLike(inputs, r.endTick);
    await redis.incr('verify:grid:accepted');
    if (botFlag) await redis.incr('verify:grid:bot');

    const durationMs = Math.round((r.endTick / 60) * 1000);
    const suspicious = durationMs < 1500 || durationMs > MAX_RUN_MS || botFlag;
    const deathCause = r.alive ? 'RUN ENDED (TIME LIMIT).' : r.deathCause;

    // Ghost replays are public by design (racing one means downloading its input
    // log), and everyone in a grid shares one seed — so an exact copy of another
    // player's log would re-simulate to their result. One replay per grid, period:
    // friendly pre-check here, atomic unique index (migration 0007) under a race.
    const rh = replayHash(replay);
    if (await gridHasReplayHash(ticket.grid_id, rh)) {
        await redis.incr('verify:grid:rejected:duplicate_replay');
        return c.json({ error: 'duplicate_replay' }, 409);
    }

    let recorded;
    try {
        recorded = await recordVerifiedRun({
            gridId: ticket.grid_id,
            ticketId: ticket.id,
            identityKey,
            player: session.walletAddress as `0x${string}`,
            gameVersion: ticket.game_version,
            replayHash: rh,
            replayTicks: replay.ticks,
            replayInputsFlat: encodeInputsFlat(replay.inputs),
            distance: r.distance,
            score: r.score,
            maxCombo: r.maxCombo,
            deathCause,
            durationMs,
            suspicious,
            replayLen: replay.inputs.length,
        });
    } catch (err) {
        // Two identical submissions raced past the pre-check; the unique index
        // caught the loser. Same outcome as the friendly path.
        if ((err as { code?: string }).code === '23505') {
            await redis.incr('verify:grid:rejected:duplicate_replay');
            return c.json({ error: 'duplicate_replay' }, 409);
        }
        throw err;
    }
    const { id: verifiedRunId, isPersonalBest, status } = recorded;

    // A suspicious run is shadow-hidden entirely — no runId, no status to poll —
    // so a cheater sees nothing distinguishing it from a normal accepted run
    // silently not making the board, rather than an explicit "flagged" signal.
    if (suspicious) return c.json({ ok: true, hidden: true, gridId: ticket.grid_id });

    return c.json({
        ok: true,
        gridId: ticket.grid_id,
        runId: verifiedRunId,
        status,
        rank: rankFor(r.distance),
        distance: r.distance,
        score: r.score,
        deathCause,
        isPersonalBest,
    });
});

// Poll the on-chain receipt progress of one of the caller's own verified runs
// (verified -> receipt_queued -> submitted -> confirmed). Only a personal-best
// run ever leaves `verified` — a worse run has no receipt to track and this
// will just keep returning `verified` forever, which is accurate, not stuck.
app.get('/api/grid/run/:id/status', async (c) => {
    const session = await requireGridSession(c);
    if (!session) return c.json({ error: 'not_authenticated' }, 401);
    const identityKey = `${session.chainId}:${session.walletAddress}`;
    const view = await getVerifiedRunStatus(c.req.param('id'), identityKey);
    if (!view) return c.json({ error: 'not_found' }, 404);
    return c.json({ ok: true, ...view });
});

// The grid leader's best verified replay (or the caller's own with ?self=1) —
// what the client re-simulates locally to race a ghost. Public for the leader:
// the leaderboard already exposes who leads, and the replay's public nature is
// by design (see the duplicate_replay gate in the submit handler). The response
// includes replayHash so the client can independently recompute and verify the
// trace hashes to the exact value that gets receipted on-chain.
app.get('/api/grid/:id/ghost', async (c) => {
    const ip = ipOf(c);
    if (!(await rateLimit(ip, 'grid-ghost', 30, 60))) return c.json({ error: 'rate_limited' }, 429);
    let identityKey: string | undefined;
    if (c.req.query('self') === '1') {
        const session = await requireGridSession(c);
        if (!session) return c.json({ error: 'not_authenticated' }, 401);
        identityKey = `${session.chainId}:${session.walletAddress}`;
    }
    const ghost = await getGridGhost(c.req.param('id'), identityKey);
    if (!ghost) return c.json({ error: 'no_ghost_available' }, 404);
    return c.json({ ok: true, ghost });
});

// Public season visibility — anyone can see the current season's rules-critical
// numbers (asset, cap, window, committed root) without a session. "Publicly
// visible, capped, rules before competition" is a locked product decision.
app.get('/api/season/current', async (c) => {
    const season = await getLatestSeason();
    if (!season) return c.json({ season: null });
    return c.json({
        season: {
            id: season.id,
            name: season.name,
            asset: season.asset,
            capWei: season.cap_wei,
            startsAt: season.starts_at.getTime(),
            endsAt: season.ends_at.getTime(),
            claimWindowEnd: season.claim_window_end ? season.claim_window_end.getTime() : null,
            merkleRoot: season.merkle_root,
            status: season.status,
        },
    });
});

// The caller's own entitlements, each with a freshly rebuilt Merkle proof
// (recomputed from the season's claims rows and checked against the committed
// root on every request — see server/src/seasons.ts).
app.get('/api/rewards/me', async (c) => {
    const session = await requireGridSession(c);
    if (!session) return c.json({ error: 'not_authenticated' }, 401);
    const rewards = await getRewardsForUser(session.userId);
    return c.json({ ok: true, rewards });
});

const SeasonCreateSchema = z.object({
    id: z.string().regex(/^[a-z0-9-]{3,40}$/),
    name: z.string().min(3).max(80),
    asset: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    capWei: z.string().regex(/^[0-9]+$/),
    startsAt: z.number().int(),
    endsAt: z.number().int(),
    claimWindowEnd: z.number().int().optional(),
});

app.post('/api/admin/season/create', async (c) => {
    const key = process.env.ADMIN_KEY;
    if (!key || c.req.header('x-admin-key') !== key) return c.json({ error: 'forbidden' }, 403);
    const parsed = SeasonCreateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request' }, 400);
    const b = parsed.data;
    if (b.endsAt <= b.startsAt) return c.json({ error: 'invalid_window' }, 400);
    const season = await createSeason({
        id: b.id,
        name: b.name,
        asset: b.asset,
        capWei: BigInt(b.capWei),
        startsAt: new Date(b.startsAt),
        endsAt: new Date(b.endsAt),
        claimWindowEnd: b.claimWindowEnd ? new Date(b.claimWindowEnd) : undefined,
    });
    return c.json({ ok: true, season: { id: season.id, status: season.status } });
});

// Close a season: compute entitlements from verified runs only, commit the
// Merkle root, write eligible claim rows — refuses while the window is open.
app.post('/api/admin/season/close', async (c) => {
    const key = process.env.ADMIN_KEY;
    if (!key || c.req.header('x-admin-key') !== key) return c.json({ error: 'forbidden' }, 403);
    const id = c.req.query('id');
    if (!id) return c.json({ error: 'bad_request' }, 400);
    const result = await closeSeason(id);
    if ('rejected' in result) return c.json({ error: result.rejected }, 409);
    return c.json({ ok: true, root: result.root, claimCount: result.claimCount, totalAllocatedWei: result.totalAllocatedWei.toString() });
});

// Opens (or idempotently returns) the grid for a given day. Stands in for the
// "authorised scheduler" until Phase 6's contract exists to open grids
// on-chain; guarded the same way the other admin routes are.
app.post('/api/admin/grid/open', async (c) => {
    const key = process.env.ADMIN_KEY;
    if (!key || c.req.header('x-admin-key') !== key) return c.json({ error: 'forbidden' }, 403);
    const dayId = c.req.query('dayId');
    const grid = await openGrid(dayId || undefined);
    return c.json({ ok: true, grid });
});

// Moves any run_tickets past their expiry from 'issued' to 'expired'. No
// scheduler exists yet for this specific sweep (unrelated to the Phase 7 chain
// relayer below, which only processes chain_jobs); operator-triggered in the
// interim, guarded the same way as other admin routes.
app.post('/api/admin/sweep-expired-tickets', async (c) => {
    const key = process.env.ADMIN_KEY;
    if (!key || c.req.header('x-admin-key') !== key) return c.json({ error: 'forbidden' }, 403);
    const count = await sweepExpiredTickets();
    return c.json({ ok: true, swept: count });
});

// Rebuild every leaderboard from Postgres (source of truth), collapsing to one
// best row per player. Guarded by a shared secret; no-op unless ADMIN_KEY is set.
app.post('/api/admin/rebuild', async (c) => {
    const key = process.env.ADMIN_KEY;
    if (!key || c.req.header('x-admin-key') !== key) return c.json({ error: 'forbidden' }, 403);
    const result = await rebuildLeaderboards();
    return c.json({ ok: true, ...result });
});

// Read-only diagnostics: is anything being hidden by the anti-cheat gate?
app.get('/api/admin/stats', async (c) => {
    const key = process.env.ADMIN_KEY;
    if (!key || c.req.header('x-admin-key') !== key) return c.json({ error: 'forbidden' }, 403);
    const [agg] = await sql`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE suspicious)::int AS suspicious,
               count(*) FILTER (WHERE distance >= 10000)::int AS over10k,
               count(*) FILTER (WHERE distance >= 10000 AND suspicious)::int AS over10k_hidden,
               max(distance)::int AS max_distance
        FROM runs`;
    const top = await sql`
        SELECT name, distance, score, duration_ms, suspicious, verified, replay_len, death_cause
        FROM runs ORDER BY distance DESC LIMIT 20`;
    const rejectionKeys = await redis.keys('verify:rejected:*');
    const rejectionCounts = await Promise.all(rejectionKeys.map((k) => redis.get(k)));
    const [accepted, bot] = await Promise.all([redis.get('verify:accepted'), redis.get('verify:bot')]);
    const verify = {
        gameVersion: GAME_VERSION,
        rulesetHash: RULESET_HASH,
        replaySchemaVersion: REPLAY_SCHEMA_VERSION,
        accepted: Number(accepted ?? 0),
        botFlags: Number(bot ?? 0),
        rejected: Object.fromEntries(rejectionKeys.map((k, i) => [k.replace('verify:rejected:', ''), Number(rejectionCounts[i] ?? 0)])),
    };
    return c.json({ agg, verify, top });
});

// Delete cheat/implausible rows (flagged by the anti-cheat gate). Leaves every
// legitimate run untouched, so it is safe to re-run.
app.post('/api/admin/purge-suspicious', async (c) => {
    const key = process.env.ADMIN_KEY;
    if (!key || c.req.header('x-admin-key') !== key) return c.json({ error: 'forbidden' }, 403);
    const deleted = await sql`DELETE FROM runs WHERE suspicious = true RETURNING name, distance, duration_ms`;
    return c.json({ ok: true, deleted: deleted.length, rows: deleted });
});

// Retroactively flag runs that predate the wall-clock check and are humanly
// impossible. Thresholds are tunable via query (?maxDistance=&maxDurationMs=).
// Flags (reversible), doesn't delete — a rebuild then drops them from the board.
app.post('/api/admin/flag-implausible', async (c) => {
    const key = process.env.ADMIN_KEY;
    if (!key || c.req.header('x-admin-key') !== key) return c.json({ error: 'forbidden' }, 403);
    const maxDistance = Number(c.req.query('maxDistance') || 50_000);
    const maxDurationMs = Number(c.req.query('maxDurationMs') || MAX_RUN_MS);
    const flagged = await sql`
        UPDATE runs SET suspicious = true
        WHERE suspicious = false AND (distance > ${maxDistance} OR duration_ms > ${maxDurationMs})
        RETURNING name, distance, duration_ms`;
    return c.json({ ok: true, flagged: flagged.length, maxDistance, maxDurationMs, rows: flagged });
});

// Read-only visibility into the relayer's outbox — is anything stuck pending/failed?
// (Phase 12/13 will add real alerting; this is the interim operator view.)
app.get('/api/admin/chain-jobs', async (c) => {
    const key = process.env.ADMIN_KEY;
    if (!key || c.req.header('x-admin-key') !== key) return c.json({ error: 'forbidden' }, 403);
    const limit = Math.max(1, Math.min(200, Number(c.req.query('limit')) || 50));
    const jobs = await listChainJobs(limit);
    return c.json({ ok: true, jobs });
});

// Manually drain up to `max` pending chain_jobs against the configured chain. A no-op
// (400) if CHAIN_RELAYER_ENABLED isn't set — there is nothing deployed to relay to yet
// in most environments; Phase 15 is the gated point where that changes.
app.post('/api/admin/chain-jobs/process', async (c) => {
    const key = process.env.ADMIN_KEY;
    if (!key || c.req.header('x-admin-key') !== key) return c.json({ error: 'forbidden' }, 403);
    const config = loadChainConfig();
    if (!config) return c.json({ error: 'relayer_disabled' }, 400);
    const max = Math.max(1, Math.min(50, Number(c.req.query('max')) || 10));
    const processed = await drainJobs(config, max);
    return c.json({ ok: true, processed });
});

// Dynamic OG share card — the bull image with this run's score burned in.
app.get('/api/card.png', (c) => {
    const d = Math.max(0, Math.min(9_999_999, Number(c.req.query('d')) || 0));
    const name = (c.req.query('n') || 'ANON').replace(/[^\x20-\x7E]/g, '').slice(0, 16).toUpperCase() || 'ANON';
    const rank = (c.req.query('r') || '').replace(/[^\x20-\x7E]/g, '').slice(0, 24).toUpperCase();

    const W = 1200;
    const H = 675;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(cardBase, 0, 0, W, H);
    ctx.textAlign = 'left';

    ctx.fillStyle = '#9fb0c3';
    ctx.font = '30px Anton';
    ctx.fillText(`${name} CHARGED`, 712, 215);

    ctx.shadowColor = 'rgba(57,255,20,0.85)';
    ctx.shadowBlur = 34;
    ctx.fillStyle = '#39ff14';
    ctx.font = '128px Anton';
    ctx.fillText(`${d.toLocaleString()}m`, 708, 345);
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#7fffd4';
    ctx.font = '44px Anton';
    ctx.fillText(rank, 712, 420);

    ctx.fillStyle = '#8a93a6';
    ctx.font = '26px Anton';
    ctx.fillText('SAME GRID. PROVE THE RUN.', 712, 520);
    ctx.fillStyle = '#39ff14';
    ctx.font = '46px Anton';
    ctx.fillText('BULL RUSH', 712, 576);

    return new Response(canvas.toBuffer('image/png'), {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' },
    });
});

// Share landing page — gives X a per-run OG card, then bounces humans to the game.
app.get('/s', (c) => {
    const d = (c.req.query('d') || '0').replace(/[^0-9]/g, '').slice(0, 9) || '0';
    const n = (c.req.query('n') || 'ANON').slice(0, 16);
    const r = (c.req.query('r') || '').slice(0, 24);
    const host = c.req.header('host') || 'bull-rush-api-production.up.railway.app';
    const card = `https://${host}/api/card.png?d=${encodeURIComponent(d)}&n=${encodeURIComponent(n)}&r=${encodeURIComponent(r)}`;
    const game = process.env.GAME_URL || 'https://bull-rush.pages.dev';
    const title = esc(`${n} charged ${Number(d).toLocaleString()}m in BULL RUSH`);
    const desc = esc(`Rank: ${r || 'Unverified'}. Replay-verified. Same grid. Prove the run.`);
    return c.html(
        `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${esc(card)}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${esc(card)}">
<meta http-equiv="refresh" content="0;url=${esc(game)}">
</head><body style="background:#05060a;color:#39ff14;font-family:monospace;text-align:center;padding-top:48px">
Charging into BULL RUSH… <a style="color:#39ff14" href="${esc(game)}">tap to play</a></body></html>`,
    );
});

const port = Number(process.env.PORT || 8787);
await assertMigrationsApplied();

// No-op in every environment before Phase 15 deploys real contracts — loadChainConfig
// returns null unless CHAIN_RELAYER_ENABLED=true and every required env var is set.
const chainConfig = loadChainConfig();
if (chainConfig) {
    startRelayerLoop(chainConfig, 15_000);
    console.log('chain relayer loop started (chainId', chainConfig.chainId, ')');
}

serve({ fetch: app.fetch, port }, (info) => console.log(`BULL RUSH API listening on :${info.port}`));
