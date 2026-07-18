// Canonical replay schema + encoding/hashing + structural validation.
//
// This is what a client submits as proof of a run, and what the server hashes and
// re-simulates. Two rules matter more than anything else here:
//   1. NEVER hash `JSON.stringify(obj)` on an arbitrary object — key order is not
//      guaranteed stable across engines/versions, so two semantically-identical
//      replays could hash differently. `canonicalStringify` below fixes key order
//      explicitly (recursively, alphabetically) before anything is hashed.
//   2. The hash function itself (`fnv1aHex`) is a fast, deterministic 32-bit
//      fingerprint — NOT a cryptographic commitment. It is sufficient for
//      off-chain consistency checks (server-side ruleset/replay matching) but is
//      NOT what should back an on-chain receipt; Phase 6's contracts must hash
//      the on-chain-bound fields with keccak256 (via viem) instead. Kept as a
//      separate, clearly-named function specifically so that upgrade is a
//      one-function swap, not an architecture change.

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

// FNV-1a, 32-bit, hex-encoded as a 0x-prefixed 8-char string. Deterministic,
// dependency-free, identical in browser and Node. Not cryptographically secure —
// see the module header.
export function fnv1aHex(input: string): `0x${string}` {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    const hex = (h >>> 0).toString(16).padStart(8, '0');
    return `0x${hex}`;
}

export function hashCanonical(value: unknown): `0x${string}` {
    return fnv1aHex(canonicalStringify(value));
}

// The hash a verifier checks a submitted replay's `inputs`+`ticks` against, so a
// truncated or reordered log can be detected before spending a re-simulation.
export function replayHash(replay: RunReplay): `0x${string}` {
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
