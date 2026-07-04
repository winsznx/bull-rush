// Copies the deterministic sim into the server package so it deploys with the
// API (Railway only uploads server/). ONE source of truth: edit src/sim, then
// `npm run sync-sim`. The server re-simulates with byte-identical code.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const FILES = ['prng.ts', 'sim.ts'];
const HEADER =
    '// AUTO-GENERATED from src/sim/$F — DO NOT EDIT HERE. Edit src/sim and run `npm run sync-sim`.\n' +
    '// Kept in server/ so the deployed API re-simulates with byte-identical code.\n\n';

mkdirSync('server/src/sim', { recursive: true });
for (const f of FILES) {
    const body = readFileSync(`src/sim/${f}`, 'utf8');
    writeFileSync(`server/src/sim/${f}`, HEADER.replace('$F', f) + body);
    console.log(`synced src/sim/${f} -> server/src/sim/${f}`);
}
