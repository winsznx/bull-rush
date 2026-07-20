// Thin client for the wallet/SIWE auth endpoints. Every call uses
// `credentials: 'include'` — the session lives in HTTP-only cookies on the API
// origin, never in localStorage/JS-readable storage.
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '';

async function post<T>(path: string, body: unknown): Promise<T | null> {
    if (!BASE) return null;
    try {
        const r = await fetch(`${BASE}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(body),
        });
        return (await r.json().catch(() => null)) as T | null;
    } catch {
        return null;
    }
}

export async function requestNonce(wallet: string): Promise<string | null> {
    const d = await post<{ nonce?: string; error?: string }>('/api/auth/nonce', { wallet });
    return d?.nonce ?? null;
}

export interface VerifyResult {
    ok: boolean;
    wallet?: string;
    chainId?: number;
    displayName?: string | null;
    error?: string;
}

export async function verifySiweSignature(message: string, signature: string): Promise<VerifyResult> {
    const d = await post<VerifyResult>('/api/auth/verify', { message, signature });
    return d ?? { ok: false, error: 'network_error' };
}

export interface SessionInfo {
    authenticated: boolean;
    wallet?: string;
    chainId?: number;
}

export async function getSession(): Promise<SessionInfo> {
    if (!BASE) return { authenticated: false };
    try {
        const r = await fetch(`${BASE}/api/auth/session`, { credentials: 'include' });
        return (await r.json().catch(() => ({ authenticated: false }))) as SessionInfo;
    } catch {
        return { authenticated: false };
    }
}

export async function logout(): Promise<void> {
    await post('/api/auth/logout', {});
}

export async function setDisplayName(name: string): Promise<{ ok: boolean; reason?: string }> {
    const d = await post<{ ok?: boolean; error?: string }>('/api/auth/display-name', { name });
    if (!d) return { ok: false, reason: 'network_error' };
    return d.ok ? { ok: true } : { ok: false, reason: d.error };
}
