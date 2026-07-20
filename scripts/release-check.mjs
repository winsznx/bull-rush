// One-command pre-release gate: everything that must be green before deploying,
// in the order docs/RELEASE-CHECKLIST.md specifies. Run: `npm run release:check`
// (Postgres/Redis must be up for the integration step: `npm run local:db`).
//
// Handles the unlicensed-local-mp3 dance automatically: the build's
// forbidden-asset check must fail if those files would ship, so they are moved
// aside for the build step and always restored — including on failure (steps
// throw instead of exiting, so the finally block always runs).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MUSIC_DIR = 'public/assets/audio/music';

class StepFailed extends Error {}

const steps = [];
function run(name, cmd, args, opts = {}) {
    process.stdout.write(`\n━━━ ${name}\n`);
    const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
    const ok = res.status === 0;
    steps.push({ name, ok });
    if (!ok) throw new StepFailed(name);
}

// Secret scanning is required, not optional: a release must not ship from a
// machine that can't verify this gate.
if (spawnSync('gitleaks', ['version'], { stdio: 'ignore' }).error) {
    console.error('gitleaks is required for release:check (brew install gitleaks)');
    process.exit(1);
}

let holding = null;
const mp3s = existsSync(MUSIC_DIR) ? readdirSync(MUSIC_DIR).filter((f) => f.endsWith('.mp3')) : [];

try {
    run('secret scan (gitleaks, full history)', 'gitleaks', ['git', '--no-banner', '--config', '.gitleaks.toml']);
    // (no standalone check-assets step: the production build below runs it
    // itself, after the local mp3s are moved aside — which is the state that
    // actually matters, since "ship" means "build output")
    run('typecheck (game)', 'npx', ['tsc', '--noEmit']);
    run('typecheck (server)', 'npx', ['tsc', '--noEmit'], { cwd: 'server' });
    run('sim:check (client/server sim identical)', 'npm', ['run', 'sim:check']);
    run('unit tests', 'npm', ['test']);
    run('sim tests + cross-process fingerprint', 'npm', ['run', 'sim:test']);
    run('contracts: forge fmt --check', 'forge', ['fmt', '--check'], { cwd: 'contracts' });
    run('contracts: forge test', 'forge', ['test'], { cwd: 'contracts' });
    run('integration tests (real services)', 'npm', ['run', 'test:integration']);

    if (mp3s.length > 0) {
        holding = mkdtempSync(join(tmpdir(), 'bullrush-mp3-'));
        for (const f of mp3s) renameSync(join(MUSIC_DIR, f), join(holding, f));
        console.log(`(moved ${mp3s.length} local mp3s aside for the build)`);
    }
    run('production build', 'npm', ['run', 'build']);
} catch (err) {
    if (!(err instanceof StepFailed)) throw err;
} finally {
    if (holding) {
        for (const f of readdirSync(holding)) renameSync(join(holding, f), join(MUSIC_DIR, f));
        console.log(`(restored ${mp3s.length} local mp3s)`);
    }
}

console.log('\n━━━ release:check summary');
for (const s of steps) console.log(`  ${s.ok ? '✓' : '✗'} ${s.name}`);
process.exit(steps.some((s) => !s.ok) ? 1 : 0);
