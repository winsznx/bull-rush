// AUTO-GENERATED from src/sim/replay.ts — DO NOT EDIT HERE. Edit src/sim and run `npm run sim:sync`.
// Kept in server/ so the deployed API re-simulates with byte-identical code.

// Canonical replay schema + encoding/hashing + structural validation.
//
// This is what a client submits as proof of a run, and what the server hashes and
// re-simulates. One rule matters more than anything else here: NEVER hash
// `JSON.stringify(obj)` on an arbitrary object — key order is not guaranteed stable
// across engines/versions, so two semantically-identical replays could hash
// differently. `canonicalStringify` below fixes key order explicitly (recursively,
// alphabetically) before anything is hashed.
//
// `hashCanonical` uses keccak256 (via viem) — a real 32-byte cryptographic hash, not
// a fingerprint — because its output (RULESET_HASH, a Daily Grid's seed, a replay's
// hash) is exactly what Phase 6/7's contracts and relayer treat as `bytes32` on-chain
// values (DailyGridRegistry.openGrid, VerifiedRunRegistry.recordRun). An earlier
// 32-bit FNV-1a version of this function was replaced once the relayer actually
// needed to encode these values as real bytes32 ABI parameters.

import { keccak256, toHex } from 'viem';

export const REPLAY_SCHEMA_VERSION = 1;

export interface ReplayInput {
    tick: number;
    action: number;
}

export interface RunReplay {
    schemaVersion: number;
    gameVersion: string;
    rulesetHash: `0x${string}`;
    seed: `0x${string}`;
    runId: string;
    inputs: ReplayInput[];
    ticks: number;
}

// Recursively sorts object keys so the same logical value always serializes to the
// same string, regardless of property insertion order. Arrays keep their order
// (order is semantically meaningful for arrays, e.g. `inputs`).
export function canonicalStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
    if (value !== null && typeof value === 'object') {
        const keys = Object.keys(value as Record<string, unknown>).sort();
        const body = keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify((value as Record<string, unknown>)[k])}`);
        return `{${body.join(',')}}`;
    }
    return JSON.stringify(value);
}

export function hashCanonical(value: unknown): `0x${string}` {
    return keccak256(toHex(canonicalStringify(value)));
}

// The hash a verifier checks a submitted replay's `inputs`+`ticks` against, so a
// truncated or reordered log can be detected before spending a re-simulation.
// Takes only the two fields it hashes, so a ghost verifier holding just a raw
// trace (no full RunReplay envelope) computes the identical value.
export function replayHash(replay: Pick<RunReplay, 'inputs' | 'ticks'>): `0x${string}` {
    return hashCanonical({ inputs: replay.inputs, ticks: replay.ticks });
}

// Flat [tick, action, tick, action, ...] <-> ReplayInput[] — the wire-compact form
// actually sent over HTTP (half the JSON size of an array of objects).
export function encodeInputsFlat(inputs: ReplayInput[]): number[] {
    const out: number[] = [];
    for (const ev of inputs) out.push(ev.tick, ev.action);
    return out;
}
export function decodeInputsFlat(flat: number[]): ReplayInput[] {
    const out: ReplayInput[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) out.push({ tick: flat[i], action: flat[i + 1] });
    return out;
}

const MAX_TICKS_HARD = 60 * 60 * 45; // 45 min hard ceiling, mirrors sim.ts's MAX_TICKS
const MAX_INPUTS_HARD = 20_000; // generous: dashing on every beat for 45 min is ~2,700
const MIN_INPUT_GAP_TICKS = 2; // >30 inputs/sec sustained is not a human dash/lane sequence

export type ReplayRejection =
    | 'missing_input_log'
    | 'excessive_log_size'
    | 'truncated_or_zero_ticks'
    | 'future_tick'
    | 'out_of_order_tick'
    | 'unknown_action'
    | 'impossible_action_frequency';

// Structural validation — cheap, deterministic checks that reject a malformed or
// impossible replay BEFORE the server spends a re-simulation on it. Re-simulation
// (see server/src/index.ts) is what catches a *semantically* wrong replay (right
// shape, wrong outcome); this catches replays that couldn't possibly be a real
// play session at all.
export function validateReplayStructure(replay: Pick<RunReplay, 'inputs' | 'ticks'>): ReplayRejection | null {
    if (!replay.inputs || replay.inputs.length === 0) return 'missing_input_log';
    if (replay.inputs.length > MAX_INPUTS_HARD) return 'excessive_log_size';
    if (!Number.isInteger(replay.ticks) || replay.ticks <= 0 || replay.ticks > MAX_TICKS_HARD) {
        return 'truncated_or_zero_ticks';
    }

    let lastTick = -1;
    let denseRun = 0;
    for (const ev of replay.inputs) {
        if (!Number.isInteger(ev.tick) || !Number.isInteger(ev.action)) return 'unknown_action';
        if (ev.action !== 0 && ev.action !== 1 && ev.action !== 2) return 'unknown_action';
        if (ev.tick > replay.ticks) return 'future_tick';
        if (ev.tick < lastTick) return 'out_of_order_tick';
        denseRun = ev.tick - lastTick < MIN_INPUT_GAP_TICKS ? denseRun + 1 : 0;
        if (denseRun > 8) return 'impossible_action_frequency'; // 9+ inputs faster than 30/s back-to-back
        lastTick = ev.tick;
    }
    return null;
}
