// Ghost races: pre-compute a verified replay's full per-tick position trace so the
// render loop can place the ghost at the player's CURRENT tick with two array
// lookups — a lockstep same-tick comparison on the same grid seed, not a wall-clock
// approximation. Client-only presentation code (deliberately NOT in the sim:sync
// set: the server never renders a ghost; it serves the raw replay and its hash).
import { createSim, stepSim, simDistance, simPlayerX, MAX_TICKS, type Act } from './sim';
import { replayHash, decodeInputsFlat, type ReplayInput } from './replay';

export interface GhostTrace {
    /** Index = completed ticks; [0] is the pre-first-tick state. */
    xs: number[];
    dists: number[];
    endTick: number;
    finalDistance: number;
}

// Takes the wire-format ReplayInput[] (what a served ghost decodes to) and maps
// to sim actions internally — the same mapping the server's submit handler does
// before re-simulating.
export function buildGhostTrace(seed: string, inputs: ReplayInput[], ticks: number): GhostTrace {
    const s = createSim(seed);
    const cap = Math.min(ticks, MAX_TICKS);
    const xs: number[] = [simPlayerX(s)];
    const dists: number[] = [simDistance(s)];
    let ip = 0;
    const acts: Act[] = [];
    while (s.tick < cap && s.alive) {
        acts.length = 0;
        while (ip < inputs.length && inputs[ip].tick === s.tick) acts.push(inputs[ip++].action as Act);
        while (ip < inputs.length && inputs[ip].tick < s.tick) ip++;
        stepSim(s, acts);
        xs.push(simPlayerX(s));
        dists.push(simDistance(s));
    }
    return { xs, dists, endTick: s.tick, finalDistance: simDistance(s) };
}

export interface VerifiedGhostReplay {
    inputs: ReplayInput[];
    ticks: number;
}

// The "verified" in verified ghost races: recompute the replay hash from the raw
// bytes the server handed over and refuse the ghost unless it matches the hash the
// server claims (the same hash that is receipted on-chain via RunRecorded). A
// tampered or corrupted trace never becomes a ghost.
export function verifyGhostReplay(inputsFlat: number[], ticks: number, claimedHash: `0x${string}`): VerifiedGhostReplay | null {
    const inputs = decodeInputsFlat(inputsFlat);
    if (replayHash({ inputs, ticks }) !== claimedHash) return null;
    return { inputs, ticks };
}
