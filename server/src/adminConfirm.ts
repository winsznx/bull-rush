// Confirmation tokens for dangerous admin mutations — Redis-backed (short-
// lived, single-use), split from adminAuth.ts so the credential/role logic
// stays pure and unit-testable without services.
import { randomBytes } from 'node:crypto';
import { redis } from './redis.ts';

const CONFIRM_TTL_SEC = 300;

export async function issueConfirmToken(action: string, fingerprint: string): Promise<string> {
    const token = randomBytes(16).toString('hex');
    await redis.set(`admin:confirm:${token}`, JSON.stringify({ action, fingerprint }), 'EX', CONFIRM_TTL_SEC);
    return token;
}

// Single-use by construction (GETDEL): even a valid token that fails the
// action/fingerprint match is destroyed — a mismatch attempt burns it.
export async function consumeConfirmToken(token: string, action: string, fingerprint: string): Promise<boolean> {
    const raw = await redis.getdel(`admin:confirm:${token}`);
    if (!raw) return false;
    try {
        const d = JSON.parse(raw) as { action: string; fingerprint: string };
        return d.action === action && d.fingerprint === fingerprint;
    } catch {
        return false;
    }
}
