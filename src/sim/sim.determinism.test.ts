// Determinism proof for the deterministic engine. Converted from the original
// ad hoc script (npx tsx src/sim/synctest.ts) into a real vitest suite so it runs
// under `npm run sim:test` / CI instead of being a manually-invoked script.
import { describe, expect, it } from 'vitest';
import { simulate, createSim, stepSim, simDistance, simScore, Act, type InputEvent, type SimResult } from './sim';

// A fixed, deterministic input script (no Math.random in the test itself).
// `variant` shifts the lane/dash sequence so different variants take different paths.
function script(variant = 0): InputEvent[] {
    const ev: InputEvent[] = [];
    let i = 0;
    for (let t = 30; t < 18000; t += 23) {
        const k = i + variant;
        const act = k % 5 === 0 ? Act.Dash : k % 2 === 0 ? Act.Left : Act.Right;
        ev.push({ tick: t, act });
        i++;
    }
    return ev;
}

function eq(a: SimResult, b: SimResult): boolean {
    return (
        a.alive === b.alive &&
        a.endTick === b.endTick &&
        a.distance === b.distance &&
        a.score === b.score &&
        a.hearts === b.hearts &&
        a.deathCause === b.deathCause &&
        a.checksums.length === b.checksums.length &&
        a.checksums.every((c, i) => c === b.checksums[i])
    );
}

const seed = 'a3f9c1d20e4b6817';
const inputs = script();

describe('deterministic sim', () => {
    it('same seed + inputs, run twice, are bit-identical (result + checksums)', () => {
        const r1 = simulate(seed, inputs, 18000);
        const r2 = simulate(seed, inputs, 18000);
        expect(eq(r1, r2)).toBe(true);
    });

    it('a different seed changes the outcome', () => {
        const r1 = simulate(seed, inputs, 18000);
        const rSeed = simulate('ffffffff00000001', inputs, 18000);
        expect(rSeed.distance !== r1.distance || rSeed.deathCause !== r1.deathCause).toBe(true);
    });

    it('different input traces produce differing outcomes (6 variants)', () => {
        const outs = [0, 1, 2, 3, 4, 5].map((v) => simulate(seed, script(v), 18000));
        const distinct = new Set(outs.map((o) => `${o.distance}:${o.endTick}:${o.deathCause}`));
        expect(distinct.size).toBeGreaterThan(1);
    });

    it('no inputs at all (never leaves lane 0) dies before the tick cap', () => {
        const rIdle = simulate(seed, [], 18000);
        expect(rIdle.alive).toBe(false);
    });

    it('is stable across 200 distinct seeds, each reproduced twice', () => {
        for (let i = 0; i < 200; i++) {
            const s = `seed-${i}`;
            expect(eq(simulate(s, inputs, 8000), simulate(s, inputs, 8000))).toBe(true);
        }
    });

    it('live tick-by-tick stepping ≡ batch re-simulation (client path == server path)', () => {
        const s = createSim(seed);
        const log: InputEvent[] = [];
        const scripted = script(3);
        let sp = 0;
        while (s.alive && s.tick < 18000) {
            const acts: Act[] = [];
            while (sp < scripted.length && scripted[sp].tick === s.tick) {
                acts.push(scripted[sp].act);
                log.push({ tick: s.tick, act: scripted[sp].act });
                sp++;
            }
            stepSim(s, acts);
        }
        const verified = simulate(seed, log, 18000);
        expect(simDistance(s)).toBe(verified.distance);
        expect(simScore(s)).toBe(verified.score);
        expect(s.deathCause).toBe(verified.deathCause);
        expect(s.tick).toBe(verified.endTick);
        expect(s.checksums.join(',')).toBe(verified.checksums.join(','));
    });

    it('a maximum-duration run (45 min, ~2,700 inputs) completes quickly and within bounds', () => {
        const MAX_TICKS = 60 * 60 * 45;
        const longInputs: InputEvent[] = [];
        for (let t = 30, i = 0; t < MAX_TICKS; t += 60, i++) {
            longInputs.push({ tick: t, act: i % 3 === 0 ? Act.Dash : i % 2 === 0 ? Act.Left : Act.Right });
        }
        const start = Date.now();
        const r = simulate(seed, longInputs, MAX_TICKS);
        const elapsedMs = Date.now() - start;
        expect(r.endTick).toBeLessThanOrEqual(MAX_TICKS);
        expect(Number.isFinite(r.distance)).toBe(true);
        expect(elapsedMs).toBeLessThan(5000); // generous — a 45-min run resimulates in well under 5s
    });
});
