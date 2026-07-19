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

// Requires an authenticated session (see src/authApi.ts) — the server derives
// the ticket's identity from the session cookie, never from a client-supplied
// name. A guest without a session gets `not_authenticated` back.
export async function requestGridTicket(gridId: string): Promise<TicketResult> {
    if (!BASE) return { ok: false, reason: 'offline' };
    try {
        const r = await fetch(`${BASE}/api/grid/ticket`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ gridId }),
        });
        const d = (await r.json().catch(() => null)) as { ticket?: { id: string; seed: `0x${string}`; expiresAt: number }; error?: string } | null;
        if (!d) return { ok: false, reason: 'network_error' };
        if (d.error || !d.ticket) return { ok: false, reason: d.error ?? 'unknown' };
        return { ok: true, ticketId: d.ticket.id, seed: d.ticket.seed, expiresAt: d.ticket.expiresAt };
    } catch {
        return { ok: false, reason: 'network_error' };
    }
}

export type VerifiedRunStatus = 'received' | 'verifying' | 'verified' | 'risk_hold' | 'receipt_queued' | 'submitted' | 'confirmed';

export interface GridSubmitResult {
    ok: boolean;
    rejected?: string;
    hidden?: boolean;
    rank?: string;
    distance?: number;
    score?: number;
    deathCause?: string;
    isPersonalBest?: boolean;
    // Present only for a non-suspicious accepted run — a shadow-hidden run has
    // no runId to poll, by design (see server/src/index.ts's submit handler).
    runId?: string;
    status?: VerifiedRunStatus;
}

export async function submitGridRun(ticketId: string): Promise<GridSubmitResult | null> {
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
            credentials: 'include',
            body: JSON.stringify({ ticketId, replay }),
        });
        const d = (await r.json().catch(() => null)) as GridSubmitResult | { error: string } | null;
        if (!d) return null;
        if ('error' in d) return { ok: false, rejected: d.error };
        return d;
    } catch {
        return null;
    }
}

export interface RunStatusResult {
    status: VerifiedRunStatus;
    receiptTxHash: string | null;
    isPersonalBest: boolean;
}

// Polls the on-chain receipt progress of a run this session itself submitted
// (server-side ownership-checked — see server/src/index.ts). Returns null on
// any failure (network, not-found, not-authenticated) so a caller can treat
// "no answer this tick" the same as "try again next tick" without special-casing.
export async function getRunStatus(runId: string): Promise<RunStatusResult | null> {
    if (!BASE) return null;
    try {
        const r = await fetch(`${BASE}/api/grid/run/${runId}/status`, { credentials: 'include' });
        if (!r.ok) return null;
        const d = (await r.json().catch(() => null)) as (RunStatusResult & { ok: true }) | null;
        if (!d || !d.ok) return null;
        return { status: d.status, receiptTxHash: d.receiptTxHash, isPersonalBest: d.isPersonalBest };
    } catch {
        return null;
    }
}
