import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { sql, initSchema } from './db.ts';
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
import { REPLAY_SCHEMA_VERSION, type RunReplay } from './sim/replay.ts';
import { GAME_VERSION, RULESET_HASH } from './sim/ruleset.ts';

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
    }),
);

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

const SubmitSchema = z.object({
    token: z.string().min(8).max(64),
    name: z
        .string()
        .max(24)
        .transform((s) => s.replace(/[^\x20-\x7E]/g, '').trim().slice(0, 16) || 'ANON'),
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
await initSchema();
serve({ fetch: app.fetch, port }, (info) => console.log(`BULL RUSH API listening on :${info.port}`));
