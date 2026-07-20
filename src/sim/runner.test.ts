// Proves the SimRunner produces a submission log that re-simulates identically,
// even under irregular frame timing, and that it cannot be fast-forwarded.
import { describe, expect, it } from 'vitest';
import { SimRunner } from './runner';
import { simulate, Act } from './sim';

// Deterministic pseudo-jitter in [8ms, 100ms] — simulates a variable frame rate
// (and occasional stalls) without Math.random.
const JITTER = [16, 33, 8, 24, 40, 12, 20, 17, 9, 30, 100, 16];
const jitter = (i: number): number => JITTER[i % JITTER.length] / 1000;

function playJittery(seed: string): { runner: SimRunner } {
    const runner = new SimRunner(seed);
    const presses: Act[] = [];
    for (let k = 0; k < 500; k++) presses.push(k % 4 === 0 ? Act.Dash : k % 2 === 0 ? Act.Left : Act.Right);
    let pp = 0;
    let frame = 0;
    let nextPressTick = 25;
    while (runner.alive && runner.tick < 18000) {
        if (runner.tick >= nextPressTick && pp < presses.length) {
            runner.input(presses[pp++]);
            nextPressTick += 19;
        }
        runner.advance(jitter(frame++));
    }
    return { runner };
}

describe('SimRunner', () => {
    it('produces a log that re-simulates to the identical distance/score/death/tick under frame jitter', () => {
        // #given a run driven through jittery, irregular frame deltas
        const { runner } = playJittery('runner-seed-01');
        // #when the server re-simulates the exact log the runner produced
        const verified = simulate('runner-seed-01', runner.log, runner.tick);
        // #then every canonical value matches — jitter never alters the outcome
        expect(runner.distance).toBe(verified.distance);
        expect(runner.score).toBe(verified.score);
        expect(runner.deathCause).toBe(verified.deathCause);
        expect(runner.tick).toBe(verified.endTick);
    });

    it('cannot be fast-forwarded by a long render stall (backgrounded tab)', () => {
        // #given a runner that receives one enormous frame delta (a 10-minute stall)
        const bg = new SimRunner('bg-seed');
        // #when it advances by 600 real seconds in a single call
        bg.advance(600);
        // #then the accumulator caps catch-up ticks — it does not convert that real
        // time into free distance
        expect(bg.tick).toBeLessThanOrEqual(5);
    });
});
