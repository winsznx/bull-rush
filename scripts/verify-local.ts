// End-to-end check against a LOCAL server: play a run, submit its input log,
// confirm the server re-simulates a match — and that a tampered submit is caught.
//   npm run local:verify   (server must be running on :8787)
import { SimRunner } from '../src/sim/runner.ts';
import { Act } from '../src/sim/sim.ts';

const API = process.env.API ?? 'http://localhost:8787';
const KEY = process.env.ADMIN_KEY ?? 'local-admin-key';

interface Payload {
    token: string;
    name: string;
    distance: number;
    score: number;
    durationMs: number;
    il: number[];
    ticks: number;
}

async function playAndSubmit(name: string, tamper?: (p: Payload) => void): Promise<{ distance: number; res: unknown }> {
    const start = (await (await fetch(`${API}/api/run/start`, { method: 'POST' })).json()) as { seed: string; token: string };
    const runner = new SimRunner(start.seed);
    const presses: Act[] = [];
    for (let k = 0; k < 800; k++) presses.push(k % 4 === 0 ? Act.Dash : k % 2 === 0 ? Act.Left : Act.Right);
    const JIT = [16, 33, 8, 24, 40, 12, 20, 17];
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
    const il: number[] = [];
    for (const e of runner.log) il.push(e.tick, e.act);
    const payload: Payload = {
        token: start.token,
        name,
        distance: runner.distance,
        score: runner.score,
        durationMs: Math.round((runner.tick / 60) * 1000),
        il,
        ticks: runner.tick,
    };
    if (tamper) tamper(payload);
    const res = await (
        await fetch(`${API}/api/run/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    ).json();
    return { distance: runner.distance, res };
}

const health = await (await fetch(`${API}/health`)).json();
console.log('\nhealth:', JSON.stringify(health));

const honest = await playAndSubmit('LOCALTEST');
console.log(`honest run: played ${honest.distance}m  ->  server:`, JSON.stringify(honest.res));

const cheat = await playAndSubmit('CHEATER', (p) => {
    p.distance += 9000;
});
console.log(`tampered (+9000m) ->  server:`, JSON.stringify(cheat.res));

const stats = (await (await fetch(`${API}/api/admin/stats`, { headers: { 'x-admin-key': KEY } })).json()) as {
    verify?: { match: number; mismatch: number; noreplay: number };
};
console.log('\nverify counters:', JSON.stringify(stats.verify));
console.log(
    (stats.verify?.match ?? 0) >= 1 && (stats.verify?.mismatch ?? 0) >= 1
        ? '\n✅ LOCAL LOOP WORKS — honest run verified (match), tampered run detected (mismatch)\n'
        : '\n⚠️ unexpected counters — check the server logs\n',
);
