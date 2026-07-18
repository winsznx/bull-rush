// End-to-end check against a LOCAL server: play a run, submit its canonical
// replay, confirm the server re-simulates and derives the canonical result —
// and that a tampered envelope (wrong seed) is rejected outright.
//   npm run local:verify   (server must be running on :8787)
import { SimRunner } from '../src/sim/runner.ts';
import { Act } from '../src/sim/sim.ts';
import { REPLAY_SCHEMA_VERSION, type RunReplay } from '../src/sim/replay.ts';
import { GAME_VERSION, RULESET_HASH } from '../src/sim/ruleset.ts';

const API = process.env.API ?? 'http://localhost:8787';
const KEY = process.env.ADMIN_KEY ?? 'local-admin-key';

interface Payload {
    token: string;
    name: string;
    replay: RunReplay;
}

async function playAndSubmit(name: string, tamper?: (r: RunReplay) => void): Promise<{ distance: number; res: unknown }> {
    const start = (await (await fetch(`${API}/api/run/start`, { method: 'POST' })).json()) as {
        seed: `0x${string}`;
        token: string;
    };
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
    const replay: RunReplay = {
        schemaVersion: REPLAY_SCHEMA_VERSION,
        gameVersion: GAME_VERSION,
        rulesetHash: RULESET_HASH,
        seed: start.seed,
        runId: start.token,
        inputs: runner.log.map((e) => ({ tick: e.tick, action: e.act })),
        ticks: runner.tick,
    };
    if (tamper) tamper(replay);
    const payload: Payload = { token: start.token, name, replay };
    const res = await (
        await fetch(`${API}/api/run/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    ).json();
    return { distance: runner.distance, res };
}

const health = await (await fetch(`${API}/health`)).json();
console.log('\nhealth:', JSON.stringify(health));

const honest = await playAndSubmit('LOCALTEST');
console.log(`honest run: played ${honest.distance}m  ->  server:`, JSON.stringify(honest.res));

const cheat = await playAndSubmit('CHEATER', (r) => {
    r.seed = '0xdeadbeef' as `0x${string}`;
});
console.log(`tampered (wrong seed) ->  server:`, JSON.stringify(cheat.res));

const stats = (await (await fetch(`${API}/api/admin/stats`, { headers: { 'x-admin-key': KEY } })).json()) as {
    verify?: { accepted: number; rejected: Record<string, number> };
};
console.log('\nverify counters:', JSON.stringify(stats.verify));
console.log(
    (stats.verify?.accepted ?? 0) >= 1 && (stats.verify?.rejected?.wrong_seed ?? 0) >= 1
        ? '\n✅ LOCAL LOOP WORKS — honest run accepted, tampered-seed run rejected\n'
        : '\n⚠️ unexpected counters — check the server logs\n',
);
