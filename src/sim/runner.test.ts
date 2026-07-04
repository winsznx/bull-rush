// Proves the SimRunner produces a submission log that re-simulates identically,
// even under irregular frame timing. Run: npx tsx src/sim/runner.test.ts
import { SimRunner } from './runner';
import { simulate, Act } from './sim';

let fail = 0;
function check(name: string, ok: boolean): void {
    console.log((ok ? '  ✓  ' : '  ✗ FAIL  ') + name);
    if (!ok) fail++;
}

// Deterministic pseudo-jitter in [8ms, 40ms] — simulates a variable frame rate
// (and occasional stalls) without Math.random.
const JITTER = [16, 33, 8, 24, 40, 12, 20, 17, 9, 30, 100, 16];
const jitter = (i: number): number => JITTER[i % JITTER.length] / 1000;

const seed = 'runner-seed-01';
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

const verified = simulate(seed, runner.log, runner.tick);
check('runner log re-simulates to identical distance', runner.distance === verified.distance);
check('...identical score', runner.score === verified.score);
check('...identical death cause + end tick', runner.deathCause === verified.deathCause && runner.tick === verified.endTick);
console.log(
    `     runner dist=${runner.distance}m  ==  server-verified dist=${verified.distance}m   (ticks=${runner.tick}, logged inputs=${runner.log.length})`,
);

// A backgrounded tab (one giant frame) must NOT convert real time into distance.
const bg = new SimRunner('bg-seed');
bg.advance(600); // pretend 10 minutes passed in a single frame
check('600s single frame advances the sim by <= a few ticks (no fast-forward)', bg.tick <= 5);
console.log(`     background frame -> tick=${bg.tick}, distance=${bg.distance}m`);

console.log(fail === 0 ? '\nRUNNER OK ✅\n' : `\n${fail} FAIL ❌\n`);
if (fail > 0) throw new Error('runner mismatch');
