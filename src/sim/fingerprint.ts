// Cross-process determinism proof. Run in two separate processes; the
// FINGERPRINT must be identical (it hashes 500 runs' outputs + checksums).
// If integer determinism holds, two independent V8 instances agree — which is
// exactly the client-vs-server guarantee the verification scheme relies on.
import { simulate, Act, type InputEvent } from './sim';

const acts = [Act.Left, Act.Dash, Act.Right];
const ev: InputEvent[] = [];
for (let t = 20; t < 12000; t += 17) ev.push({ tick: t, act: acts[t % 3] });

let acc = 2166136261 >>> 0;
for (let i = 0; i < 500; i++) {
    const r = simulate(`fp-${i}`, ev, 12000);
    for (const v of [r.distance, r.score, r.endTick, r.hearts, ...r.checksums]) {
        acc = Math.imul(acc ^ (v | 0), 16777619) >>> 0;
    }
}
console.log('FINGERPRINT', acc);
