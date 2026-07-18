// Non-mutating check: does server/src/sim/* still match what `npm run sim:sync`
// would produce from src/sim/*? Fails (exit 1) on any drift, without writing
// anything — safe to run in CI on a read-only checkout. This is the actual
// enforcement mechanism behind "src/sim is the documented source of truth":
// a PR that edits src/sim without re-running sim:sync fails CI here, instead of
// silently shipping a server that verifies against different rules than the
// client just played.
import { readFileSync, existsSync } from 'node:fs';

const FILES = ['prng.ts', 'sim.ts', 'replay.ts', 'ruleset.ts', 'verify.ts', 'grid.ts'];
const HEADER_LINES = 3; // the auto-generated header sync-sim.mjs prepends

let drift = [];
for (const f of FILES) {
    const clientPath = `src/sim/${f}`;
    const serverPath = `server/src/sim/${f}`;
    if (!existsSync(serverPath)) {
        drift.push(`${serverPath} does not exist`);
        continue;
    }
    const client = readFileSync(clientPath, 'utf8');
    const serverRaw = readFileSync(serverPath, 'utf8');
    const server = serverRaw.split('\n').slice(HEADER_LINES).join('\n');
    if (client !== server) drift.push(`${serverPath} does not match src/sim/${f}`);
}

if (drift.length > 0) {
    console.error('\n❌ SIM:CHECK FAILED — server/src/sim/* has drifted from src/sim/*\n');
    for (const d of drift) console.error(`   ${d}`);
    console.error('\nRun `npm run sim:sync` and commit the result.\n');
    process.exit(1);
}

console.log(`✓ sim:check passed — server/src/sim/* matches src/sim/* for [${FILES.join(', ')}]`);
