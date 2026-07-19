import { describe, expect, it } from 'vitest';
import { buildGhostTrace, verifyGhostReplay } from './ghost';
import { simulate, Act, type InputEvent } from './sim';
import { encodeInputsFlat, replayHash, type ReplayInput } from './replay';

const SEED = '0xghost-test-seed';

// Wire format ({tick, action}) — what a served ghost decodes to.
function playedInputs(): ReplayInput[] {
    const inputs: ReplayInput[] = [];
    for (let t = 25, i = 0; t < 3000; t += 19, i++) {
        inputs.push({ tick: t, action: i % 4 === 0 ? Act.Dash : i % 2 === 0 ? Act.Left : Act.Right });
    }
    return inputs;
}

// The server's own mapping before it re-simulates.
function toSimInputs(inputs: ReplayInput[]): InputEvent[] {
    return inputs.map((i) => ({ tick: i.tick, act: i.action as Act }));
}

describe('buildGhostTrace', () => {
    it('ends exactly where simulate() says the run ends', () => {
        // #given a played input log
        const inputs = playedInputs();
        // #when the trace and the authoritative re-simulation both run
        const trace = buildGhostTrace(SEED, inputs, 6000);
        const result = simulate(SEED, toSimInputs(inputs), 6000);
        // #then the trace's final state matches the canonical result exactly
        expect(trace.endTick).toBe(result.endTick);
        expect(trace.finalDistance).toBe(result.distance);
        expect(trace.dists[trace.dists.length - 1]).toBe(result.distance);
    });

    it('has one entry per completed tick plus the initial state', () => {
        const inputs = playedInputs();
        const trace = buildGhostTrace(SEED, inputs, 6000);
        expect(trace.xs.length).toBe(trace.endTick + 1);
        expect(trace.dists.length).toBe(trace.endTick + 1);
        expect(trace.xs[0]).toBe(0);
        expect(trace.dists[0]).toBe(0);
    });

    it('is deterministic — two builds are identical', () => {
        const inputs = playedInputs();
        const a = buildGhostTrace(SEED, inputs, 6000);
        const b = buildGhostTrace(SEED, inputs, 6000);
        expect(a).toEqual(b);
    });

    it('distance is monotonically non-decreasing along the trace', () => {
        const trace = buildGhostTrace(SEED, playedInputs(), 6000);
        for (let i = 1; i < trace.dists.length; i++) {
            expect(trace.dists[i]).toBeGreaterThanOrEqual(trace.dists[i - 1]);
        }
    });
});

describe('verifyGhostReplay', () => {
    it('accepts a trace whose recomputed hash matches the claimed hash', () => {
        // #given a replay and the hash the server would have stored for it
        const inputs = playedInputs();
        const ticks = 3000;
        const claimed = replayHash({ inputs, ticks });
        // #when verified from the flat wire encoding
        const verified = verifyGhostReplay(encodeInputsFlat(inputs), ticks, claimed);
        // #then it decodes to the identical input log
        expect(verified).not.toBeNull();
        expect(verified?.inputs).toEqual(inputs);
    });

    it('rejects a tampered trace (an input changed after hashing)', () => {
        const inputs = playedInputs();
        const ticks = 3000;
        const claimed = replayHash({ inputs, ticks });
        const flat = encodeInputsFlat(inputs);
        flat[1] = flat[1] === Act.Left ? Act.Right : Act.Left;
        expect(verifyGhostReplay(flat, ticks, claimed)).toBeNull();
    });

    it('rejects a truncated trace', () => {
        const inputs = playedInputs();
        const ticks = 3000;
        const claimed = replayHash({ inputs, ticks });
        const flat = encodeInputsFlat(inputs).slice(0, 10);
        expect(verifyGhostReplay(flat, ticks, claimed)).toBeNull();
    });

    it('rejects a wrong tick count', () => {
        const inputs = playedInputs();
        const claimed = replayHash({ inputs, ticks: 3000 });
        expect(verifyGhostReplay(encodeInputsFlat(inputs), 2999, claimed)).toBeNull();
    });
});
