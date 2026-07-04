// AUTO-GENERATED from src/sim/sim.ts — DO NOT EDIT HERE. Edit src/sim and run `npm run sync-sim`.
// Kept in server/ so the deployed API re-simulates with byte-identical code.

// Deterministic, replay-verifiable Bull Rush simulation.
//
// Single source of truth for gameplay: the live client drives it tick-by-tick
// (createSim + stepSim) to render, and the server RE-RUNS the identical path
// (simulate = createSim + stepSim in a loop) to verify a submitted run. Because
// both go through the same stepSim, they cannot diverge, provided:
//   - fixed 60 Hz timestep (never wall-clock delta),
//   - integer / fixed-point (Q16.16) math only — no float accumulation,
//   - all randomness from the seeded integer Rng, drawn in a fixed order,
//   - spawn difficulty keyed to row INDEX (not tick), so generating rows ahead
//     for rendering draws the RNG in the same order the verifier will,
//   - no Date.now / Math.random / performance.now anywhere.
//
// Dependency-free (rules embedded) so the server imports a copy of just this
// file (+ prng) with no client code.

import { Rng } from './prng.ts';

// ---- Fixed-point + timestep ----
export const TICK_HZ = 60;
const FP = 65536; // Q16.16

// ---- Tunables (integers) ----
const LANE_WIDTH_FP = Math.round(3.2 * FP);
const HALF_LANE_FP = LANE_WIDTH_FP >> 1;
const START_SPEED_FP = 24 * FP; // units/sec, in FP
const MAX_SPEED_FP = 64 * FP;
const GROWTH_PER_TICK_FP = Math.round((0.7 * FP) / TICK_HZ);
const SEGMENT_UNITS = 28;
const LOOKAHEAD_UNITS = 16 * SEGMENT_UNITS; // generate rows this far ahead for rendering
const HEALTH_MAX = 3;
const DASH_TICKS = Math.round(0.4 * TICK_HZ);
const DASH_COOLDOWN_TICKS = Math.round(2.2 * TICK_HZ);
const INVULN_TICKS = Math.round(1.0 * TICK_HZ);
const CLOUD_TICKS = 5 * TICK_HZ;
const GREEN_SCORE = 500;
const BREAK_SCORE = 120;
const CHECK_INTERVAL = 600; // checksum every 10s of ticks
export const MAX_TICKS = 60 * TICK_HZ * 45; // 45 min hard ceiling

// ---- Rules (embedded; damage -1 == instant death) ----
type Hazard = { dmg: number; breakable: boolean; minTier: number; cause: string };
const HAZARDS: Record<string, Hazard> = {
    jeet: { dmg: 1, breakable: true, minTier: 0, cause: 'YOU GOT JEETED.' },
    redCandle: { dmg: 1, breakable: true, minTier: 1, cause: 'RED CANDLE GOT YOU.' },
    rug: { dmg: 1, breakable: true, minTier: 2, cause: 'THE RUG OPENED.' },
    sniper: { dmg: 2, breakable: false, minTier: 1, cause: 'SNIPER CAUGHT YOU.' },
    mev: { dmg: -1, breakable: false, minTier: 3, cause: 'MEV WIPED THE RUN.' },
};
const HAZARD_KINDS = ['jeet', 'redCandle', 'rug', 'sniper', 'mev'] as const;
const HAZARD_WEIGHT: Record<string, number> = { jeet: 4, redCandle: 2, rug: 2, sniper: 2, mev: 1 };
const POWERUP_KINDS = ['greenCandle', 'diamondHorns', 'stimmy', 'blackCloud'] as const;
const POWERUP_WEIGHT: Record<string, number> = { greenCandle: 5, diamondHorns: 4, stimmy: 4, blackCloud: 1 };
const POWERUP_MINTIER: Record<string, number> = { greenCandle: 0, diamondHorns: 1, stimmy: 2, blackCloud: 2 };
const SAFE_ROWS = 3;

// Difficulty is a function of row index (distance), NOT wall-clock — this is what
// lets the client generate rows ahead of the player without diverging from the
// server's replay.
function tierForIndex(index: number): number {
    if (index < 10) return 0;
    if (index < 40) return 1;
    if (index < 90) return 2;
    return 3;
}

// ---- Inputs ----
export const Act = { Left: 0, Right: 1, Dash: 2 } as const;
export type Act = (typeof Act)[keyof typeof Act];
export interface InputEvent {
    tick: number;
    act: Act;
}

// ---- Render/collision data ----
export interface Cell {
    kind: string;
    powerup: boolean;
}
export interface Row {
    index: number;
    dist: number; // hit-point distance in units
    cells: (Cell | null)[]; // lanes -1, 0, 1 -> indices 0, 1, 2
}
export interface SimEvent {
    type: 'hit' | 'powerup' | 'break' | 'shield' | 'cloud' | 'death' | 'dash';
    kind?: string;
    lane?: number;
}

export interface SimState {
    rng: Rng;
    tick: number;
    speedFP: number;
    distFP: number;
    scoreFP: number;
    xFP: number;
    laneTarget: number;
    hearts: number;
    shield: boolean;
    combo: number;
    dashUntil: number;
    dashReadyAt: number;
    invulnUntil: number;
    alive: boolean;
    deathCause: string;
    rows: Row[]; // upcoming, generated ahead, ascending by index; crossed rows removed
    nextRow: number;
    checksums: number[];
    events: SimEvent[]; // produced during the last stepSim (for render juice)
}

export interface SimResult {
    alive: boolean;
    endTick: number;
    distance: number;
    score: number;
    hearts: number;
    deathCause: string;
    checksums: number[];
}

const rowHitDist = (index: number): number => index * SEGMENT_UNITS + (SEGMENT_UNITS >> 1);

function weightedPick(
    kinds: readonly string[],
    weight: Record<string, number>,
    tier: number,
    minTierOf: (k: string) => number,
    rng: Rng,
): string | null {
    const pool = kinds.filter((k) => minTierOf(k) <= tier);
    if (pool.length === 0) return null;
    let total = 0;
    for (const k of pool) total += weight[k] ?? 1;
    let r = rng.below(total);
    for (const k of pool) {
        r -= weight[k] ?? 1;
        if (r < 0) return k;
    }
    return pool[pool.length - 1];
}

function generateRow(index: number, rng: Rng): Row {
    const cells: (Cell | null)[] = [null, null, null];
    if (index < SAFE_ROWS) return { index, dist: rowHitDist(index), cells };
    const tier = tierForIndex(index);
    const laneIdx = [0, 1, 2];
    for (let i = laneIdx.length - 1; i > 0; i--) {
        const j = rng.below(i + 1);
        const tmp = laneIdx[i];
        laneIdx[i] = laneIdx[j];
        laneIdx[j] = tmp;
    }
    const blocked = tier >= 3 ? 2 : rng.chance(45, 100) ? 2 : 1;
    for (let i = 0; i < blocked; i++) {
        const kind = weightedPick(HAZARD_KINDS, HAZARD_WEIGHT, tier, (k) => HAZARDS[k].minTier, rng);
        if (kind) cells[laneIdx[i]] = { kind, powerup: false };
    }
    if (rng.chance(22, 100)) {
        const open = laneIdx.filter((l) => cells[l] === null);
        if (open.length > 0) {
            const kind = weightedPick(POWERUP_KINDS, POWERUP_WEIGHT, tier, (k) => POWERUP_MINTIER[k], rng);
            if (kind) cells[open[rng.below(open.length)]] = { kind, powerup: true };
        }
    }
    return { index, dist: rowHitDist(index), cells };
}

function laneOfX(xFP: number): number {
    if (xFP > HALF_LANE_FP) return 1;
    if (xFP < -HALF_LANE_FP) return -1;
    return 0;
}

function generateAhead(s: SimState): void {
    const horizon = ((s.distFP / FP) | 0) + LOOKAHEAD_UNITS;
    while (rowHitDist(s.nextRow) <= horizon) {
        s.rows.push(generateRow(s.nextRow, s.rng));
        s.nextRow++;
    }
}

export function createSim(seed: string): SimState {
    const s: SimState = {
        rng: new Rng(seed),
        tick: 0,
        speedFP: START_SPEED_FP,
        distFP: 0,
        scoreFP: 0,
        xFP: 0,
        laneTarget: 0,
        hearts: HEALTH_MAX,
        shield: false,
        combo: 0,
        dashUntil: -1,
        dashReadyAt: 0,
        invulnUntil: -1,
        alive: true,
        deathCause: '',
        rows: [],
        nextRow: 0,
        checksums: [],
        events: [],
    };
    generateAhead(s);
    return s;
}

function resolve(s: SimState, c: Cell, lane: number, tick: number): void {
    if (c.powerup) {
        if (c.kind === 'blackCloud') {
            s.invulnUntil = tick + CLOUD_TICKS;
            s.events.push({ type: 'cloud' });
        } else {
            if (c.kind === 'greenCandle') s.scoreFP += GREEN_SCORE * FP;
            else if (c.kind === 'diamondHorns') s.shield = true;
            else if (c.kind === 'stimmy') s.hearts = Math.min(HEALTH_MAX, s.hearts + 1);
            s.events.push({ type: 'powerup', kind: c.kind, lane });
        }
        return;
    }
    const hz = HAZARDS[c.kind];
    if (tick < s.dashUntil && hz.breakable) {
        s.scoreFP += BREAK_SCORE * FP;
        s.combo++;
        s.events.push({ type: 'break', kind: c.kind, lane });
        return;
    }
    if (s.shield) {
        s.shield = false;
        s.events.push({ type: 'shield', lane });
        return;
    }
    if (tick < s.invulnUntil) return;
    s.invulnUntil = tick + INVULN_TICKS;
    s.combo = 0;
    if (hz.dmg === -1) {
        s.alive = false;
        s.deathCause = hz.cause;
        s.events.push({ type: 'death', kind: c.kind, lane });
        return;
    }
    s.hearts -= hz.dmg;
    s.events.push({ type: 'hit', kind: c.kind, lane });
    if (s.hearts <= 0) {
        s.hearts = 0;
        s.alive = false;
        s.deathCause = hz.cause;
        s.events.push({ type: 'death', kind: c.kind, lane });
    }
}

// Advance exactly one fixed tick. `acts` are the inputs that occurred this tick,
// in order. Mutates state; render/juice reads s.events afterward.
export function stepSim(s: SimState, acts: readonly Act[]): void {
    if (!s.alive) return;
    s.events.length = 0;
    const tick = s.tick;

    for (const act of acts) {
        if (act === Act.Left) s.laneTarget = Math.max(-1, s.laneTarget - 1);
        else if (act === Act.Right) s.laneTarget = Math.min(1, s.laneTarget + 1);
        else if (act === Act.Dash && tick >= s.dashReadyAt) {
            s.dashUntil = tick + DASH_TICKS;
            s.dashReadyAt = tick + DASH_COOLDOWN_TICKS;
            s.events.push({ type: 'dash' });
        }
    }

    s.speedFP = Math.min(MAX_SPEED_FP, s.speedFP + GROWTH_PER_TICK_FP);
    const step = (s.speedFP / TICK_HZ) | 0;
    s.distFP += step;
    s.scoreFP += step;
    const targetXFP = s.laneTarget * LANE_WIDTH_FP;
    s.xFP += ((targetXFP - s.xFP) * 12) / TICK_HZ | 0;
    const lane = laneOfX(s.xFP);

    generateAhead(s);

    const distUnits = (s.distFP / FP) | 0;
    while (s.rows.length > 0 && distUnits >= s.rows[0].dist) {
        const row = s.rows.shift() as Row;
        const c = row.cells[lane + 1];
        if (c) resolve(s, c, lane, tick);
        if (!s.alive) break;
    }

    if (tick % CHECK_INTERVAL === 0) s.checksums.push(hashState(tick, s.distFP, s.scoreFP, s.hearts, lane, s.combo));
    s.tick++;
}

// Convenience read-outs for the renderer (pure derivations of state).
export function simDistance(s: SimState): number {
    return (s.distFP / FP) | 0;
}
export function simScore(s: SimState): number {
    return (s.scoreFP / FP) | 0;
}
export function simPlayerX(s: SimState): number {
    return s.xFP / FP;
}

/**
 * Re-run a full run from seed + logged inputs. Same path the client played, so
 * the returned distance/score/checksums are the authoritative truth.
 */
export function simulate(seed: string, inputs: InputEvent[], totalTicks: number): SimResult {
    const s = createSim(seed);
    const cap = Math.min(totalTicks, MAX_TICKS);
    let ip = 0;
    const acts: Act[] = [];
    while (s.tick < cap && s.alive) {
        acts.length = 0;
        while (ip < inputs.length && inputs[ip].tick === s.tick) acts.push(inputs[ip++].act);
        while (ip < inputs.length && inputs[ip].tick < s.tick) ip++;
        stepSim(s, acts);
    }
    return {
        alive: s.alive,
        endTick: s.tick,
        distance: simDistance(s),
        score: simScore(s),
        hearts: s.hearts,
        deathCause: s.deathCause,
        checksums: s.checksums,
    };
}

// FNV-1a-ish rolling hash over the tick state, kept in uint32.
function hashState(...vals: number[]): number {
    let h = 2166136261;
    for (const v of vals) {
        const x = v | 0;
        h = Math.imul(h ^ (x & 0xff), 16777619);
        h = Math.imul(h ^ ((x >>> 8) & 0xff), 16777619);
        h = Math.imul(h ^ ((x >>> 16) & 0xff), 16777619);
        h = Math.imul(h ^ ((x >>> 24) & 0xff), 16777619);
    }
    return h >>> 0;
}
