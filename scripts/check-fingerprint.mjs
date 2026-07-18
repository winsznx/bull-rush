// Cross-process determinism check: runs src/sim/fingerprint.ts in two genuinely
// separate Node processes and asserts they print the identical fingerprint. This
// is the one property vitest itself can't prove (everything in a vitest run
// shares one process/module cache) — it's the actual client-vs-server guarantee
// the whole replay-verification scheme rests on, so it gets its own script rather
// than being left as a manual `npx tsx` step two people run differently.
import { execFileSync } from 'node:child_process';

function run() {
    return execFileSync('npx', ['tsx', 'src/sim/fingerprint.ts'], { encoding: 'utf8' }).trim();
}

const a = run();
const b = run();

if (a !== b || !a.startsWith('FINGERPRINT')) {
    console.error('\n❌ CROSS-PROCESS DETERMINISM CHECK FAILED\n');
    console.error(`   process A: ${a}`);
    console.error(`   process B: ${b}`);
    process.exit(1);
}

console.log(`✓ cross-process determinism check passed — ${a}`);
