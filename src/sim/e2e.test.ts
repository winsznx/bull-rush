// End-to-end verification proof. Run: npx tsx src/sim/e2e.test.ts
// Mimics the full path: client plays -> flattens input log -> server decodes ->
// re-simulates -> compares to the claimed score. Honest runs pass; tampered,
// forged, and wrong-seed submissions are rejected.
import { SimRunner } from './runner';
import { simulate, Act, type InputEvent } from './sim';

let fail = 0;
const check = (n: string, ok: boolean): void => {
    console.log((ok ? '  ✓  ' : '  ✗ FAIL  ') + n);
    if (!ok) fail++;
};

const flatten = (log: InputEvent[]): number[] => {
    const il: number[] = [];
    for (const e of log) il.push(e.tick, e.act);
    return il;
};
const decode = (il: number[]): InputEvent[] => {
    const out: InputEvent[] = [];
    for (let i = 0; i + 1 < il.length; i += 2) {
        const a = il[i + 1];
        if (a === 0 || a === 1 || a === 2) out.push({ tick: il[i], act: a as Act });
    }
    return out;
};
const verify = (seed: string, il: number[], ticks: number, claimDist: number, claimScore: number) => {
    const r = simulate(seed, decode(il), ticks);
    return { ok: Math.abs(r.distance - claimDist) <= 2 && Math.abs(r.score - claimScore) <= 4, r };
};

// --- "play" a run through the runner (as the browser would) ---
const seed = 'e2e-seed-77';
const runner = new SimRunner(seed);
const JIT = [16, 33, 8, 24, 40, 12, 20, 17];
const presses: Act[] = [];
for (let k = 0; k < 800; k++) presses.push(k % 4 === 0 ? Act.Dash : k % 2 === 0 ? Act.Left : Act.Right);
let f = 0;
let nextT = 25;
let pi = 0;
while (runner.alive && runner.tick < 18000) {
    if (runner.tick >= nextT && pi < presses.length) {
        runner.input(presses[pi++]);
        nextT += 19;
    }
    runner.advance(JIT[f++ % JIT.length] / 1000);
}
const il = flatten(runner.log);
console.log(`\nplayed: dist=${runner.distance}m score=${runner.score} ticks=${runner.tick} inputs=${runner.log.length} il-ints=${il.length}\n`);

check('honest run: re-sim reproduces the claim (VERIFY MATCH)', verify(seed, il, runner.tick, runner.distance, runner.score).ok);
check('inflated distance (+5000m): rejected', !verify(seed, il, runner.tick, runner.distance + 5000, runner.score).ok);
check('forged run (no real inputs, huge claim): rejected', !verify(seed, [], runner.tick, 150000, 400000).ok);
check('replay under a DIFFERENT seed: rejected', !verify('different-seed', il, runner.tick, runner.distance, runner.score).ok);
check('truncated input log (dropped last 20 inputs): rejected', !verify(seed, il.slice(0, Math.max(0, il.length - 40)), runner.tick, runner.distance, runner.score).ok);

console.log(fail === 0 ? '\nE2E VERIFY OK ✅\n' : `\n${fail} FAIL ❌\n`);
if (fail > 0) throw new Error('e2e verify failed');
