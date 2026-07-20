// Behavioral risk signals for competitive submissions — pure functions, no I/O,
// fully unit-testable. Each signal answers one narrow question; assessRun()
// combines them into a verdict plus the explicit reason list that lands in
// verified_runs.risk_reasons (what Phase 12's manual review reads).
//
// Design stance: architectural anti-cheat (deterministic re-simulation, one-time
// tickets, exact-hash replay uniqueness) makes score FORGERY impossible; these
// signals target what remains — machine play, replay theft with perturbation,
// and wall-clock-implausible runs. Signals shadow-hold (risk_hold); they never
// hard-reject, so a false positive costs review time, not a banned honest player.
import type { ReplayInput } from './sim/replay.ts';

export const MIN_RUN_MS = 1500;
export const MAX_RUN_MS = 1_800_000;

export type RiskReason = 'too_fast' | 'too_long' | 'bot_like_cadence' | 'near_duplicate_replay';

// Machine-regularity: humans cannot press with near-zero gap variance, and
// sustained >12 inputs/sec is not lane-running. Applied only past 30 inputs —
// small samples make variance meaningless. (Same thresholds the practice path
// has used since Phase 2; moved here so grid + practice share one definition.)
export function cadenceSignal(inputs: readonly { tick: number }[], endTick: number): boolean {
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

export function durationSignal(durationMs: number): RiskReason | null {
    if (durationMs < MIN_RUN_MS) return 'too_fast';
    if (durationMs > MAX_RUN_MS) return 'too_long';
    return null;
}

// ---------------------------------------------------------------------------
// Near-duplicate replay detection (the perturbed-copy attack ADR 0009 deferred
// here). Ghost replays are public and every grid shares one seed, so a stolen
// input log with a few ticks nudged evades the exact-hash gate while still
// re-simulating to roughly the original's result. What a copier CANNOT change
// without desyncing the run is the input sequence's structure and micro-timing:
// two honest humans never agree tick-exactly (±tolerance) on the overwhelming
// majority of hundreds of inputs, but a jittered copy does by construction.
// ---------------------------------------------------------------------------

export const SIMILARITY_TICK_TOLERANCE = 3;
export const SIMILARITY_THRESHOLD = 0.85;
// Lower than the cadence signal's 30-input floor deliberately: cadence needs a
// sample for variance estimation, but ≥0.85 of 15+ inputs each matching another
// player's log within ±3 ticks does not happen between independent humans —
// and a short leader run would otherwise be freely copy-perturbable (caught
// live by verify-grid-local.ts when this floor was still 30).
export const SIMILARITY_MIN_INPUTS = 15;
// Cheap pre-filters: a perturbed copy necessarily lands near the original in
// both input count and outcome; anything farther apart is not worth an LCS.
export const SIMILARITY_LEN_WINDOW = 0.15;
export const SIMILARITY_DISTANCE_WINDOW = 0.15;

// Longest common subsequence where inputs "match" if the action is identical
// and the ticks are within tolerance — insertion/deletion-tolerant, so padding
// a stolen log with a couple of extra taps does not break alignment. O(n*m),
// bounded by the candidate pre-filters plus the validator's input cap.
export function replaySimilarity(a: readonly ReplayInput[], b: readonly ReplayInput[]): number {
    const n = a.length;
    const m = b.length;
    if (n === 0 || m === 0) return 0;

    let prev = new Array<number>(m + 1).fill(0);
    let curr = new Array<number>(m + 1).fill(0);
    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            const matches = a[i - 1].action === b[j - 1].action && Math.abs(a[i - 1].tick - b[j - 1].tick) <= SIMILARITY_TICK_TOLERANCE;
            curr[j] = matches ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
        }
        [prev, curr] = [curr, prev];
    }
    return prev[m] / Math.max(n, m);
}

export interface SimilarityCandidate {
    inputs: ReplayInput[];
    identityKey: string;
}

export interface RunAssessment {
    suspicious: boolean;
    reasons: RiskReason[];
}

export function assessRun(p: {
    inputs: readonly ReplayInput[];
    endTick: number;
    durationMs: number;
    candidates: readonly SimilarityCandidate[];
}): RunAssessment {
    const reasons: RiskReason[] = [];

    const duration = durationSignal(p.durationMs);
    if (duration) reasons.push(duration);
    if (cadenceSignal(p.inputs, p.endTick)) reasons.push('bot_like_cadence');

    if (p.inputs.length >= SIMILARITY_MIN_INPUTS) {
        for (const candidate of p.candidates) {
            if (replaySimilarity(p.inputs, candidate.inputs) >= SIMILARITY_THRESHOLD) {
                reasons.push('near_duplicate_replay');
                break;
            }
        }
    }

    return { suspicious: reasons.length > 0, reasons };
}
