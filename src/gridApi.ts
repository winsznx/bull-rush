// Thin client for the Daily Grid endpoints. Same offline-safe posture as api.ts:
// every call degrades to null on failure rather than throwing.
import { activeSim } from './sim/active';
import { REPLAY_SCHEMA_VERSION, type RunReplay } from './sim/replay';
import { GAME_VERSION, RULESET_HASH } from './sim/ruleset';

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '';

export interface GridInfo {
    id: string;
    dayId: string;
    seed: `0x${string}`;
    gameVersion: string;
    rulesetHash: `0x${string}`;
    publishedAt: number;
    opensAt: number;
    closesAt: number;
    isOpenForTickets: boolean;
}

export async function getCurrentGrid(): Promise<{ grid: GridInfo | null; verifiedPlayers: number }> {
    const empty = { grid: null, verifiedPlayers: 0 };
    if (!BASE) return empty;
    try {
        const r = await fetch(`${BASE}/api/grid/current`);
        if (!r.ok) return empty;
        return (await r.json()) as { grid: GridInfo | null; verifiedPlayers: number };
    } catch {
        return empty;
    }
}

export interface GridLbEntry {
    position: number;
    identityKey: string;
    distance: number;
}

export async function getGridLeaderboard(gridId: string, limit = 50): Promise<GridLbEntry[]> {
    if (!BASE) return [];
    try {
        const r = await fetch(`${BASE}/api/grid/${gridId}/leaderboard?limit=${limit}`);
        if (!r.ok) return [];
        const d = (await r.json()) as { entries: GridLbEntry[] };
        return d.entries;
    } catch {
        return [];
    }
}

export type TicketResult =
    | { ok: true; ticketId: string; seed: `0x${string}`; expiresAt: number }
    | { ok: false; reason: string };

export async function requestGridTicket(name: string, gridId: string): Promise<TicketResult> {
    if (!BASE) return { ok: false, reason: 'offline' };
    try {
        const r = await fetch(`${BASE}/api/grid/ticket`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, gridId }),
        });
        const d = (await r.json().catch(() => null)) as { ticket?: { id: string; seed: `0x${string}`; expiresAt: number }; error?: string } | null;
        if (!d) return { ok: false, reason: 'network_error' };
        if (d.error || !d.ticket) return { ok: false, reason: d.error ?? 'unknown' };
        return { ok: true, ticketId: d.ticket.id, seed: d.ticket.seed, expiresAt: d.ticket.expiresAt };
    } catch {
        return { ok: false, reason: 'network_error' };
    }
}

export interface GridSubmitResult {
    ok: boolean;
    rejected?: string;
    hidden?: boolean;
    rank?: string;
    distance?: number;
    score?: number;
    deathCause?: string;
    isPersonalBest?: boolean;
}

export async function submitGridRun(ticketId: string, name: string): Promise<GridSubmitResult | null> {
    if (!BASE) return null;
    const runner = activeSim.runner;
    if (!runner || runner.log.length === 0) return null;
    const replay: RunReplay = {
        schemaVersion: REPLAY_SCHEMA_VERSION,
        gameVersion: GAME_VERSION,
        rulesetHash: RULESET_HASH,
        seed: runner.seed as `0x${string}`,
        runId: ticketId,
        inputs: runner.log.map((ev) => ({ tick: ev.tick, action: ev.act })),
        ticks: runner.tick,
    };
    try {
        const r = await fetch(`${BASE}/api/grid/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticketId, name, replay }),
        });
        const d = (await r.json().catch(() => null)) as GridSubmitResult | { error: string } | null;
        if (!d) return null;
        if ('error' in d) return { ok: false, rejected: d.error };
        return d;
    } catch {
        return null;
    }
}
