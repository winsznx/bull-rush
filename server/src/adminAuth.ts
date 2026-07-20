// Admin authentication hardening (Phase 12), replacing the bare
// `header !== ADMIN_KEY` checks every admin route used through Phase 11.
//
// - Constant-time comparison: both sides are hashed before timingSafeEqual, so
//   neither content nor LENGTH of the configured key leaks through timing.
// - Two credentials: ADMIN_WRITE_KEY (mutations) and ADMIN_READ_KEY
//   (diagnostics). Write implies read. The legacy ADMIN_KEY keeps working as
//   the write key so existing deployments don't lock themselves out.
// - Confirmation tokens: a dangerous mutation called without one gets back a
//   short-lived, single-use token bound to the exact action + parameters; only
//   replaying the identical request with that token executes. An operator
//   cannot fat-finger an irreversible action in one keystroke, and a leaked
//   token neither works twice nor works for different parameters.
import { createHash, timingSafeEqual } from 'node:crypto';

export type AdminRole = 'read' | 'write';

function safeEqual(a: string, b: string): boolean {
    const ha = createHash('sha256').update(a).digest();
    const hb = createHash('sha256').update(b).digest();
    return timingSafeEqual(ha, hb);
}

// Pure: env passed in so tests exercise every credential combination.
export function resolveAdminRole(presented: string | undefined, env: NodeJS.ProcessEnv = process.env): AdminRole | null {
    if (!presented) return null;
    const writeKey = env.ADMIN_WRITE_KEY || env.ADMIN_KEY;
    if (writeKey && safeEqual(presented, writeKey)) return 'write';
    if (env.ADMIN_READ_KEY && safeEqual(presented, env.ADMIN_READ_KEY)) return 'read';
    return null;
}

export function roleAllows(role: AdminRole | null, required: AdminRole): boolean {
    if (role === null) return false;
    return role === 'write' || required === 'read';
}

// Deterministic fingerprint of a dangerous action's parameters — a confirm
// token issued for one (action, params) pair can never authorize another.
export function actionFingerprint(params: Record<string, string | number | boolean | null>): string {
    const keys = Object.keys(params).sort();
    const canonical = keys.map((k) => `${k}=${String(params[k])}`).join('&');
    return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}
