import { Redis } from 'ioredis';
import { rankFor } from './ranks.ts';

const url = process.env.REDIS_URL;
if (!url) throw new Error('REDIS_URL is required');

export const redis = new Redis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
});

export const LB = {
    alltime: 'lb:alltime',
    daily: () => `lb:daily:${new Date().toISOString().slice(0, 10)}`,
    weekly: () => `lb:weekly:${Math.floor(Date.now() / 6.048e8)}`,
    squad: (code: string) => `lb:squad:${code}`,
};

const DAY = 86400;

// Fixed-window rate limit. Returns true if the request is allowed.
export async function rateLimit(ip: string, route: string, limit: number, windowSec: number): Promise<boolean> {
    const key = `rl:${route}:${ip}:${Math.floor(Date.now() / 1000 / windowSec)}`;
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, windowSec);
    return n <= limit;
}

// The leaderboard is keyed by player name so each player holds a single row.
// GT keeps only a player's best distance (never demotes them on a worse run).
export async function recordScore(name: string, distance: number, squad?: string): Promise<void> {
    const pipe = redis.pipeline();
    pipe.zadd(LB.alltime, 'GT', distance, name);
    pipe.zadd(LB.daily(), 'GT', distance, name);
    pipe.expire(LB.daily(), DAY * 2);
    pipe.zadd(LB.weekly(), 'GT', distance, name);
    pipe.expire(LB.weekly(), DAY * 9);
    if (squad) {
        pipe.zadd(LB.squad(squad), 'GT', distance, name);
        pipe.expire(LB.squad(squad), DAY * 30);
    }
    await pipe.exec();
}

export interface LbEntry {
    position: number;
    name: string;
    distance: number;
    rank: string;
}

export async function topScores(key: string, limit: number): Promise<LbEntry[]> {
    const flat = await redis.zrevrange(key, 0, limit - 1, 'WITHSCORES');
    const out: LbEntry[] = [];
    for (let i = 0; i < flat.length; i += 2) {
        const distance = Number(flat[i + 1]);
        let name = flat[i];
        // Members are now plain player names; tolerate legacy JSON members {n,r}.
        if (name.startsWith('{')) {
            try {
                const m = JSON.parse(name) as { n?: string };
                if (typeof m.n === 'string') name = m.n;
            } catch {
                continue;
            }
        }
        out.push({ position: i / 2 + 1, name, distance, rank: rankFor(distance) });
    }
    return out;
}

export const MILESTONE_DISTANCE = 20000;
const MILESTONE_KEY = 'milestone:20km';

export interface Milestone {
    name: string;
    distance: number;
    at: number;
}

// The first legitimate run across the line wins it, permanently (SET NX is
// atomic, so concurrent 20k submits can't both claim). Returns true if this
// call is the one that claimed it.
export async function claimMilestone(name: string, distance: number): Promise<boolean> {
    const res = await redis.set(MILESTONE_KEY, JSON.stringify({ name, distance, at: Date.now() }), 'NX');
    return res === 'OK';
}

export async function getMilestone(): Promise<Milestone | null> {
    const raw = await redis.get(MILESTONE_KEY);
    if (!raw) return null;
    try {
        return JSON.parse(raw) as Milestone;
    } catch {
        return null;
    }
}

interface RunRow {
    name: string;
    distance: number;
    referrer: string | null;
    created_at: Date;
}

export async function rebuildLeaderboards(): Promise<{
    redisVersion: string;
    rows: number;
    alltime: number;
    daily: number;
    weekly: number;
    squads: number;
    milestone: { name: string; distance: number } | null;
}> {
    const { sql } = await import('./db.ts');
    const rows = await sql<RunRow[]>`
        SELECT name, distance, referrer, created_at FROM runs WHERE suspicious = false
    `;

    const bestPerName = (subset: RunRow[]): Map<string, number> => {
        const m = new Map<string, number>();
        for (const r of subset) {
            const cur = m.get(r.name);
            if (cur === undefined || r.distance > cur) m.set(r.name, r.distance);
        }
        return m;
    };

    const todayStr = new Date().toISOString().slice(0, 10);
    const weekBucket = Math.floor(Date.now() / 6.048e8);
    const dayOf = (d: Date) => new Date(d).toISOString().slice(0, 10);
    const weekOf = (d: Date) => Math.floor(new Date(d).getTime() / 6.048e8);

    const all = bestPerName(rows);
    const daily = bestPerName(rows.filter((r) => dayOf(r.created_at) === todayStr));
    const weekly = bestPerName(rows.filter((r) => weekOf(r.created_at) === weekBucket));

    const squads = new Map<string, Map<string, number>>();
    for (const r of rows) {
        if (!r.referrer) continue;
        let sm = squads.get(r.referrer);
        if (!sm) squads.set(r.referrer, (sm = new Map()));
        const cur = sm.get(r.name);
        if (cur === undefined || r.distance > cur) sm.set(r.name, r.distance);
    }

    const load = async (key: string, m: Map<string, number>, ttl?: number): Promise<void> => {
        await redis.del(key);
        if (m.size > 0) {
            const args: (string | number)[] = [];
            for (const [name, dist] of m) args.push(dist, name);
            await redis.zadd(key, ...args);
        }
        if (ttl) await redis.expire(key, ttl);
    };

    await load(LB.alltime, all);
    await load(LB.daily(), daily, DAY * 2);
    await load(LB.weekly(), weekly, DAY * 9);
    for (const [code, m] of squads) await load(LB.squad(code), m, DAY * 30);

    const firstBig = rows
        .filter((r) => r.distance >= MILESTONE_DISTANCE)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];
    if (firstBig) {
        await redis.set(
            MILESTONE_KEY,
            JSON.stringify({ name: firstBig.name, distance: firstBig.distance, at: new Date(firstBig.created_at).getTime() }),
        );
    } else {
        await redis.del(MILESTONE_KEY);
    }

    const info = await redis.info('server');
    const redisVersion = /redis_version:([^\r\n]+)/.exec(info)?.[1] ?? 'unknown';

    return {
        redisVersion,
        rows: rows.length,
        alltime: all.size,
        daily: daily.size,
        weekly: weekly.size,
        squads: squads.size,
        milestone: firstBig ? { name: firstBig.name, distance: firstBig.distance } : null,
    };
}
