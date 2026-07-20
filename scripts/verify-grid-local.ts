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
    // Input cadence must vary like a human's: a perfectly regular gap has
    // near-zero variance and the server's botLike heuristic (correctly) flags
    // it once the log passes 30 inputs — this script tripped its own anti-cheat
    // with a fixed 19-tick cadence before this jitter existed.
    const GAP = [13, 27, 18, 34, 15, 22, 41, 17, 25, 19];
    let f = 0;
    let nextT = 25;
    let pi = 0;
    while (runner.alive && runner.tick < 18000) {
        if (runner.tick >= nextT && pi < presses.length) {
            runner.input(presses[pi++]);
            nextT += GAP[pi % GAP.length];
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

    // 2+3. Open a grid, back-date it open for tickets (test-only shortcut —
    // production waits out the real 5-minute inspection delay), get a ticket,
    // and play a run. The scripted input pattern occasionally dies in under the
    // server's 1.5-second suspicious-run floor on an unlucky seed — that's the
    // anti-cheat working as designed, not a failure — so reroll a fresh grid
    // (fresh seed) until the bot survives long enough to be a valid submission.
    let openRes!: { grid: { id: string; seed: `0x${string}` } };
    let ticketRes!: { ticket?: { id: string; seed: `0x${string}` }; error?: string };
    let replay!: RunReplay;
    for (let attempt = 1; attempt <= 6; attempt++) {
        const dayId = `verify-grid-local-${randomBytes(4).toString('hex')}`;
        openRes = (await (await api(`/api/admin/grid/open?dayId=${dayId}`, {
            method: 'POST',
            headers: { 'x-admin-key': KEY },
        })).json()) as { grid: { id: string; seed: `0x${string}` } };
        console.log('opened grid:', dayId, openRes.grid.id);
        execSync(
            `docker compose exec -T postgres psql -U postgres -d bullrush -c "UPDATE daily_grids SET opens_at = now() - interval '1 minute' WHERE id = '${openRes.grid.id}'"`,
            { cwd: new URL('..', import.meta.url).pathname, stdio: 'pipe' },
        );

        ticketRes = (await (await api('/api/grid/ticket', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ gridId: openRes.grid.id }),
        })).json()) as { ticket?: { id: string; seed: `0x${string}` }; error?: string };
        if (!ticketRes.ticket) throw new Error(`ticket request failed: ${ticketRes.error}`);

        replay = await playRun(ticketRes.ticket.seed, ticketRes.ticket.id);
        if (replay.ticks >= 150) break; // survived >= 2.5s — clears the 1.5s floor
        console.log(`bot died too fast on this seed (${replay.ticks} ticks) — rerolling grid`);
    }
    console.log('ticket:', JSON.stringify(ticketRes));
    if (!ticketRes.ticket) throw new Error('no viable ticket after rerolls');
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

    // 7. Season Zero lifecycle, live: create a season, pull this grid into its
    // (already-ended) window, close it, and fetch our own entitlement + proof.
    const seasonId = `verify-season-${randomBytes(4).toString('hex')}`;
    const capWei = '1000000000000000000'; // 1 BOT pool
    const base = Date.now() - 900 * 24 * 3_600_000;
    const createSeasonRes = await api(`/api/admin/season/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-key': KEY },
        body: JSON.stringify({
            id: seasonId,
            name: 'Verify Season',
            asset: '0x0000000000000000000000000000000000000000',
            capWei,
            startsAt: base,
            endsAt: base + 24 * 3_600_000,
        }),
    });
    if (!createSeasonRes.ok) throw new Error('season create failed');
    execSync(
        `docker compose exec -T postgres psql -U postgres -d bullrush -c "UPDATE daily_grids SET created_at = to_timestamp(${Math.floor((base + 3_600_000) / 1000)}) WHERE id = '${openRes.grid.id}'"`,
        { cwd: new URL('..', import.meta.url).pathname, stdio: 'pipe' },
    );
    const closeRes = (await (await api(`/api/admin/season/close?id=${seasonId}`, {
        method: 'POST',
        headers: { 'x-admin-key': KEY },
    })).json()) as { ok?: boolean; root?: string; claimCount?: number; totalAllocatedWei?: string; error?: string };
    console.log('season close:', JSON.stringify(closeRes));
    if (!closeRes.ok) throw new Error(`season close failed: ${closeRes.error}`);

    const rewardsRes = (await (await api('/api/rewards/me')).json()) as {
        ok?: boolean;
        rewards?: { seasonId: string; amountWei: string; status: string; merkleRoot: string; proof: string[] }[];
    };
    const myReward = rewardsRes.rewards?.find((r) => r.seasonId === seasonId);
    console.log('my reward:', JSON.stringify(myReward));
    // Sole verified player in the season -> the full (floored) pool.
    const rewardOk = !!myReward && myReward.amountWei === capWei && myReward.status === 'eligible' && myReward.merkleRoot === closeRes.root;

    const ok = statusOk && ghostOk && copyRejected && rewardOk;
    console.log(
        ok
            ? '\n✅ WALLET + GRID + RECEIPT-STATUS + VERIFIED-GHOST + ANTI-COPY + SEASON-REWARDS LOOP WORKS\n'
            : '\n⚠️ unexpected result — check server logs\n',
    );
}

void main();
