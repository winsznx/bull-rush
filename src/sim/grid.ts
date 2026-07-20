// Daily Grid seed derivation + timing — pure, shared (client + server), so the
// client can independently re-derive and audit a grid's seed rather than just
// trust whatever the backend says. Once Phase 6's DailyGridRegistry contract
// exists, the seed source becomes an on-chain commitment (a source block hash)
// instead of this pure function of (dayId, gameVersion, rulesetHash) — but the
// public-derivability property this preserves ("anyone can verify the seed
// wasn't cherry-picked") carries over unchanged; only where the entropy comes
// from changes, not whether it's auditable.
import { hashCanonical } from './replay';
import { GAME_VERSION, RULESET_HASH } from './ruleset';

// A short public inspection window between a grid's seed being published and
// competitive run tickets becoming issuable — time for anyone to independently
// re-derive the seed and confirm it matches before a single run counts.
export const GRID_INSPECTION_DELAY_MS = 5 * 60 * 1000;
export const GRID_WINDOW_MS = 24 * 60 * 60 * 1000;

// UTC calendar day, e.g. "2026-07-18" — the grid's public day identifier.
export function dayIdFor(date: Date): string {
    return date.toISOString().slice(0, 10);
}

// Deterministic, publicly re-derivable seed for a given day's grid. Two calls
// with the same dayId under the same game version/ruleset always agree — an
// operator cannot reroll to a preferred course, because there is nothing to
// reroll: the seed is a pure function of public information.
export function deriveGridSeed(dayId: string): `0x${string}` {
    return hashCanonical({ dayId, gameVersion: GAME_VERSION, rulesetHash: RULESET_HASH });
}

export interface GridWindow {
    opensAt: number;
    closesAt: number;
}

// `publishedAt` is when the grid row was created (seed became public). Tickets
// cannot be issued until `opensAt`; the grid stops accepting new tickets at
// `closesAt`.
export function gridWindowFor(publishedAt: number): GridWindow {
    return { opensAt: publishedAt + GRID_INSPECTION_DELAY_MS, closesAt: publishedAt + GRID_WINDOW_MS };
}
