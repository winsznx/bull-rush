// Fails the build if any known-unlicensed asset is present in a directory that
// ships to production. See ASSET_PROVENANCE.md for why this exists: these exact
// five files were previously gitignored (never committed) yet still ended up
// live on production, because git-ignore only hides a file from the repo, not
// from a manual deploy of the local filesystem. This check is the actual guard.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const FORBIDDEN = [
    'assets/audio/music/super-rush.mp3',
    'assets/audio/music/butterfly-war.mp3',
    'assets/audio/music/night-cloud.mp3',
    'assets/audio/music/green-motion.mp3',
    'assets/audio/music/vamp-charge.mp3',
];

// Every directory that could plausibly ship to production: the dev/build source
// (public/) and the build output (dist/), if it exists.
const ROOTS = ['public', 'dist'];

let found = [];
for (const root of ROOTS) {
    for (const rel of FORBIDDEN) {
        const p = join(root, rel);
        if (existsSync(p)) found.push(p);
    }
}

if (found.length > 0) {
    console.error('\n❌ FORBIDDEN ASSET CHECK FAILED\n');
    console.error('The following unlicensed audio files are present and must not ship:\n');
    for (const f of found) console.error(`   ${f}`);
    console.error('\nSee ASSET_PROVENANCE.md for why. Remove these files (or replace them with');
    console.error('licensed/commissioned tracks under different filenames) before building.\n');
    process.exit(1);
}

console.log('✓ forbidden-asset check passed — no unlicensed audio files found');
