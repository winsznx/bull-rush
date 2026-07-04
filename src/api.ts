// Thin client for the Railway API. Everything degrades gracefully: if VITE_API_URL
// is unset or the backend is unreachable, the game still plays fully offline and
// falls back to local high scores.
import { activeSim } from './sim/active';

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
    distance: number;
    score: number;
    durationMs: number;
    deathCause?: string;
    wallet?: string;
    ref?: string;
    il?: number[];
    ticks?: number;
}

function localSeed(): string {
    return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

// Share link on the GAME's own domain (a Cloudflare Pages Function at /s serves
// the per-run OG card to X, then bounces players to the game). Branded + clean.
export function shareLink(p: { distance: number; rank: string; name: string }): string | null {
    if (typeof window === 'undefined') return null;
    const q = new URLSearchParams({ d: String(p.distance), r: p.rank, n: p.name });
    return `${window.location.origin}/s?${q.toString()}`;
}

export async function startRun(): Promise<{ seed: string; token: string | null }> {
    if (!BASE) return { seed: localSeed(), token: null };
    try {
        const r = await fetch(`${BASE}/api/run/start`, { method: 'POST' });
        if (!r.ok) throw new Error('start failed');
        const d = (await r.json()) as { seed: string; token: string };
        return { seed: d.seed, token: d.token };
    } catch {
        return { seed: localSeed(), token: null };
    }
}

export async function submitRun(p: SubmitPayload): Promise<{ rank: string; position: number | null } | null> {
    if (!BASE) return null;
    // Attach the deterministic input log so the server can re-simulate + verify.
    const body: SubmitPayload = { ...p };
    const runner = activeSim.runner;
    if (runner && runner.log.length > 0) {
        const il: number[] = [];
        for (const ev of runner.log) il.push(ev.tick, ev.act);
        body.il = il;
        body.ticks = runner.tick;
    }
    try {
        const r = await fetch(`${BASE}/api/run/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!r.ok) return null;
        return (await r.json()) as { rank: string; position: number | null };
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
