// Wallet identity + SIWE session lifecycle.
//
// Identity is finally real: keyed by (chain_id, wallet_address), not the
// spoofable display name Phase 3's `identity_key` stood in for. A session has
// two credentials: a short-lived ACCESS token (Redis-only, ~15 min, checked on
// every authenticated request) and a longer-lived REFRESH token (Postgres,
// only its hash stored, ~30 days, rotated on every use — reusing an old
// refresh token after rotation fails because the stored hash has moved on).
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { sql } from './db.ts';
import { redis } from './redis.ts';
import { verifySiwe, type VerifySiweContext } from './siwe.ts';

// Independently confirmed live via eth_chainId in Phase 0
// (docs/BOTCHAIN-NETWORK-VALIDATION.md) — re-verify before ever changing this.
export const BOT_CHAIN_MAINNET_ID = 677;

const NONCE_TTL_SEC = 600; // 10 min
const ACCESS_TTL_SEC = 15 * 60; // 15 min
const REFRESH_TTL_SEC = 30 * 24 * 60 * 60; // 30 days

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

export function newNonce(): string {
    return randomBytes(16).toString('hex');
}

export async function issueNonce(wallet: string): Promise<string> {
    const nonce = newNonce();
    await sql`
        INSERT INTO auth_nonces ${sql({
            nonce_hash: sha256(nonce),
            wallet: wallet.toLowerCase(),
            expires_at: new Date(Date.now() + NONCE_TTL_SEC * 1000),
        })}
    `;
    return nonce;
}

// Atomic: only one caller can ever successfully consume a given nonce.
async function consumeNonce(nonce: string, wallet: string): Promise<boolean> {
    const [row] = await sql`
        UPDATE auth_nonces SET used_at = now()
        WHERE nonce_hash = ${sha256(nonce)} AND wallet = ${wallet.toLowerCase()}
              AND used_at IS NULL AND expires_at > now()
        RETURNING nonce_hash
    `;
    return !!row;
}

export interface UserRow {
    id: string;
    chain_id: number;
    wallet_address: string;
    display_name: string | null;
    status: string;
}

async function upsertUser(chainId: number, walletAddress: string): Promise<UserRow> {
    const id = randomUUID();
    await sql`
        INSERT INTO users ${sql({ id, chain_id: chainId, wallet_address: walletAddress })}
        ON CONFLICT (chain_id, wallet_address) DO UPDATE SET last_seen_at = now()
    `;
    const [row] = await sql<UserRow[]>`
        SELECT id, chain_id, wallet_address, display_name, status FROM users
        WHERE chain_id = ${chainId} AND wallet_address = ${walletAddress}
    `;
    return row;
}

export interface SessionTokens {
    accessToken: string;
    refreshToken: string;
    accessExpiresAt: number;
    refreshExpiresAt: number;
}

async function mintSessionTokens(sessionId: string, user: UserRow): Promise<SessionTokens> {
    const accessToken = randomBytes(24).toString('hex');
    const accessExpiresAt = Date.now() + ACCESS_TTL_SEC * 1000;
    await redis.set(
        `auth:access:${accessToken}`,
        JSON.stringify({ sessionId, userId: user.id, chainId: user.chain_id, walletAddress: user.wallet_address }),
        'EX',
        ACCESS_TTL_SEC,
    );
    const refreshToken = randomBytes(32).toString('hex');
    const refreshExpiresAt = Date.now() + REFRESH_TTL_SEC * 1000;
    await sql`
        UPDATE sessions SET refresh_token_hash = ${sha256(refreshToken)}, expires_at = ${new Date(refreshExpiresAt)}
        WHERE id = ${sessionId}
    `;
    return { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt };
}

export type AuthRejection =
    | 'malformed_message'
    | 'wrong_domain'
    | 'wrong_uri'
    | 'wrong_chain'
    | 'expired'
    | 'not_yet_valid'
    | 'invalid_signature'
    | 'invalid_or_used_nonce';

export async function verifyAndCreateSession(
    message: string,
    signature: `0x${string}`,
    ctx: VerifySiweContext,
): Promise<{ ok: true; user: UserRow; tokens: SessionTokens } | { ok: false; reason: AuthRejection }> {
    const result = await verifySiwe(message, signature, ctx);
    if (!result.ok) return { ok: false, reason: result.reason };

    // Nonce is checked AFTER signature verification so an invalid signature
    // never burns a nonce a legitimate retry could still use.
    const nonceOk = await consumeNonce(result.parsed.nonce, result.parsed.address);
    if (!nonceOk) return { ok: false, reason: 'invalid_or_used_nonce' };

    const user = await upsertUser(result.parsed.chainId, result.parsed.address);
    const sessionId = randomUUID();
    await sql`
        INSERT INTO sessions ${sql({
            id: sessionId,
            user_id: user.id,
            refresh_token_hash: 'pending', // replaced immediately below
            expires_at: new Date(Date.now() + REFRESH_TTL_SEC * 1000),
        })}
    `;
    const tokens = await mintSessionTokens(sessionId, user);
    return { ok: true, user, tokens };
}

export interface AccessSession {
    sessionId: string;
    userId: string;
    chainId: number;
    walletAddress: string;
}

export async function resolveAccessToken(accessToken: string): Promise<AccessSession | null> {
    const raw = await redis.get(`auth:access:${accessToken}`);
    if (!raw) return null;
    try {
        return JSON.parse(raw) as AccessSession;
    } catch {
        return null;
    }
}

// Rotates the refresh token: the old raw token becomes permanently unusable
// the instant this succeeds, because the stored hash it would need to match
// no longer exists — a stolen, already-rotated refresh token simply fails here.
export async function refreshSession(
    refreshToken: string,
): Promise<{ ok: true; user: UserRow; tokens: SessionTokens } | { ok: false; reason: 'invalid_or_expired_refresh_token' }> {
    const [session] = await sql<{ id: string; user_id: string }[]>`
        SELECT id, user_id FROM sessions
        WHERE refresh_token_hash = ${sha256(refreshToken)} AND revoked_at IS NULL AND expires_at > now()
    `;
    if (!session) return { ok: false, reason: 'invalid_or_expired_refresh_token' };
    const [user] = await sql<UserRow[]>`SELECT id, chain_id, wallet_address, display_name, status FROM users WHERE id = ${session.user_id}`;
    const tokens = await mintSessionTokens(session.id, user);
    return { ok: true, user, tokens };
}

export async function revokeSession(refreshToken: string | undefined, accessToken: string | undefined): Promise<void> {
    if (accessToken) await redis.del(`auth:access:${accessToken}`);
    if (refreshToken) await sql`UPDATE sessions SET revoked_at = now() WHERE refresh_token_hash = ${sha256(refreshToken)}`;
}

// Display names: cosmetic only, never the leaderboard/identity key. Reserved
// names cannot be impersonated; changes are rate-limited by the caller (see
// server/src/index.ts's use of the existing rateLimit() helper).
const RESERVED_NAMES = new Set([
    'admin', 'administrator', 'bullrush', 'bull rush', 'operator', 'system', 'root',
    'moderator', 'mod', 'support', 'staff', 'official', 'anon', 'anonymous', 'unverified',
]);

export type DisplayNameRejection = 'invalid' | 'reserved' | 'taken';

export async function setDisplayName(
    userId: string,
    rawName: string,
): Promise<{ ok: true } | { ok: false; reason: DisplayNameRejection }> {
    const name = rawName.replace(/[^\x20-\x7E]/g, '').trim().slice(0, 24);
    if (name.length < 2) return { ok: false, reason: 'invalid' };
    const normalized = name.toLowerCase();
    if (RESERVED_NAMES.has(normalized)) return { ok: false, reason: 'reserved' };

    try {
        await sql`UPDATE users SET display_name = ${name}, display_name_normalized = ${normalized} WHERE id = ${userId}`;
    } catch {
        return { ok: false, reason: 'taken' }; // UNIQUE violation on display_name_normalized
    }
    return { ok: true };
}
