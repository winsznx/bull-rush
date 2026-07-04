// Determinism harness for the sim. Run: npx tsx src/sim/synctest.ts
// Proves: (1) same seed+inputs => bit-identical result & checksums,
//         (2) changing the seed or the inputs changes the outcome,
//         (3) determinism holds across many seeds.
import { simulate, createSim, stepSim, simDistance, simScore, Act, type InputEvent, type SimResult } from './sim';

let failures = 0;
function check(name: string, cond: boolean): void {
    console.log(`${cond ? '  ✓' : '  ✗ FAIL'}  ${name}`);
    if (!cond) failures++;
}

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

console.log('\n1) SYNCTEST — same seed + inputs, run twice:');
const r1 = simulate(seed, inputs, 18000);
const r2 = simulate(seed, inputs, 18000);
check('bit-identical result & checksums', eq(r1, r2));
console.log(`     -> dist=${r1.distance}m score=${r1.score} hearts=${r1.hearts} endTick=${r1.endTick} alive=${r1.alive} "${r1.deathCause}" checksums=${r1.checksums.length}`);

console.log('\n2) different SEED must change the run:');
const rSeed = simulate('ffffffff00000001', inputs, 18000);
check('different seed => different distance or death', rSeed.distance !== r1.distance || rSeed.deathCause !== r1.deathCause);
console.log(`     -> dist=${rSeed.distance}m "${rSeed.deathCause}"`);

console.log('\n3) different INPUTS must change the run (6 variants):');
const outs = [0, 1, 2, 3, 4, 5].map((v) => simulate(seed, script(v), 18000));
const distinct = new Set(outs.map((o) => `${o.distance}:${o.endTick}:${o.deathCause}`));
check('input variants produce differing outcomes', distinct.size > 1);
console.log(`     -> ${outs.map((o) => o.distance + 'm').join(', ')}`);

console.log('\n4) no inputs (stand in lane 0) should die before the cap:');
const rIdle = simulate(seed, [], 18000);
check('idle run is not alive at cap', !rIdle.alive);
console.log(`     -> dist=${rIdle.distance}m endTick=${rIdle.endTick} "${rIdle.deathCause}"`);

console.log('\n5) determinism across 200 seeds (each stable across 2 runs):');
let stable = true;
for (let i = 0; i < 200; i++) {
    const s = `seed-${i}`;
    if (!eq(simulate(s, inputs, 8000), simulate(s, inputs, 8000))) stable = false;
}
check('200 seeds each reproduce identically', stable);

console.log('\n6) live stepping ≡ batch verify (what the client plays == what the server checks):');
{
    // Drive the sim tick-by-tick like the client will, recording inputs into a log.
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
    const match =
        simDistance(s) === verified.distance &&
        simScore(s) === verified.score &&
        s.deathCause === verified.deathCause &&
        s.tick === verified.endTick &&
        s.checksums.join(',') === verified.checksums.join(',');
    check('live-play log re-simulates to the identical result', match);
    console.log(`     -> live dist=${simDistance(s)}m  ==  server-verified dist=${verified.distance}m`);
}

console.log(`\n${failures === 0 ? 'ALL PASS ✅' : `${failures} FAILURE(S) ❌`}\n`);
if (failures > 0) throw new Error(`${failures} synctest failure(s)`);
