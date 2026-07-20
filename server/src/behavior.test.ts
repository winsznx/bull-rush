import { describe, expect, it } from 'vitest';
import { assessRun, cadenceSignal, durationSignal, replaySimilarity, SIMILARITY_THRESHOLD } from './behavior';
import type { ReplayInput } from './sim/replay';

// A believable human input log: irregular gaps, mixed actions.
function humanLog(count: number, seedOffset = 0): ReplayInput[] {
    const gaps = [13, 27, 18, 34, 15, 22, 41, 17, 25, 19];
    const out: ReplayInput[] = [];
    let t = 25 + seedOffset;
    for (let i = 0; i < count; i++) {
        out.push({ tick: t, action: i % 4 === 0 ? 2 : i % 2 === 0 ? 0 : 1 });
        t += gaps[(i + seedOffset) % gaps.length];
    }
    return out;
}

// Machine log: perfectly regular cadence.
function machineLog(count: number, gap = 19): ReplayInput[] {
    return Array.from({ length: count }, (_, i) => ({ tick: 25 + i * gap, action: i % 3 }));
}

describe('cadenceSignal', () => {
    it('flags a perfectly regular cadence once past 30 inputs', () => {
        const log = machineLog(40);
        expect(cadenceSignal(log, log[log.length - 1].tick + 10)).toBe(true);
    });

    it('does not flag the same regular cadence under the 30-input floor', () => {
        const log = machineLog(29);
        expect(cadenceSignal(log, log[log.length - 1].tick + 10)).toBe(false);
    });

    it('does not flag human-jittered cadence', () => {
        const log = humanLog(80);
        expect(cadenceSignal(log, log[log.length - 1].tick + 10)).toBe(false);
    });

    it('flags impossible sustained input rate', () => {
        // 40 inputs inside 60 ticks (1 second) = 40/sec
        const log = Array.from({ length: 40 }, (_, i) => ({ tick: 20 + Math.floor(i * 1.5) + (i % 3), action: i % 3 }));
        expect(cadenceSignal(log, 90)).toBe(true);
    });
});

describe('durationSignal', () => {
    it('flags too-fast and too-long runs, passes normal ones', () => {
        expect(durationSignal(900)).toBe('too_fast');
        expect(durationSignal(2_000_000)).toBe('too_long');
        expect(durationSignal(45_000)).toBeNull();
    });
});

describe('replaySimilarity', () => {
    it('scores an identical log as 1', () => {
        const log = humanLog(100);
        expect(replaySimilarity(log, log)).toBe(1);
    });

    it('scores a tick-jittered copy (±2) above the near-duplicate threshold', () => {
        // #given the perturbed-copy attack: stolen log, every tick nudged
        const original = humanLog(100);
        const jittered = original.map((ev, i) => ({ tick: ev.tick + ((i % 5) - 2), action: ev.action }));
        // #then LCS with tick tolerance still sees it as the same run
        expect(replaySimilarity(original, jittered)).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
    });

    it('survives a few inserted decoy inputs (alignment does not break)', () => {
        const original = humanLog(100);
        const padded = [...original];
        padded.splice(20, 0, { tick: original[20].tick + 1, action: 2 });
        padded.splice(60, 0, { tick: original[59].tick + 2, action: 0 });
        expect(replaySimilarity(original, padded)).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
    });

    it('scores two independent human runs well below the threshold', () => {
        // #given two honest logs with different timing structure entirely
        const a = humanLog(100);
        const b = humanLog(100, 7); // different phase/offsets -> different micro-timing
        expect(replaySimilarity(a, b)).toBeLessThan(SIMILARITY_THRESHOLD);
    });

    it('handles empty logs', () => {
        expect(replaySimilarity([], humanLog(10))).toBe(0);
    });
});

describe('assessRun', () => {
    it('passes an honest run with no candidates', () => {
        const log = humanLog(80);
        const res = assessRun({ inputs: log, endTick: log[log.length - 1].tick + 10, durationMs: 45_000, candidates: [] });
        expect(res.suspicious).toBe(false);
        expect(res.reasons).toEqual([]);
    });

    it('accumulates multiple reasons', () => {
        const log = machineLog(60);
        const res = assessRun({ inputs: log, endTick: log[log.length - 1].tick + 10, durationMs: 900, candidates: [] });
        expect(res.suspicious).toBe(true);
        expect(res.reasons).toContain('too_fast');
        expect(res.reasons).toContain('bot_like_cadence');
    });

    it('flags a near-duplicate against a candidate and names the reason', () => {
        const original = humanLog(100);
        const jittered = original.map((ev, i) => ({ tick: ev.tick + ((i % 5) - 2), action: ev.action }));
        const res = assessRun({
            inputs: jittered,
            endTick: jittered[jittered.length - 1].tick + 10,
            durationMs: 45_000,
            candidates: [{ inputs: original, identityKey: 'victim' }],
        });
        expect(res.suspicious).toBe(true);
        expect(res.reasons).toEqual(['near_duplicate_replay']);
    });

    it('skips similarity entirely for short logs (small-sample noise)', () => {
        const short = humanLog(10);
        const res = assessRun({
            inputs: short,
            endTick: 400,
            durationMs: 8_000,
            candidates: [{ inputs: short, identityKey: 'x' }], // identical, but under the floor
        });
        expect(res.suspicious).toBe(false);
    });
});
