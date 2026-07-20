// Thin client for the Railway API. Everything degrades gracefully: if VITE_API_URL
// is unset or the backend is unreachable, the game still plays fully offline and
// falls back to local high scores.
//
// Competitive submission is replay-only: the server derives distance/score/death
// cause itself by re-simulating `replay` — this client never sends those as
// trust-bearing fields. See src/sim/replay.ts + src/sim/verify.ts.
import { activeSim } from './sim/active';
import { REPLAY_SCHEMA_VERSION, type RunReplay } from './sim/replay';
import { GAME_VERSION, RULESET_HASH } from './sim/ruleset';

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '';

export const apiEnabled = BASE.length > 0;

export interface LbEntry {
    position: number;
    name: string;
    distance: number;
    rank: string;
}

export interface SubmitPayload {
    token: string;
    name: string;
    ref?: string;
    wallet?: string;
    replay: RunReplay;
}

function localSeed(): `0x${string}` {
    return `0x${Date.now().toString(16)}${Math.floor(Math.random() * 1e9).toString(16)}`;
}

/** Builds the canonical replay for the run currently in progress, or null if there
 * is nothing valid to submit (no sim runner mounted, or it never received input). */
export function buildReplay(runId: string): RunReplay | null {
    const runner = activeSim.runner;
    if (!runner || runner.log.length === 0) return null;
    return {
        schemaVersion: REPLAY_SCHEMA_VERSION,
        gameVersion: GAME_VERSION,
        rulesetHash: RULESET_HASH,
        seed: runner.seed as `0x${string}`,
        runId,
        inputs: runner.log.map((ev) => ({ tick: ev.tick, action: ev.act })),
        ticks: runner.tick,
    };
}

// Share link on the GAME's own domain (a Cloudflare Pages Function at /s serves
// the per-run OG card to X, then bounces players to the game). Branded + clean.
export function shareLink(p: { distance: number; rank: string; name: string }): string | null {
    if (typeof window === 'undefined') return null;
    const q = new URLSearchParams({ d: String(p.distance), r: p.rank, n: p.name });
    return `${window.location.origin}/s?${q.toString()}`;
}

export async function startRun(): Promise<{ seed: `0x${string}`; token: string | null }> {
    if (!BASE) return { seed: localSeed(), token: null };
    try {
        const r = await fetch(`${BASE}/api/run/start`, { method: 'POST' });
        if (!r.ok) throw new Error('start failed');
        const d = (await r.json()) as { seed: `0x${string}`; token: string };
        return { seed: d.seed, token: d.token };
    } catch {
        return { seed: localSeed(), token: null };
    }
}

export interface SubmitResult {
    ok: boolean;
    /** Present only when ok — every value here is server-derived, never the client's claim. */
    rank?: string;
    distance?: number;
    score?: number;
    deathCause?: string;
    position?: number | null;
    firstTo20k?: boolean;
    /** Present when the replay was rejected outright (see src/sim/verify.ts). */
    rejected?: string;
}

export async function submitRun(p: SubmitPayload): Promise<SubmitResult | null> {
    if (!BASE) return null;
    try {
        const r = await fetch(`${BASE}/api/run/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(p),
        });
        const d = (await r.json().catch(() => null)) as SubmitResult | { error: string } | null;
        if (!d) return null;
        if ('error' in d) return { ok: false, rejected: d.error };
        return d;
    } catch {
        return null;
    }
}

export interface Milestone {
    name: string;
    distance: number;
    at: number;
}

export async function getMilestone(): Promise<Milestone | null> {
    if (!BASE) return null;
    try {
        const r = await fetch(`${BASE}/api/milestone`);
        if (!r.ok) return null;
        const d = (await r.json()) as { milestone: Milestone | null };
        return d.milestone;
    } catch {
        return null;
    }
}

export async function getLeaderboard(
    period: 'alltime' | 'daily' | 'weekly' = 'alltime',
    squad?: string,
    limit = 100,
): Promise<LbEntry[] | null> {
    if (!BASE) return null;
    try {
        const q = new URLSearchParams({ period, limit: String(limit) });
        if (squad) q.set('squad', squad);
        const r = await fetch(`${BASE}/api/leaderboard?${q.toString()}`);
        if (!r.ok) return null;
        const d = (await r.json()) as { entries: LbEntry[] };
        return d.entries;
    } catch {
        return null;
    }
}
