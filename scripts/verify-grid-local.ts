// End-to-end check against a LOCAL server for the wallet + Daily Grid + on-chain
// receipt-status flow (Phases 4/8) — a throwaway wallet signs in for real via SIWE,
// enters a grid, plays and submits a real run, and polls its own run's receipt status.
//   npm run local:verify:grid   (server must be running on :8787)
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { buildSiweMessage } from '../src/wallet/siwe.ts';
import { verifyGhostReplay } from '../src/sim/ghost.ts';
import { SimRunner } from '../src/sim/runner.ts';
import { Act } from '../src/sim/sim.ts';
import { REPLAY_SCHEMA_VERSION, type RunReplay } from '../src/sim/replay.ts';
import { GAME_VERSION, RULESET_HASH } from '../src/sim/ruleset.ts';

const API = process.env.API ?? 'http://localhost:8787';
const KEY = process.env.ADMIN_KEY ?? 'local-admin-key';
const DOMAIN = process.env.SITE_DOMAIN ?? 'localhost:8080';
const URI = process.env.GAME_URL ?? 'http://localhost:8080';
const CHAIN_ID = 677; // BOT_CHAIN_MAINNET_ID — server/src/auth.ts

let cookieJar = '';
function captureCookies(res: Response): void {
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) cookieJar += `${c.split(';')[0]}; `;
}
async function api(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(`${API}${path}`, { ...init, headers: { ...init.headers, cookie: cookieJar } });
    captureCookies(res);
    return res;
}

async function playRun(seed: `0x${string}`, runId: string): Promise<RunReplay> {
    const runner = new SimRunner(seed);
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
    return {
        schemaVersion: REPLAY_SCHEMA_VERSION,
        gameVersion: GAME_VERSION,
        rulesetHash: RULESET_HASH,
        seed,
        runId,
        inputs: runner.log.map((e) => ({ tick: e.tick, action: e.act })),
        ticks: runner.tick,
    };
}

async function main() {
    const health = await (await fetch(`${API}/health`)).json();
    console.log('\nhealth:', JSON.stringify(health));

    // 1. Sign in with a throwaway wallet (never a fund-holding key).
    const account = privateKeyToAccount(generatePrivateKey());
    console.log(`\nthrowaway wallet: ${account.address}`);

    const nonceRes = (await (await api('/api/auth/nonce', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet: account.address }),
    })).json()) as { nonce: string };

    const now = new Date();
    const message = buildSiweMessage({
        domain: DOMAIN,
        address: account.address,
        statement: 'Sign in to Bull Rush to enter the Daily Grid.',
        uri: URI,
        chainId: CHAIN_ID,
        nonce: nonceRes.nonce,
        issuedAt: now.toISOString(),
        expirationTime: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
    });
    const signature = await account.signMessage({ message });

    const verifyRes = await api('/api/auth/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, signature }),
    });
    const verifyBody = await verifyRes.json();
    console.log('siwe verify:', verifyRes.status, JSON.stringify(verifyBody));
    if (!verifyRes.ok) throw new Error('SIWE verify failed — aborting');

    // 2. Open (or reuse) today's grid, back-date it open for tickets (test-only
    // shortcut — production waits out the real 5-minute inspection delay).
    const dayId = `verify-grid-local-${randomBytes(4).toString('hex')}`;
    const openRes = (await (await api(`/api/admin/grid/open?dayId=${dayId}`, {
        method: 'POST',
        headers: { 'x-admin-key': KEY },
    })).json()) as { grid: { id: string; seed: `0x${string}` } };
    console.log('opened grid:', dayId, openRes.grid.id);

    // Back-date the real 5-minute inspection delay for this test grid only —
    // same shortcut server/src/grid.integration.test.ts uses, direct against the
    // local docker-compose Postgres.
    execSync(
        `docker compose exec -T postgres psql -U postgres -d bullrush -c "UPDATE daily_grids SET opens_at = now() - interval '1 minute' WHERE id = '${openRes.grid.id}'"`,
        { cwd: new URL('..', import.meta.url).pathname, stdio: 'pipe' },
    );

    // 3. Request a ticket, then play and submit a real run.
    const ticketRes = (await (await api('/api/grid/ticket', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gridId: openRes.grid.id }),
    })).json()) as { ticket?: { id: string; seed: `0x${string}` }; error?: string };
    console.log('ticket:', JSON.stringify(ticketRes));
    if (!ticketRes.ticket) throw new Error(`ticket request failed: ${ticketRes.error}`);

    const replay = await playRun(ticketRes.ticket.seed, ticketRes.ticket.id);
    const submitRes = (await (await api('/api/grid/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ticketId: ticketRes.ticket.id, replay }),
    })).json()) as { ok: boolean; runId?: string; status?: string; isPersonalBest?: boolean; distance?: number };
    console.log('submit:', JSON.stringify(submitRes));
    if (!submitRes.ok || !submitRes.runId) throw new Error('submit did not return a runId — nothing to poll');

    // 4. Poll this run's own receipt status — should read back exactly what
    // submit already reported (receipt_queued for a first-ever personal best,
    // since no relayer is running in local dev by default).
    const statusRes = (await (await api(`/api/grid/run/${submitRes.runId}/status`)).json()) as {
        ok: boolean;
        status?: string;
        isPersonalBest?: boolean;
    };
    console.log('own status poll:', JSON.stringify(statusRes));

    const statusOk = statusRes.ok && statusRes.status === submitRes.status && statusRes.isPersonalBest === true;

    // 5. Fetch the grid's ghost (this run just became the leader) and verify the
    // served trace independently: recompute the replay hash from the raw bytes
    // and confirm it matches what the server claims (Phase 9's core property).
    const ghostRes = (await (await api(`/api/grid/${openRes.grid.id}/ghost`)).json()) as {
        ok?: boolean;
        ghost?: { identityKey: string; distance: number; replayHash: `0x${string}`; seed: `0x${string}`; inputs: number[]; ticks: number };
    };
    if (!ghostRes.ok || !ghostRes.ghost) throw new Error('ghost fetch failed');
    const verified = verifyGhostReplay(ghostRes.ghost.inputs, ghostRes.ghost.ticks, ghostRes.ghost.replayHash);
    const ghostOk =
        verified !== null &&
        ghostRes.ghost.seed === ticketRes.ticket.seed &&
        ghostRes.ghost.identityKey === `677:${account.address.toLowerCase()}`;
    console.log(
        `ghost: leader=${ghostRes.ghost.identityKey} distance=${ghostRes.ghost.distance} hashVerified=${verified !== null}`,
    );

    // 6. The copy attack, for real: take the ghost's now-public input log and
    // resubmit it verbatim through a fresh ticket. Must be rejected.
    const ticket2 = (await (await api('/api/grid/ticket', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gridId: openRes.grid.id }),
    })).json()) as { ticket?: { id: string; seed: `0x${string}` } };
    if (!ticket2.ticket) throw new Error('second ticket request failed');
    const copiedReplay: RunReplay = { ...replay, runId: ticket2.ticket.id };
    const copyRes = await api('/api/grid/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ticketId: ticket2.ticket.id, replay: copiedReplay }),
    });
    const copyBody = (await copyRes.json()) as { error?: string };
    const copyRejected = copyRes.status === 409 && copyBody.error === 'duplicate_replay';
    console.log('copy attack:', copyRes.status, JSON.stringify(copyBody));

    const ok = statusOk && ghostOk && copyRejected;
    console.log(
        ok
            ? '\n✅ WALLET + GRID + RECEIPT-STATUS + VERIFIED-GHOST + ANTI-COPY LOOP WORKS\n'
            : '\n⚠️ unexpected result — check server logs\n',
    );
}

void main();
