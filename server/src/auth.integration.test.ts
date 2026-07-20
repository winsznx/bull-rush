// Integration tests against a REAL local Postgres + Redis — same rationale as
// grid.integration.test.ts: nonce single-use, refresh-token rotation, and
// session revocation are database/cache semantics a mock would only prove
// against itself.
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { sql } from './db.ts';
import { runMigrations } from './migrate.ts';
import { redis } from './redis.ts';
import { issueNonce, verifyAndCreateSession, resolveAccessToken, refreshSession, revokeSession, setDisplayName, BOT_CHAIN_MAINNET_ID } from './auth.ts';

const CTX = { expectedDomain: 'trybullrush.xyz', expectedUri: 'https://trybullrush.xyz', expectedChainId: BOT_CHAIN_MAINNET_ID };

beforeAll(async () => {
    await runMigrations();
});

afterAll(async () => {
    await sql.end();
    redis.disconnect();
});

async function signInFreshAccount() {
    // A fresh, random throwaway test key per call — never a fund-holding key,
    // and distinct per test so tests don't collide on the same wallet address.
    const account = privateKeyToAccount(`0x${randomBytes(32).toString('hex')}` as `0x${string}`);
    const nonce = await issueNonce(account.address);
    const now = new Date();
    const message = `${CTX.expectedDomain} wants you to sign in with your Ethereum account:
${account.address}

Sign in to Bull Rush.

URI: ${CTX.expectedUri}
Version: 1
Chain ID: ${CTX.expectedChainId}
Nonce: ${nonce}
Issued At: ${now.toISOString()}
Expiration Time: ${new Date(now.getTime() + 600_000).toISOString()}`;
    const signature = await account.signMessage({ message });
    return { account, message, signature };
}

describe('SIWE session lifecycle (real Postgres + Redis)', () => {
    it('a genuine signed message creates a user and a working session', async () => {
        // #given a freshly signed, well-formed SIWE message
        const { account, message, signature } = await signInFreshAccount();
        // #when verified
        const result = await verifyAndCreateSession(message, signature, CTX);
        // #then a session is created whose access token actually resolves
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('unreachable');
        expect(result.user.wallet_address).toBe(account.address.toLowerCase());
        const resolved = await resolveAccessToken(result.tokens.accessToken);
        expect(resolved?.walletAddress).toBe(account.address.toLowerCase());
    });

    it('the same nonce cannot be used twice', async () => {
        // #given a message that was already successfully verified once
        const { message, signature } = await signInFreshAccount();
        const first = await verifyAndCreateSession(message, signature, CTX);
        expect(first.ok).toBe(true);
        // #when the identical message+signature is replayed
        const second = await verifyAndCreateSession(message, signature, CTX);
        // #then it is rejected — the nonce was already consumed
        expect(second).toEqual({ ok: false, reason: 'invalid_or_used_nonce' });
    });

    it('refreshing rotates the refresh token — the old one stops working', async () => {
        // #given an established session
        const { message, signature } = await signInFreshAccount();
        const created = await verifyAndCreateSession(message, signature, CTX);
        if (!created.ok) throw new Error('unreachable');
        const oldRefreshToken = created.tokens.refreshToken;

        // #when it is refreshed once
        const refreshed = await refreshSession(oldRefreshToken);
        expect(refreshed.ok).toBe(true);

        // #then the OLD refresh token can no longer be used (rotation, not reuse)
        const reuse = await refreshSession(oldRefreshToken);
        expect(reuse).toEqual({ ok: false, reason: 'invalid_or_expired_refresh_token' });
    });

    it('a new access token is issued on refresh and the old one is superseded', async () => {
        const { message, signature } = await signInFreshAccount();
        const created = await verifyAndCreateSession(message, signature, CTX);
        if (!created.ok) throw new Error('unreachable');
        const refreshed = await refreshSession(created.tokens.refreshToken);
        if (!refreshed.ok) throw new Error('unreachable');
        expect(refreshed.tokens.accessToken).not.toBe(created.tokens.accessToken);
        const resolved = await resolveAccessToken(refreshed.tokens.accessToken);
        expect(resolved?.userId).toBe(created.user.id);
    });

    it('revoking a session invalidates its access token immediately', async () => {
        // #given a live session
        const { message, signature } = await signInFreshAccount();
        const created = await verifyAndCreateSession(message, signature, CTX);
        if (!created.ok) throw new Error('unreachable');
        expect(await resolveAccessToken(created.tokens.accessToken)).not.toBeNull();

        // #when it is revoked (logout)
        await revokeSession(created.tokens.refreshToken, created.tokens.accessToken);

        // #then the access token no longer resolves, and the refresh token is dead too
        expect(await resolveAccessToken(created.tokens.accessToken)).toBeNull();
        const refreshAttempt = await refreshSession(created.tokens.refreshToken);
        expect(refreshAttempt).toEqual({ ok: false, reason: 'invalid_or_expired_refresh_token' });
    });

    it('display names: valid names succeed, reserved names and duplicates are rejected', async () => {
        const { message, signature } = await signInFreshAccount();
        const created = await verifyAndCreateSession(message, signature, CTX);
        if (!created.ok) throw new Error('unreachable');

        const uniqueName = `Runner${randomUUID().slice(0, 8)}`;
        expect(await setDisplayName(created.user.id, uniqueName)).toEqual({ ok: true });
        expect(await setDisplayName(created.user.id, 'admin')).toEqual({ ok: false, reason: 'reserved' });
        expect(await setDisplayName(created.user.id, 'x')).toEqual({ ok: false, reason: 'invalid' });

        // a second, different user cannot take the same name (case-insensitive)
        const other = await signInFreshAccount();
        const otherSession = await verifyAndCreateSession(other.message, other.signature, CTX);
        if (!otherSession.ok) throw new Error('unreachable');
        expect(await setDisplayName(otherSession.user.id, uniqueName.toUpperCase())).toEqual({ ok: false, reason: 'taken' });
    });
});
